"use client";

/**
 * PER-CUSTOMER MASTERLIST IMPORT MAPPING.
 *
 * The "Upload Masterlist" importer reads each item row by COLUMN POSITION. Some
 * customers lay their masterlist out differently (Grams in a different column,
 * an extra column before the data, data starting on a different row, etc.).
 * This mapping lets the developer tell the importer, per customer, which column
 * each field lives in — so any layout can import correctly without code changes.
 *
 * Columns are entered as spreadsheet letters (A, B, C, …) which is what the
 * customer sees in Excel. Stored in the tenant's config tab, loaded on app start.
 */

export type MasterlistFieldKey =
  | "orderId"
  | "minerName"
  | "itemDescription"
  | "currency"
  | "category"
  | "source"
  | "qty"
  | "tog"
  | "grams"
  | "clientRate"
  | "amount"
  | "remarks"
  | "clientAddress"
  | "clientNumber"
  | "mc"
  | "goldRate";

/**
 * How the row's selling rate is formed.
 *  - "rate":         the Rate column IS the selling rate per gram (AR/MYK layout).
 *  - "rate_plus_mc": the Rate column is the gold/board rate and the selling rate
 *                    per gram is Rate + MC (e.g. Crown: AMOUNT = WT × (RATE + MC)).
 */
export type PriceMode = "rate" | "rate_plus_mc";

export interface MasterlistMapping {
  /** 1-based row where item rows START (the row after the header row). */
  dataStartRow: number;
  /** Column LETTER for each field (e.g. "B"). Empty = field not present. */
  columns: Record<MasterlistFieldKey, string>;
  /** A1-style cell holding the live date (e.g. "C4"). Empty = skip. */
  liveDateCell: string;
  /** A1-style cell holding the page/store name (e.g. "A2"). Empty = skip. */
  pageCell: string;
  /** Text label to find the liver name beside (scanned in the first rows). */
  liverNameLabel: string;
  /** Text label to find the gold/silver rate beside. */
  rateLabel: string;
  /** A1 cell holding the sheet-wide gold/silver rate (e.g. "F5"). Empty = use rateLabel search. */
  rateCell: string;
  /** How the selling rate is built from the row (see PriceMode). */
  priceMode: PriceMode;
  /** Category to use when the file has no Category column (e.g. "Gold Normal"). */
  defaultCategory: string;
  /** When the file has no Category column: MC value -> category
   *  (e.g. Crown: {"21":"Gold Normal","28":"Special Price","55":"Special Price EF"}).
   *  An MC not listed falls back to defaultCategory. */
  mcCategories: Record<string, string>;
  /** Round the rate UP to a whole number before adding MC (426.25 -> 427), the way the liver prices it. */
  roundRateUp: boolean;
  /** A1 cell holding the liver's name when the file has no "LIVER NAME" label (e.g. the "AMBIE" title). */
  liverCell: string;
  /** T.O.G to use when the file has no T.O.G column (e.g. "18K"). */
  defaultTog: string;
}

/** Defaults reproduce the original hard-coded AR/MYK layout exactly. */
export const DEFAULT_MASTERLIST_MAPPING: MasterlistMapping = {
  dataStartRow: 6,
  columns: {
    orderId: "B",
    minerName: "C",
    itemDescription: "D",
    currency: "E",
    category: "F",
    source: "G",
    qty: "H",
    tog: "I",
    grams: "J",
    clientRate: "L",
    amount: "M",
    remarks: "N",
    clientAddress: "O",
    clientNumber: "P",
    mc: "",
    goldRate: "",
  },
  liveDateCell: "C4",
  pageCell: "A2",
  liverNameLabel: "LIVER NAME",
  rateLabel: "GOLD RATE",
  // New options — blank/"rate" reproduce the original behaviour exactly.
  rateCell: "",
  priceMode: "rate",
  defaultCategory: "",
  mcCategories: {},
  roundRateUp: false,
  liverCell: "",
  defaultTog: "",
};

/** Human labels for the settings editor. */
export const MASTERLIST_FIELD_LABELS: { key: MasterlistFieldKey; label: string }[] = [
  { key: "orderId", label: "Code / Order ID" },
  { key: "minerName", label: "Client name" },
  { key: "itemDescription", label: "Description" },
  { key: "currency", label: "Currency" },
  { key: "category", label: "Category" },
  { key: "source", label: "Source" },
  { key: "qty", label: "Qty" },
  { key: "tog", label: "T.O.G" },
  { key: "grams", label: "Grams" },
  { key: "clientRate", label: "Rate" },
  { key: "amount", label: "Amount (fallback price)" },
  { key: "remarks", label: "Remarks" },
  { key: "clientAddress", label: "Address" },
  { key: "clientNumber", label: "Number / Contact" },
  { key: "mc", label: "Making charge (MC)" },
  { key: "goldRate", label: "Gold rate (per row)" },
];

/** Column letter -> 0-based index. "A"->0, "B"->1, "AA"->26. Blank/invalid -> -1. */
export function colToIndex(letter: string): number {
  const s = String(letter ?? "").trim().toUpperCase();
  if (!s) return -1;
  let n = 0;
  for (const ch of s) {
    if (ch < "A" || ch > "Z") return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** A1 ref -> 0-based {row, col}. "C4"->{row:3,col:2}. Invalid -> null. */
export function cellToRC(ref: string): { row: number; col: number } | null {
  const m = String(ref ?? "").trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = colToIndex(m[1]);
  const row = parseInt(m[2], 10) - 1;
  if (col < 0 || row < 0) return null;
  return { row, col };
}

export interface ResolvedMasterlistMapping {
  dataStartIndex: number; // 0-based
  col: Record<MasterlistFieldKey, number>; // 0-based (or -1 if absent)
  liveDate: { row: number; col: number } | null;
  page: { row: number; col: number } | null;
  liverNameLabel: string;
  rateLabel: string;
  rateCell: { row: number; col: number } | null;
  priceMode: PriceMode;
  defaultCategory: string;
  mcCategories: Record<string, string>;
  roundRateUp: boolean;
  liverCell: { row: number; col: number } | null;
  defaultTog: string;
}

export function resolveMasterlistMapping(m: MasterlistMapping): ResolvedMasterlistMapping {
  const col = {} as Record<MasterlistFieldKey, number>;
  (Object.keys(m.columns) as MasterlistFieldKey[]).forEach((k) => {
    col[k] = colToIndex(m.columns[k]);
  });
  const start = Number.isFinite(m.dataStartRow) && m.dataStartRow > 0 ? Math.floor(m.dataStartRow) - 1 : 5;
  return {
    dataStartIndex: start,
    col,
    liveDate: cellToRC(m.liveDateCell),
    page: cellToRC(m.pageCell),
    liverNameLabel: (m.liverNameLabel || "LIVER NAME").toUpperCase(),
    rateLabel: (m.rateLabel || "GOLD RATE").toUpperCase(),
    rateCell: cellToRC(m.rateCell),
    priceMode: m.priceMode === "rate_plus_mc" ? "rate_plus_mc" : "rate",
    defaultCategory: (m.defaultCategory || "").trim(),
    mcCategories: m.mcCategories || {},
    roundRateUp: !!m.roundRateUp,
    liverCell: cellToRC(m.liverCell),
    defaultTog: (m.defaultTog || "").trim(),
  };
}

// ── Client singleton (localStorage cache + tenant config) ─────────────────────

const STORAGE_KEY = "masterlist_mapping";
let _mapping: MasterlistMapping = loadFromCache();

function normalize(p: Partial<MasterlistMapping> | null | undefined): MasterlistMapping {
  const columns = { ...DEFAULT_MASTERLIST_MAPPING.columns };
  if (p?.columns && typeof p.columns === "object") {
    for (const k of Object.keys(DEFAULT_MASTERLIST_MAPPING.columns) as MasterlistFieldKey[]) {
      if (typeof p.columns[k] === "string") columns[k] = String(p.columns[k]).trim().toUpperCase();
    }
  }
  return {
    dataStartRow: Number.isFinite(p?.dataStartRow as number) ? Number(p!.dataStartRow) : DEFAULT_MASTERLIST_MAPPING.dataStartRow,
    columns,
    liveDateCell: (p?.liveDateCell ?? DEFAULT_MASTERLIST_MAPPING.liveDateCell).toString().trim().toUpperCase(),
    pageCell: (p?.pageCell ?? DEFAULT_MASTERLIST_MAPPING.pageCell).toString().trim().toUpperCase(),
    liverNameLabel: (p?.liverNameLabel ?? DEFAULT_MASTERLIST_MAPPING.liverNameLabel).toString(),
    rateLabel: (p?.rateLabel ?? DEFAULT_MASTERLIST_MAPPING.rateLabel).toString(),
    rateCell: (p?.rateCell ?? "").toString().trim().toUpperCase(),
    priceMode: p?.priceMode === "rate_plus_mc" ? "rate_plus_mc" : "rate",
    defaultCategory: (p?.defaultCategory ?? "").toString().trim(),
    mcCategories: normalizeMcCategories(p?.mcCategories),
    roundRateUp: p?.roundRateUp === true,
    liverCell: (p?.liverCell ?? "").toString().trim().toUpperCase(),
    defaultTog: (p?.defaultTog ?? "").toString().trim(),
  };
}

/** Keys are MC numbers as plain strings ("21", "28.5"); blank entries dropped. */
function normalizeMcCategories(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = parseFloat(String(k).replace(/[,\s]/g, ""));
    const cat = String(v ?? "").trim();
    if (Number.isFinite(n) && cat) out[String(n)] = cat;
  }
  return out;
}

/** Category for an MC value from the map ("" if not mapped). */
export function categoryForMc(map: Record<string, string>, mc: number): string {
  if (!mc || !map) return "";
  return map[String(mc)] || "";
}

/**
 * Suggest an MC -> category map from the MC values actually found in a file:
 * lowest = Gold Normal, next = Special Price, next = Special Price EF (anything
 * higher also EF). Just a starting point — editable before saving.
 */
export function suggestMcCategories(mcs: number[]): Record<string, string> {
  const tiers = ["Gold Normal", "Special Price", "Special Price EF"];
  const uniq = [...new Set(mcs.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  const out: Record<string, string> = {};
  uniq.forEach((mc, i) => { out[String(mc)] = tiers[Math.min(i, tiers.length - 1)]; });
  return out;
}

function loadFromCache(): MasterlistMapping {
  if (typeof localStorage === "undefined") return { ...DEFAULT_MASTERLIST_MAPPING };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return { ...DEFAULT_MASTERLIST_MAPPING };
}

export function getMasterlistMapping(): MasterlistMapping {
  return _mapping;
}

export function setMasterlistMapping(m: MasterlistMapping): void {
  _mapping = normalize(m);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_mapping));
  } catch { /* ignore */ }
}

export function applyMasterlistMapping(json: string): void {
  if (!json) return;
  try { setMasterlistMapping(normalize(JSON.parse(json))); } catch { /* ignore */ }
}

export function serializeMasterlistMapping(): string {
  return JSON.stringify(_mapping);
}

// ── Auto-detection from a real file's header row ──────────────────────────────

/** 0-based index -> column letter. 0->"A", 25->"Z", 26->"AA". */
export function indexToCol(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Header keywords per field, in priority order. Processed orderId->minerName so
// "CLIENT NAME" (the code column) is claimed before the plain "Name" column.
const HEADER_ALIASES: { key: MasterlistFieldKey; aliases: string[] }[] = [
  { key: "orderId", aliases: ["code", "client name", "clientname", "order id", "order no", "order"] },
  { key: "minerName", aliases: ["name", "client", "customer", "miner", "reseller"] },
  { key: "itemDescription", aliases: ["description", "desc", "item", "product", "particular"] },
  { key: "currency", aliases: ["currency", "curr"] },
  { key: "category", aliases: ["category", "cat", "type"] },
  { key: "source", aliases: ["source", "location"] },
  { key: "qty", aliases: ["qty", "quantity", "pcs", "pieces"] },
  { key: "tog", aliases: ["tog", "t o g", "gold type", "karat", "carat"] },
  { key: "grams", aliases: ["client grams", "grams", "gram", "weight", "wt"] },
  // Claimed BEFORE clientRate so a "Gold Rate" column isn't taken as the selling rate.
  { key: "goldRate", aliases: ["gold rate", "board rate", "supplier rate", "cost rate"] },
  { key: "clientRate", aliases: ["rate", "unit price", "price per", "selling"] },
  { key: "mc", aliases: ["mc", "making charge", "making", "labor", "labour"] },
  { key: "amount", aliases: ["amount", "total", "subtotal", "price"] },
  { key: "remarks", aliases: ["remarks", "remark", "notes", "note", "comment"] },
  { key: "clientAddress", aliases: ["address", "delivery"] },
  { key: "clientNumber", aliases: ["number", "contact", "phone", "mobile"] },
];

function scoreHeaderRow(cells: unknown[]): number {
  const normed = cells.map(norm);
  let score = 0;
  for (const { aliases } of HEADER_ALIASES) {
    if (normed.some((c) => c && aliases.some((a) => c.includes(a)))) score++;
  }
  return score;
}

export interface DetectResult {
  mapping: MasterlistMapping;
  headerRowIndex: number; // 0-based
  headerRow: string[];
  assigned: Partial<Record<MasterlistFieldKey, string>>; // field -> column letter
}

/**
 * Look at a parsed grid (array of rows), find the row that looks like the header,
 * and match each field to its column by title. Returns null if no header found.
 */
export function detectMapping(grid: unknown[][]): DetectResult | null {
  const scanTo = Math.min(15, grid.length);
  let bestRow = -1;
  let bestScore = 0;
  for (let r = 0; r < scanTo; r++) {
    const s = scoreHeaderRow(grid[r] || []);
    if (s > bestScore) { bestScore = s; bestRow = r; }
  }
  if (bestRow < 0 || bestScore < 4) return null; // not confident enough

  const header = (grid[bestRow] || []).map(norm);
  const rawHeader = (grid[bestRow] || []).map((c) => String(c ?? "").trim());
  const columns = { ...DEFAULT_MASTERLIST_MAPPING.columns };
  const assigned: Partial<Record<MasterlistFieldKey, string>> = {};
  const takenCols = new Set<number>();

  // Blank every column first, then fill only what we detect.
  (Object.keys(columns) as MasterlistFieldKey[]).forEach((k) => { columns[k] = ""; });

  for (const { key, aliases } of HEADER_ALIASES) {
    let foundCol = -1;
    // exact match first, then "includes"
    for (const exact of [true, false]) {
      for (let c = 0; c < header.length; c++) {
        if (takenCols.has(c) || !header[c]) continue;
        // Very short aliases ("mc", "wt") only match a whole word, never inside
        // another header, so e.g. "MC" can't grab an unrelated column.
        const hit = exact
          ? aliases.some((a) => header[c] === a)
          : aliases.some((a) => (a.length <= 2 ? header[c].split(" ").includes(a) : header[c].includes(a)));
        if (hit) { foundCol = c; break; }
      }
      if (foundCol >= 0) break;
    }
    if (foundCol >= 0) {
      takenCols.add(foundCol);
      const letter = indexToCol(foundCol);
      columns[key] = letter;
      assigned[key] = letter;
    }
  }

  // Rate + MC layout (e.g. Crown): "RATE" is the gold rate and there is an MC
  // column but no separate selling-rate column -> sell = rate + MC per gram.
  let priceMode: PriceMode = "rate";
  if (columns.mc && columns.clientRate && !columns.goldRate) {
    priceMode = "rate_plus_mc";
    columns.goldRate = columns.clientRate;
    assigned.goldRate = columns.clientRate;
  }

  const meta = detectMeta(grid, bestRow);
  const hasLiverLabel = grid.slice(0, bestRow).some((row) =>
    (row || []).some((c) => String(c ?? "").toUpperCase().includes(DEFAULT_MASTERLIST_MAPPING.liverNameLabel)));

  const mapping: MasterlistMapping = normalize({
    ...DEFAULT_MASTERLIST_MAPPING,
    dataStartRow: bestRow + 2, // 1-based row right after the header
    columns,
    liveDateCell: meta.liveDateCell,
    pageCell: meta.pageCell,
    rateCell: meta.rateCell,
    priceMode,
    // Only needed when the file has no Category column.
    defaultCategory: columns.category ? "" : meta.defaultCategory,
    // No "LIVER NAME" label -> the big title (e.g. "AMBIE") is the liver.
    liverCell: hasLiverLabel ? "" : meta.titleCell,
    defaultTog: columns.tog ? "" : meta.karat,
    // Rate + MC lists (gold livers) usually charge a whole-number rate.
    roundRateUp: priceMode === "rate_plus_mc",
  });

  return { mapping, headerRowIndex: bestRow, headerRow: rawHeader, assigned };
}

// ── Header-area metadata (date / page / rate / metal) ─────────────────────────

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_RE = new RegExp(
  `^(?:[a-z]+day,?\\s*)?(?:(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{2,4}|\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\.?,?\\s+\\d{2,4}|\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{1,4})$`,
  "i"
);

function looksLikeDate(v: unknown): boolean {
  return DATE_RE.test(String(v ?? "").trim());
}

function toNumber(v: unknown): number {
  const x = parseFloat(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(x) ? x : NaN;
}

/** Title text with the words "masterlist"/"form" removed ("AMBIE MASTERLIST" -> "AMBIE"). */
export function cleanTitle(v: unknown): string {
  return String(v ?? "").replace(/\bmaster\s*list\b|\bform\b/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Look at the rows ABOVE the header and find where this customer keeps the
 * live date, the page/store title, the sheet-wide rate, and whether it's a
 * GOLD or SILVER list. Anything not found keeps the original default.
 */
function detectMeta(grid: unknown[][], headerRow: number): {
  liveDateCell: string;
  pageCell: string;
  rateCell: string;
  defaultCategory: string;
  titleCell: string;
  karat: string;
} {
  let karat = "";
  let liveDateCell = "";
  let pageCell = "";
  let rateCell = "";
  let defaultCategory = "";

  for (let r = 0; r < headerRow; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const raw = String(row[c] ?? "").trim();
      if (!raw) continue;
      const up = raw.toUpperCase();

      if (!liveDateCell && looksLikeDate(raw)) liveDateCell = indexToCol(c) + (r + 1);

      if (!rateCell && /^(GOLD |SILVER )?RATE\s*:?$/.test(up)) {
        for (let k = 1; k <= 4; k++) {
          if (Number.isFinite(toNumber(row[c + k])) && toNumber(row[c + k]) > 0) {
            rateCell = indexToCol(c + k) + (r + 1);
            break;
          }
        }
      }

      if (!karat && /^\d{2}\s*K(T)?$/.test(up)) karat = up.replace(/\s+/g, "").replace(/KT$/, "K");

      if (!defaultCategory && (up === "GOLD" || up === "SILVER")) {
        defaultCategory = up === "GOLD" ? "Gold Normal" : "Silver Normal";
      }
    }
  }

  // Page/store title: first text in column A of the top rows that isn't just a
  // generic "Masterlist Form" heading or a "Label:".
  for (let r = 0; r < Math.min(3, headerRow); r++) {
    const v = String((grid[r] || [])[0] ?? "").trim();
    if (!v || v.endsWith(":") || looksLikeDate(v)) continue;
    if (!cleanTitle(v)) continue;
    pageCell = "A" + (r + 1);
    break;
  }

  return {
    liveDateCell: liveDateCell || DEFAULT_MASTERLIST_MAPPING.liveDateCell,
    pageCell: pageCell || DEFAULT_MASTERLIST_MAPPING.pageCell,
    rateCell,
    defaultCategory,
    titleCell: pageCell,
    karat,
  };
}
