import * as XLSX from "xlsx";
import type { DataOptions } from "@/lib/api";
import {
  DEFAULT_MASTERLIST_MAPPING,
  MASTERLIST_FIELD_LABELS,
  cellToRC,
  colToIndex,
  type MasterlistFieldKey,
  type MasterlistMapping,
} from "@/lib/masterlistMapping";

/**
 * Generates a BLANK masterlist template (.xlsx) laid out by THIS tenant's own
 * masterlist import mapping (Settings → Masterlist import), so whatever staff
 * fill in re-uploads cleanly. Nothing here is specific to any one customer:
 * page names and dropdown lists come from the tenant's own "DATA'S" tab.
 *
 * Used by "Export Masterlist" when the tenant hasn't uploaded their own styled
 * template (Settings → Masterlist Template).
 */

// Header text per field. Short, Excel-style names the importer's auto-detect
// also recognises.
const HEADER_TEXT: Partial<Record<MasterlistFieldKey, string>> = {
  orderId: "Code",
  minerName: "Name",
  itemDescription: "DESCRIPTION",
  currency: "Currency",
  category: "Category",
  source: "Source",
  qty: "Qty",
  tog: "T.O.G",
  grams: "Grams",
  clientRate: "Rate",
  amount: "Amount",
  remarks: "Remarks",
  clientAddress: "Address",
  clientNumber: "Number",
  mc: "MC",
  goldRate: "Gold Rate",
};

type Grid = Map<number, Map<number, string | number>>;

function put(grid: Grid, row: number, col: number, v: string | number): void {
  if (row < 0 || col < 0) return;
  if (!grid.has(row)) grid.set(row, new Map());
  grid.get(row)!.set(col, v);
}

function taken(grid: Grid, row: number, col: number): boolean {
  return grid.get(row)?.has(col) ?? false;
}

/** First free cell in the rows above the header (importer scans the first 5 rows). */
function freeCell(grid: Grid, maxRow: number, needRight: boolean, reserved: Set<string>): { row: number; col: number } | null {
  for (let r = 0; r < maxRow; r++) {
    for (let c = 0; c < 12; c++) {
      const ok = !taken(grid, r, c) && !reserved.has(`${r}:${c}`)
        && (!needRight || (!taken(grid, r, c + 1) && !reserved.has(`${r}:${c + 1}`)));
      if (ok) return { row: r, col: c };
    }
  }
  return null;
}

function buildPageSheet(pageName: string, dateStr: string, rowCount: number, m: MasterlistMapping): XLSX.WorkSheet {
  const grid: Grid = new Map();
  const dataStart = Number.isFinite(m.dataStartRow) && m.dataStartRow > 0 ? Math.floor(m.dataStartRow) - 1 : 5;
  const headerRow = dataStart - 1; // -1 => layout has no header row
  const labelRows = Math.max(0, Math.min(5, headerRow < 0 ? dataStart : headerRow));

  // Cells the tenant's layout reads values from must stay as values.
  const reserved = new Set<string>();
  const page = cellToRC(m.pageCell);
  const date = cellToRC(m.liveDateCell);
  const liver = cellToRC(m.liverCell);
  const rate = cellToRC(m.rateCell);
  if (page) put(grid, page.row, page.col, pageName);
  if (date) put(grid, date.row, date.col, dateStr);
  if (liver) reserved.add(`${liver.row}:${liver.col}`);
  if (rate) reserved.add(`${rate.row}:${rate.col}`);

  // Header row, one label per mapped column.
  const fieldCols: number[] = [];
  if (headerRow >= 0) {
    for (const { key } of MASTERLIST_FIELD_LABELS) {
      const c = colToIndex(m.columns[key]);
      if (c < 0 || taken(grid, headerRow, c)) continue; // e.g. Rate and Gold Rate share a column
      put(grid, headerRow, c, HEADER_TEXT[key] ?? key);
      fieldCols.push(c);
    }
    // Row numbers in column A when the layout leaves it free.
    if (!fieldCols.includes(0) && !taken(grid, headerRow, 0)) {
      put(grid, headerRow, 0, "No.");
      for (let i = 1; i <= rowCount; i++) put(grid, dataStart + i - 1, 0, i);
    }
  }

  // Title, when A1 isn't used by the layout.
  if (!taken(grid, 0, 0) && !reserved.has("0:0") && headerRow > 0) put(grid, 0, 0, "Masterlist Form");
  if (date && date.col > 0 && !taken(grid, date.row, date.col - 1)) put(grid, date.row, date.col - 1, "Date:");

  // Labels so staff know where to type the liver name and the rate.
  const labelLeftOf = (cell: { row: number; col: number } | null, label: string) => {
    if (cell) {
      if (cell.col > 0 && !taken(grid, cell.row, cell.col - 1)) put(grid, cell.row, cell.col - 1, label);
      return;
    }
    // No fixed cell: the importer finds the value to the right of the label.
    const spot = freeCell(grid, labelRows, true, reserved);
    if (spot) {
      put(grid, spot.row, spot.col, label);
      reserved.add(`${spot.row}:${spot.col + 1}`);
    }
  };
  if (labelRows > 0 || liver) labelLeftOf(liver, m.liverNameLabel || DEFAULT_MASTERLIST_MAPPING.liverNameLabel);
  if (labelRows > 0 || rate) labelLeftOf(rate, `${m.rateLabel || DEFAULT_MASTERLIST_MAPPING.rateLabel}:`);

  const maxRow = Math.max(dataStart + rowCount - 1, ...grid.keys());
  let maxCol = 0;
  grid.forEach((cols) => cols.forEach((_, c) => { if (c > maxCol) maxCol = c; }));
  const aoa: (string | number)[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row: (string | number)[] = [];
    for (let c = 0; c <= maxCol; c++) row.push(grid.get(r)?.get(c) ?? "");
    aoa.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = Array.from({ length: maxCol + 1 }, (_, c) => {
    const h = headerRow >= 0 ? String(grid.get(headerRow)?.get(c) ?? "") : "";
    return { wch: Math.max(10, h.length + 2) };
  });
  return ws;
}

function buildDataSheet(opts: DataOptions): XLSX.WorkSheet {
  const header = ["Item Description", "", "Currency", "Category", "SOURCE", "T.O.G", "LIVER", "PAGES"];
  const cols = [
    opts.itemDescriptions,
    [] as string[],
    opts.currencies,
    opts.categories,
    opts.sources,
    opts.tog,
    opts.livers,
    opts.pages,
  ];
  const maxLen = Math.max(1, ...cols.map((c) => c.length));
  const aoa: string[][] = [header];
  for (let r = 0; r < maxLen; r++) {
    aoa.push(cols.map((c) => c[r] ?? ""));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  return ws;
}

/** Excel tab names can't exceed 31 chars or contain : \ / ? * [ ]. */
function safeSheetName(name: string, fallback: string): string {
  const cleaned = (name || fallback).replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned || fallback;
}

export function buildMasterlistWorkbook(
  opts: DataOptions,
  mapping: MasterlistMapping = DEFAULT_MASTERLIST_MAPPING,
  rowCount = 50,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split("T")[0];

  const pages = opts.pages.length > 0 ? opts.pages : ["MASTERLIST"];
  const used = new Set<string>();
  pages.forEach((page, idx) => {
    let name = safeSheetName(page, `PAGE ${idx + 1}`);
    while (used.has(name.toLowerCase())) name = safeSheetName(`${name} ${idx + 1}`, `PAGE ${idx + 1}`);
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, buildPageSheet(page, today, rowCount, mapping), name);
  });

  XLSX.utils.book_append_sheet(wb, buildDataSheet(opts), "DATA'S");
  return wb;
}

/** The workbook as an .xlsx Blob (for downloadBlob, which also works in Electron). */
export function masterlistTemplateBlob(opts: DataOptions, mapping?: MasterlistMapping, rowCount = 50): Blob {
  const wb = buildMasterlistWorkbook(opts, mapping, rowCount);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
