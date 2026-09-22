import * as XLSX from "xlsx";
import type { DataOptions } from "@/lib/api";

/**
 * Generates a BLANK masterlist template (.xlsx) in the exact format the app's
 * uploader expects, so staff can download it, fill it during a live, and
 * re-upload — no need to ask the developer for the form each time.
 *
 * Layout per page sheet (matches lib/masterlistImport.ts parsing):
 *   Row 1: "Masterlist Form"
 *   Row 2: <page name>            (A2 -> page)
 *   Row 3: Location / LIVER NAME label / PAPS
 *   Row 4: Date / <date C4> / TOTAL GRAMS / TOTAL AMOUNT / GOLD RATE: label
 *   Row 5: column headers
 *   Row 6+: numbered blank rows
 * Plus a "DATA'S" sheet listing the valid dropdown options.
 */

const HEADERS = [
  "No.", "Code", "Name", "DESCRIPTION", "Currency", "Category", "Source",
  "Qty", "T.O.G", "Client Grams", "Actual Grams", "Rate", "Amount",
  "Remarks", "Address", "Number",
];

function buildPageSheet(pageName: string, dateStr: string, rowCount: number): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  aoa.push(["Masterlist Form"]);
  aoa.push([pageName]); // A2 -> page
  aoa.push(["Location:", "", "", "", "LIVER NAME", "", "", "", "PAPS"]);
  // index 2 (C) = date; index 13 = GOLD RATE label
  aoa.push(["Date:", "", dateStr, "TOTAL GRAMS", "", "", "TOTAL AMOUNT", "", "", "", "", "", "", "GOLD RATE:"]);
  aoa.push(HEADERS);
  for (let i = 1; i <= rowCount; i++) {
    aoa.push([String(i)]); // "No." filled, rest blank
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
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

export function buildMasterlistWorkbook(opts: DataOptions, rowCount = 50): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const today = new Date().toISOString().split("T")[0];

  const pages = opts.pages.length > 0 ? opts.pages : ["MASTERLIST"];
  const used = new Set<string>();
  pages.forEach((page, idx) => {
    let name = safeSheetName(page, `PAGE ${idx + 1}`);
    while (used.has(name.toLowerCase())) name = safeSheetName(`${name} ${idx + 1}`, `PAGE ${idx + 1}`);
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, buildPageSheet(page, today, rowCount), name);
  });

  XLSX.utils.book_append_sheet(wb, buildDataSheet(opts), "DATA'S");
  return wb;
}

export function downloadMasterlistTemplate(opts: DataOptions, filename?: string, rowCount = 50): void {
  const wb = buildMasterlistWorkbook(opts, rowCount);
  const stamp = new Date().toISOString().split("T")[0];
  XLSX.writeFile(wb, filename || `Masterlist-Template-${stamp}.xlsx`);
}
