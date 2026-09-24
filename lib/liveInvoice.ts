"use client";

import type { BrandSettings } from "@/lib/brandSettings";
import { fmtDate, type LiveItem } from "@/lib/liveSellers";

/**
 * Printable invoice for the Live Sellers tab. Two kinds:
 *   "hold"  — statement of everything still on hold in a seller's container
 *   "final" — the items pulled out (sold) under one invoice number
 * Opens in a new window and prints, same as the main invoice.
 */

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function buildLiveInvoiceHtml(opts: {
  kind: "hold" | "final";
  seller: string;
  items: LiveItem[];
  currency: string;
  invoiceNo?: string;
  date: string; // ISO
  brand: BrandSettings;
  logo?: string | null;
}): string {
  const { kind, seller, items, currency, brand, logo } = opts;
  const money = (n: number) => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
  const amountOf = (i: LiveItem) => (kind === "final" && i.status === "Sold" ? i.paidAmount : i.amount);
  const total = items.reduce((s, i) => s + amountOf(i), 0);
  const grams = items.reduce((s, i) => s + i.grams, 0);
  const address = brand.invoiceAddress || brand.location || "";
  const title = kind === "hold" ? "ON-HOLD STATEMENT" : "INVOICE";
  const rows = items
    .map(
      (i, idx) => `<tr>
        <td>${idx + 1}</td>
        <td>${esc(fmtDate(i.liveDate))}</td>
        <td>${esc(i.description || "—")}</td>
        <td>${esc(i.type || "—")}</td>
        <td class="r">${i.grams.toFixed(2)}</td>
        <td class="r">${i.rate ? i.rate.toLocaleString("en-US") : "—"}</td>
        <td class="r">${money(amountOf(i))}</td>
      </tr>`
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)} - ${esc(seller)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .brand { display: flex; gap: 10px; align-items: center; }
  .brand img { width: 56px; height: 56px; object-fit: contain; }
  .brand h1 { margin: 0; font-size: 18px; letter-spacing: .08em; }
  .muted { color: #555; }
  .title { text-align: right; }
  .title h2 { margin: 0; font-size: 18px; letter-spacing: .12em; }
  .meta { display: flex; justify-content: space-between; margin: 14px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #111; padding: 6px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #ddd; }
  .r { text-align: right; }
  .tot td { font-weight: bold; font-size: 14px; border-top: 2px solid #111; border-bottom: none; }
  .note { margin-top: 18px; font-size: 11px; color: #555; }
  .stamp { display: inline-block; border: 2px solid ${kind === "hold" ? "#a15c00" : "#1f7a3a"}; color: ${kind === "hold" ? "#a15c00" : "#1f7a3a"}; padding: 2px 8px; font-weight: bold; letter-spacing: .1em; margin-top: 4px; }
</style></head><body>
<div class="head">
  <div class="brand">
    ${logo ? `<img src="${logo}" alt="">` : ""}
    <div>
      <h1>${esc(brand.companyName.toUpperCase())} ${esc(brand.legalSuffix || "")}</h1>
      ${address ? `<div class="muted">${esc(address)}</div>` : ""}
      ${brand.invoiceContact ? `<div class="muted">${esc(brand.invoiceContact)}</div>` : ""}
    </div>
  </div>
  <div class="title">
    <h2>${title}</h2>
    ${opts.invoiceNo ? `<div>No. <b>${esc(opts.invoiceNo)}</b></div>` : ""}
    <div>${esc(fmtDate(opts.date))}</div>
    <div class="stamp">${kind === "hold" ? "ON HOLD" : "PAID / PULLED OUT"}</div>
  </div>
</div>
<div class="meta">
  <div><div class="muted">Live seller</div><div style="font-size:15px;font-weight:bold">${esc(seller)}</div></div>
  <div class="r"><div class="muted">Items</div><div><b>${items.length}</b> pcs · <b>${grams.toFixed(2)} g</b></div></div>
</div>
<table>
  <thead><tr><th>#</th><th>Live date</th><th>Description</th><th>Type</th><th class="r">Grams</th><th class="r">Rate/g</th><th class="r">Amount</th></tr></thead>
  <tbody>${rows}
  <tr class="tot"><td colspan="4">TOTAL</td><td class="r">${grams.toFixed(2)}</td><td></td><td class="r">${money(total)}</td></tr>
  </tbody>
</table>
<div class="note">${
    kind === "hold"
      ? "These items are on hold in the seller's container. They are counted as sold only when pulled out."
      : "Thank you. Items listed above were pulled out and paid."
  }</div>
</body></html>`;
}

export function printHtml(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
  return true;
}
