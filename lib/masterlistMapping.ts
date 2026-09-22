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
  | "clientNumber";

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
  },
  liveDateCell: "C4",
  pageCell: "A2",
  liverNameLabel: "LIVER NAME",
  rateLabel: "GOLD RATE",
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
  };
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
  { key: "grams", aliases: ["client grams", "grams", "gram", "weight"] },
  { key: "clientRate", aliases: ["rate", "unit price", "price per", "selling"] },
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
        const hit = exact
          ? aliases.some((a) => header[c] === a)
          : aliases.some((a) => header[c].includes(a));
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

  const mapping: MasterlistMapping = normalize({
    ...DEFAULT_MASTERLIST_MAPPING,
    dataStartRow: bestRow + 2, // 1-based row right after the header
    columns,
  });

  return { mapping, headerRowIndex: bestRow, headerRow: rawHeader, assigned };
}
