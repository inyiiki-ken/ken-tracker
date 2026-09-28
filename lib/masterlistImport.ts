import {
  getMasterlistMapping,
  resolveMasterlistMapping,
  cleanTitle,
  categoryForMc,
  type MasterlistMapping,
  type ResolvedMasterlistMapping,
} from "./masterlistMapping";
import { usesGold, getRatesForDate } from "./ratesStore";
import { getMakingCharge } from "./pricingConfig";

/**
 * Replaces the old Apps Script processUpload() entirely. Instead of
 * uploading a file somewhere and waiting for a sheet-bound script to notice
 * and parse it (which only worked because Zite hosted a fetchable URL),
 * this reads the file directly in the browser and produces rows ready for
 * importRows(). No file hosting needed at all.
 *
 * Mirrors the real Apps Script's parsing rules:
 *  - Header metadata (Liver Name, Gold/Silver Rate) is searched for in the
 *    first 5 rows, scanning a few cells to the right of the label.
 *  - Live date is cell C4 (row index 3, col index 2), Page name is cell A2
 *    (row index 1, col index 0).
 *  - Data rows start at row index 5 (the 6th row).
 *  - Region is derived from currency: PHP -> Pinas, USD -> International,
 *    otherwise -> Local.
 *
 * NOTE: unlike the Apps Script, this does NOT pre-compute mc/supplierRate
 * per category (screw type = 115, silver = blank, etc.) -- your real
 * lib/calculations.ts already derives cost dynamically from category +
 * goldRate at render time for every other row in the app, so doing it again
 * here would just be duplicate logic that could drift out of sync. We only
 * import the raw fields; the same calculation engine used everywhere else
 * in the app takes it from there.
 */

export interface ParsedMasterlistRow {
  orderId: string;
  dateOfLive: string;
  page: string;
  liverName: string;
  locationOfMiner: string;
  minerName: string;
  itemDescription: string;
  grams: string;
  source: string;
  category: string;
  goldRate: string;
  mc: string;
  clientRate: string;
  currency: string;
  qty: string;
  tog: string;
  liverAdminRemarks: string;
  reviewChasing: string;
  clientAddress: string;
  clientNumber: string;
  /** Something to double-check before importing (shown highlighted in the preview). */
  warning?: string;
}

function regionFromCurrency(currency: string): string {
  const c = currency.trim().toUpperCase();
  if (c === "PHP") return "Pinas";
  if (c === "USD") return "International";
  return "Local";
}

/** Per-sheet summary returned alongside the aggregated rows. */
export interface ParsedSheetSummary {
  sheetName: string;
  page: string;
  liverName: string;
  liveDate: string;
  globalRate: number;
  rowCount: number;
}

/** Sheet names that are NOT masterlist forms and must be skipped. Handles the
 * "DATA'S" dropdown-source tab (and its straight/curly-apostrophe variants). */
function isNonMasterlistSheet(name: string): boolean {
  const n = name.trim().toUpperCase().replace(/[’']/g, "'");
  return n === "DATA'S" || n === "DATA" || n === "DATAS" || n.startsWith("DATA'S");
}

/** Number from a cell, tolerant of spaces and thousands commas (" 2,861.78 "). */
function toNum(v: string): number {
  const x = parseFloat(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(x) ? x : 0;
}

/** "Tuesday, August 25, 2026" -> "August 25, 2026" (weekday confuses date parsing). */
function cleanDate(v: string): string {
  return String(v ?? "").trim().replace(/^[a-z]+day,?\s+/i, "");
}

/** Read a cell by 0-based col index (or "" if the column isn't mapped/present). */
function cell(row: unknown[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return String(row[idx] ?? "").replace(/\s+/g, " ").trim();
}

/** A number from the RAW grid when we have it (exact stored value, not the
 * formatted text: "17.1" shown for 17.07, "AED 390.00" etc.). */
function numAt(raw: unknown[][] | undefined, fmtRow: unknown[], i: number, idx: number): number {
  if (idx < 0) return 0;
  const rv = raw?.[i]?.[idx];
  if (typeof rv === "number" && Number.isFinite(rv)) return rv;
  const fromRaw = rv != null && rv !== "" ? toNum(String(rv).replace(/[^\d.,\-]/g, "")) : 0;
  if (fromRaw) return fromRaw;
  return toNum(cell(fmtRow, idx).replace(/[^\d.,\-]/g, ""));
}

const HEADER_WORDS = /^(code|order id|item description|description|customer name|client name|wt\/?grams|grams|rate|mc|amount)$/i;

/** Parse a single already-extracted sheet grid into masterlist rows + metadata,
 * using the customer's configured column mapping. */
function parseSheetGrid(data: unknown[][], m: ResolvedMasterlistMapping, raw?: unknown[][]): {
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  liveDate: string;
  globalRate: number;
  skipped: string[];
} {
  let liverName = "Unknown";
  let globalRate = 0;

  for (let r = 0; r < Math.min(5, data.length); r++) {
    const row = data[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const txt = String(row[c] ?? "").toUpperCase().trim();
      if (txt.includes(m.liverNameLabel)) {
        for (let k = 1; k <= 5; k++) {
          const val = row[c + k];
          if (val && String(val).trim() !== "") {
            liverName = String(val).trim();
            break;
          }
        }
      }
      if (txt.includes(m.rateLabel) || txt.includes("SILVER RATE")) {
        const combined = `${txt} ${row[c + 1] ?? ""}`;
        const match = combined.match(/\d+(\.\d+)?/);
        if (match) globalRate = parseFloat(match[0]);
      }
    }
  }

  // A fixed rate cell (set by the import setup) beats the label search.
  if (m.rateCell) {
    const rc = m.rateCell;
    const v = numAt(raw, data[rc.row] ?? [], rc.row, rc.col);
    if (v > 0) globalRate = v;
  }

  const liveDate = m.liveDate && data[m.liveDate.row]?.[m.liveDate.col] != null
    ? cleanDate(String(data[m.liveDate.row][m.liveDate.col])) : "";
  const pageName = m.page && data[m.page.row]?.[m.page.col] != null
    ? cleanTitle(data[m.page.row][m.page.col]) : "";

  // No "LIVER NAME" label: read the liver from its own cell (e.g. the "AMBIE" title).
  if (liverName === "Unknown" && m.liverCell) {
    const v = cleanTitle(data[m.liverCell.row]?.[m.liverCell.col]);
    if (v) liverName = v;
  }

  // Gold-rate customers: if the file has no rate at all, use the Daily/Sticky gold rate.
  let fallbackGold = globalRate;
  if (!fallbackGold && usesGold()) fallbackGold = getRatesForDate(liveDate).goldRate || 0;

  const rows: ParsedMasterlistRow[] = [];
  // Round a rate UP to a whole number when this customer's setup says so (426.25 -> 427).
  const up = (v: number) => (m.roundRateUp && v > 0 ? Math.ceil(v - 1e-9) : v);

  const skipped: string[] = [];
  let lastMiner = "";

  for (let i = m.dataStartIndex; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    const code = cell(row, m.col.orderId).toUpperCase();
    let minerName = cell(row, m.col.minerName).toUpperCase();
    const itemDescription = cell(row, m.col.itemDescription).toUpperCase();
    // A repeated header row (e.g. a second table on the same sheet) is not an item.
    if (HEADER_WORDS.test(code) || HEADER_WORDS.test(itemDescription)) continue;
    // Merged/blank customer cell under the previous item = same customer.
    if (!minerName && code && itemDescription && lastMiner) minerName = lastMiner;
    const gramsN = numAt(raw, row, i, m.col.grams);
    if (!code || !minerName || !itemDescription) {
      // Only report rows that look like real items, not totals/blank lines.
      if ((code || itemDescription) && !/^(total|grand total|sub ?total)/i.test(code || itemDescription)) {
        skipped.push(`row ${i + 1}${code ? ` (${code})` : ""}: missing ${!code ? "code" : !minerName ? "customer" : "description"}`);
      }
      continue;
    }
    lastMiner = minerName;

    const currency = cell(row, m.col.currency).toUpperCase();
    const mcCell = numAt(raw, row, i, m.col.mc);
    const source = cell(row, m.col.source);
    const qty = String(Math.round(numAt(raw, row, i, m.col.qty)) || 1);
    const tog = cell(row, m.col.tog) || m.defaultTog;
    const grams = String(Math.round(gramsN * 1000) / 1000);
    const fileAmount = numAt(raw, row, i, m.col.amount);

    const rowGold = numAt(raw, row, i, m.col.goldRate);
    let goldRate = up(rowGold > 0 ? rowGold : fallbackGold);
    let mc = mcCell;
    let category = cell(row, m.col.category) || categoryForMc(m.mcCategories, mcCell) || m.defaultCategory;
    const warnings: string[] = [];

    let clientRate: number;
    if (m.priceMode === "rate_plus_mc") {
      // e.g. Crown: selling rate per gram = gold rate + MC (AMOUNT = WT x (RATE + MC)).
      const rowRate = up(numAt(raw, row, i, m.col.clientRate));
      // Row's own rate, else the sheet's RATE cell (not yet the daily rate).
      const base = rowRate || (rowGold > 0 ? goldRate : 0) || up(globalRate);
      if (base > 0) {
        if (!mc && fileAmount > 0 && gramsN > 0) {
          // MC blank: work it out from the file's AMOUNT.
          const derived = Math.round((fileAmount / gramsN - base) * 100) / 100;
          if (derived >= 0) mc = Math.round(derived);
          category = category || categoryForMc(m.mcCategories, mc) || m.defaultCategory;
        }
        if (!mc) mc = getMakingCharge(category);
        clientRate = base + mc;
      } else if (fileAmount > 0 && gramsN > 0) {
        // No rate on the row: trust the file's AMOUNT before any daily rate.
        clientRate = fileAmount / gramsN;
        warnings.push("no rate — price taken from AMOUNT");
      } else if (fallbackGold > 0) {
        if (!mc) mc = getMakingCharge(category);
        clientRate = up(fallbackGold) + mc;
        goldRate = up(fallbackGold);
        warnings.push("no rate — used today's gold rate");
      } else {
        clientRate = 0;
      }
    } else {
      clientRate = numAt(raw, row, i, m.col.clientRate);
      if (!clientRate) clientRate = fileAmount;
      else clientRate = up(clientRate);
    }

    if (!(gramsN > 0) && !/per pc|diamond|screw/i.test(category)) warnings.push("grams missing");
    if (!clientRate) warnings.push("no price");
    // The sheet's own AMOUNT must match grams × rate (±1).
    if (fileAmount > 0 && gramsN > 0 && clientRate > 0) {
      const calc = Math.round(Number((gramsN * clientRate).toFixed(6)));
      if (Math.abs(calc - fileAmount) > 1) warnings.push(`AMOUNT in file ${Math.round(fileAmount)} ≠ ${calc}`);
    }

    const remarks = cell(row, m.col.remarks);
    // Address + Number are the client's delivery details — NOT "Review Chasing".
    const clientAddress = cell(row, m.col.clientAddress);
    const clientNumber = cell(row, m.col.clientNumber);

    rows.push({
      orderId: code,
      dateOfLive: liveDate,
      page: pageName,
      liverName,
      locationOfMiner: regionFromCurrency(currency),
      minerName,
      itemDescription,
      grams,
      source,
      category,
      goldRate: String(goldRate),
      mc: mc ? String(mc) : "",
      clientRate: String(clientRate),
      currency,
      qty,
      tog,
      liverAdminRemarks: remarks,
      reviewChasing: "", // set inside the app, not from the masterlist
      clientAddress,
      clientNumber,
      ...(warnings.length ? { warning: warnings.join("; ") } : {}),
    });
  }

  return { rows, liverName, pageName, liveDate, globalRate, skipped };
}

/** Parse an already-built grid (e.g. from a photo) with the customer's layout. */
export function parseMasterlistGrid(data: unknown[][], mapping?: MasterlistMapping) {
  return parseSheetGrid(data, resolveMasterlistMapping(mapping ?? getMasterlistMapping()));
}

/**
 * Parses EVERY masterlist worksheet in the workbook (one sheet per page/store,
 * e.g. AR Universal, NERS, Sweet & Glam, J's) and aggregates the rows.
 * Skips the "DATA'S" dropdown-source tab. This mirrors the Apps Script's
 * original behaviour of looping all sheets -- the earlier single-sheet version
 * silently dropped every store after the first.
 *
 * Each row carries its own page/liver/date, so multi-store files import
 * correctly. The top-level liverName/pageName/liveDate/globalRate reflect the
 * FIRST sheet that produced rows (kept for the existing upload-label caller);
 * `sheets` gives the full per-sheet breakdown.
 */
export async function parseMasterlistFile(file: File, mappingOverride?: MasterlistMapping): Promise<{
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  liveDate: string;
  globalRate: number;
  sheets: ParsedSheetSummary[];
  skipped: string[];
}> {
  // Loaded on demand — keeps the ~1MB spreadsheet library out of the main bundle.
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

  // Resolve the customer's configured column layout once for this file.
  const resolved = resolveMasterlistMapping(mappingOverride ?? getMasterlistMapping());

  const rows: ParsedMasterlistRow[] = [];
  const sheets: ParsedSheetSummary[] = [];
  const skipped: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (isNonMasterlistSheet(sheetName)) continue;

    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    // Same grid with the exact stored numbers (display formats can round 17.07 → 17.1).
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
    if (data.length <= resolved.dataStartIndex) continue; // no data rows for this layout

    const parsed = parseSheetGrid(data, resolved, rawData);
    skipped.push(...parsed.skipped.map((x) => `${sheetName}: ${x}`));
    if (parsed.rows.length === 0) continue;

    rows.push(...parsed.rows);
    sheets.push({
      sheetName,
      page: parsed.pageName,
      liverName: parsed.liverName,
      liveDate: parsed.liveDate,
      globalRate: parsed.globalRate,
      rowCount: parsed.rows.length,
    });
  }

  rows.sort((a, b) => a.minerName.localeCompare(b.minerName));

  const first = sheets[0];
  return {
    rows,
    liverName: first?.liverName ?? "Unknown",
    pageName: first?.page ?? "",
    liveDate: first?.liveDate ?? "",
    globalRate: first?.globalRate ?? 0,
    sheets,
    skipped,
  };
}
