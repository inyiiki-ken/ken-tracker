import type { DatabaseRowType } from "@/types";
import {
  calcItemPriceAED,
  calcItemCostAED,
  calcProfitAED,
  calcRemainingBalance,
} from "@/lib/calculations";

/**
 * Data export helpers for the Bossing dashboard. Produces a spreadsheet-ready
 * CSV of the currently-filtered records, including the same computed AED
 * price/cost/profit figures shown in the UI, so the numbers reconcile exactly
 * with what's on screen. Complements the existing HTML "Print Report".
 */

const EXPORT_COLUMNS: { header: string; value: (r: DatabaseRowType) => string | number }[] = [
  { header: "Order ID", value: (r) => r.orderId ?? "" },
  { header: "Date of Live", value: (r) => r.dateOfLive ?? "" },
  { header: "Delivered Date", value: (r) => r.deliveredDate ?? "" },
  { header: "Page", value: (r) => r.page ?? "" },
  { header: "Liver", value: (r) => r.liverName ?? "" },
  { header: "Miner Name", value: (r) => r.minerName ?? "" },
  { header: "Item Description", value: (r) => r.itemDescription ?? "" },
  { header: "Category", value: (r) => r.category ?? "" },
  { header: "Source", value: (r) => r.source ?? "" },
  { header: "Currency", value: (r) => r.currency ?? "" },
  { header: "Grams", value: (r) => r.grams ?? "" },
  { header: "QTY", value: (r) => r.qty ?? "" },
  { header: "Status", value: (r) => r.status ?? "" },
  { header: "Mode of Payment", value: (r) => r.modeOfPayment ?? "" },
  { header: "Price AED", value: (r) => round2(calcItemPriceAED(r)) },
  { header: "Cost AED", value: (r) => round2(calcItemCostAED(r)) },
  { header: "Profit AED", value: (r) => round2(calcProfitAED(r)) },
  { header: "Remaining AED", value: (r) => round2(Math.max(0, calcRemainingBalance(r))) },
  { header: "Customer ID", value: (r) => r.customerId ?? "" },
];

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** RFC-4180 field escaping: wrap in quotes and double any embedded quotes when
 * the value contains a comma, quote, or newline. */
function escapeCsv(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function recordsToCsv(records: DatabaseRowType[]): string {
  const head = EXPORT_COLUMNS.map((c) => escapeCsv(c.header)).join(",");
  const body = records
    .map((r) => EXPORT_COLUMNS.map((c) => escapeCsv(c.value(r))).join(","))
    .join("\r\n");
  // Leading BOM so Excel opens UTF-8 (peso/dirham symbols, ñ) correctly.
  return `﻿${head}\r\n${body}`;
}

/** Triggers a browser download of the given CSV text. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convenience: build a dated filename like "myk-report-2026-07-25.csv". */
export function reportFilename(prefix = "myk-report"): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `${prefix}-${stamp}.csv`;
}
