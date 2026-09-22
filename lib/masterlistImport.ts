import {
  getMasterlistMapping,
  resolveMasterlistMapping,
  type ResolvedMasterlistMapping,
} from "./masterlistMapping";

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
  clientRate: string;
  currency: string;
  qty: string;
  tog: string;
  liverAdminRemarks: string;
  reviewChasing: string;
  clientAddress: string;
  clientNumber: string;
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

/** Read a cell by 0-based col index (or "" if the column isn't mapped/present). */
function cell(row: unknown[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  return String(row[idx] ?? "").trim();
}

/** Parse a single already-extracted sheet grid into masterlist rows + metadata,
 * using the customer's configured column mapping. */
function parseSheetGrid(data: unknown[][], m: ResolvedMasterlistMapping): {
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  liveDate: string;
  globalRate: number;
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

  const liveDate = m.liveDate && data[m.liveDate.row]?.[m.liveDate.col] != null
    ? String(data[m.liveDate.row][m.liveDate.col]) : "";
  const pageName = m.page && data[m.page.row]?.[m.page.col] != null
    ? String(data[m.page.row][m.page.col]) : "";

  const rows: ParsedMasterlistRow[] = [];

  for (let i = m.dataStartIndex; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;

    const code = cell(row, m.col.orderId).toUpperCase();
    const minerName = cell(row, m.col.minerName).toUpperCase();
    const itemDescription = cell(row, m.col.itemDescription).toUpperCase();
    if (!code || !minerName || !itemDescription) continue;

    const currency = cell(row, m.col.currency).toUpperCase();
    const category = cell(row, m.col.category);
    const source = cell(row, m.col.source);
    const qty = String(parseInt(cell(row, m.col.qty), 10) || 1);
    const tog = cell(row, m.col.tog);
    const grams = String(parseFloat(cell(row, m.col.grams)) || 0);

    let clientRate = parseFloat(cell(row, m.col.clientRate));
    if (isNaN(clientRate) || clientRate === 0) clientRate = parseFloat(cell(row, m.col.amount)) || 0;

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
      goldRate: String(globalRate),
      clientRate: String(clientRate),
      currency,
      qty,
      tog,
      liverAdminRemarks: remarks,
      reviewChasing: "", // set inside the app, not from the masterlist
      clientAddress,
      clientNumber,
    });
  }

  return { rows, liverName, pageName, liveDate, globalRate };
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
export async function parseMasterlistFile(file: File): Promise<{
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  liveDate: string;
  globalRate: number;
  sheets: ParsedSheetSummary[];
}> {
  // Loaded on demand — keeps the ~1MB spreadsheet library out of the main bundle.
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

  // Resolve the customer's configured column layout once for this file.
  const resolved = resolveMasterlistMapping(getMasterlistMapping());

  const rows: ParsedMasterlistRow[] = [];
  const sheets: ParsedSheetSummary[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (isNonMasterlistSheet(sheetName)) continue;

    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const data: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    if (data.length <= resolved.dataStartIndex) continue; // no data rows for this layout

    const parsed = parseSheetGrid(data, resolved);
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
  };
}
