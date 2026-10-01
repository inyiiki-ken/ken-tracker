"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, ClipboardList, DollarSign } from 'lucide-react';
import { DatabaseRowType } from '@/types';
import { orderedRangeLabel } from '@/lib/formatters';
import { calcProfitAED, calcItemPriceAED, calcItemCostAED, getQty } from '@/lib/calculations';
import { OrderBox, orderBox, boxLabel, isStillWithAdmin } from '@/lib/fulfilment';
import { computeToCancel, hoursInStatus } from '@/lib/reminders';

interface Props {
  records: DatabaseRowType[];
  onClose: () => void;
}

/** Boxes whose items go out, in the order they're printed. */
const REPORT_BOXES: OrderBox[] = ['intl', 'cod', 'pickup', 'reseller'];

/**
 * Box → customer, in work-queue order. One block per box (like the Dispatch
 * work queue), one entry per customer however many livers / branches sold to
 * them; the liver shows as a label on the customer instead.
 */
function groupByBoxThenCustomer(records: DatabaseRowType[]) {
  const grouped = new Map<string, Map<string, DatabaseRowType[]>>();
  const names = new Map<string, string>();
  const sorted = [...records].sort((a, b) => REPORT_BOXES.indexOf(orderBox(a)) - REPORT_BOXES.indexOf(orderBox(b)));
  for (const r of sorted) {
    const box = boxLabel(orderBox(r)).toUpperCase();
    const key = (r.minerName || '').trim().toLowerCase() || 'unknown client';
    if (!names.has(key)) names.set(key, r.minerName?.trim() || 'Unknown Client');
    const name = names.get(key)!;
    if (!grouped.has(box)) grouped.set(box, new Map());
    const byCustomer = grouped.get(box)!;
    if (!byCustomer.has(name)) byCustomer.set(name, []);
    byCustomer.get(name)!.push(r);
  }
  return grouped;
}

/** Livers / branches the items came from, e.g. "AMBIE, Crown Dubai". */
function liversOf(items: DatabaseRowType[]): string {
  return [...new Set(items.map(r => r.liverName?.trim() || r.source?.trim()).filter(Boolean))].join(', ');
}

const isPc = (r: DatabaseRowType) => {
  const c = (r.category || '').toLowerCase();
  return c.includes('per pc') || c.includes('screw type') || c.includes('diamond');
};
const sumGrams = (items: DatabaseRowType[]) => items.reduce((s, r) => isPc(r) ? s : s + (Number(r.grams) || 0), 0);
/** Customer amount (selling price). Items with no rate yet count as 0. */
const sumAmount = (items: DatabaseRowType[]) => items.reduce((s, r) => s + calcItemPriceAED(r), 0);
const unpriced = (items: DatabaseRowType[]) => items.filter(r => calcItemPriceAED(r) <= 0).length;
const aed = (v: number) => `AED ${Math.round(v).toLocaleString()}`;

function gramsDisplay(r: DatabaseRowType): string {
  const cat = (r.category || '').toLowerCase();
  if (cat.includes('per pc') || cat.includes('screw type') || cat.includes('diamond')) return `${getQty(r)} PC`;
  return r.grams ? `${Number(r.grams).toFixed(2)}g` : '—';
}

const SHARED_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #111; background: #fff; margin: 0; padding: 20px; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .font-cinzel { font-family: 'Cinzel', serif; font-weight: 700; }
  .banner { border: 2px solid #dc2626; background: #fee2e2; padding: 6px 16px; text-align: center; font-weight: bold; color: #dc2626; margin-bottom: 14px; font-size: 12px; border-radius: 4px; }
  .meta { font-size: 10px; color: #888; margin-bottom: 16px; }
  .source-block { margin-bottom: 28px; border: 2px solid #111; border-radius: 4px; page-break-inside: avoid; }
  .source-header { background: #111; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 6px; }
  .source-title { font-size: 14px; font-weight: bold; }
  .source-math { display: flex; gap: 20px; flex-wrap: wrap; font-size: 11px; font-weight: bold; }
  .source-math span { white-space: nowrap; }
  .highlight-pay { color: #f87171; }
  .highlight-profit { color: #4ade80; }
  .source-body { padding: 12px 14px; }
  .client-block { margin-bottom: 14px; }
  .client-header { background: #333; color: #fff; padding: 5px 10px; font-size: 12px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; border-radius: 3px; margin-bottom: 0; }
  .client-meta { font-size: 10px; font-weight: normal; color: #ccc; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th { background: #eaeaea; padding: 5px 7px; text-align: left; font-size: 10px; font-weight: bold; border: 1px solid #ccc; }
  td { padding: 5px 7px; border: 1px solid #ddd; font-size: 10px; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f7f7f7; }
  .r { text-align: right; }
  .check-box { width: 14px; height: 14px; border: 1.5px solid #333; display: inline-block; border-radius: 2px; }
  .subtotal-row { background: #e8e8e8 !important; font-weight: bold; border-top: 2px solid #111; }
  .profit-pos { color: #16a34a; }
  .profit-neg { color: #dc2626; }
  .order-id { font-family: monospace; font-size: 9px; color: #555; }
  @media print { button { display: none !important; } }
`;

export default function PulloutReport({ records, onClose }: Props) {
  const [activePreview, setActivePreview] = useState<'dispatch' | 'financial' | null>(null);
  // Everything in a box that's going out (International Shipment, COD, Pick Up, Reseller).
  const forPullout = records.filter(r =>
    String(r.status || '').trim() && !isStillWithAdmin(r.status) && REPORT_BOXES.includes(orderBox(r)));
  // Items past their status deadline (Settings → App Settings → Status deadlines).
  const toCancel = computeToCancel(records);
  const toCancelCount = toCancel.reduce((n, s) => n + s.items.length, 0);
  const cancelHtml = () => {
    if (!toCancelCount) return '';
    let h = `<div class="source-block" style="border-color:#dc2626"><div class="source-header" style="background:#dc2626">
      <span class="source-title">⚠ NEEDS TO BE CANCELLED — past deadline</span>
      <div class="source-math"><span>Items: ${toCancelCount}</span></div></div><div class="source-body">`;
    for (const sec of toCancel) {
      h += `<div class="client-block"><div class="client-header"><span>${sec.rule.status} — over ${sec.rule.days} day${sec.rule.days === 1 ? '' : 's'}</span><span class="client-meta">${sec.items.length} item${sec.items.length !== 1 ? 's' : ''}</span></div>
        <table><thead><tr><th style="width:28px">Done</th><th>Order ID</th><th>Client</th><th>Item Description</th><th class="r">Grams</th><th>Liver</th><th class="r">Days</th></tr></thead><tbody>`;
      for (const r of sec.items) {
        h += `<tr><td style="text-align:center"><div class="check-box"></div></td><td class="order-id">${r.orderId || `#${r.id}`}</td><td>${r.minerName || '—'}</td><td>${r.itemDescription || '—'}</td><td class="r">${gramsDisplay(r)}</td><td>${r.liverName || '—'}</td><td class="r">${Math.floor(hoursInStatus(r) / 24)}</td></tr>`;
      }
      h += `</tbody></table></div>`;
    }
    return h + `</div></div>`;
  };
  const grouped = groupByBoxThenCustomer(forPullout);

  const printDispatchSheet = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    let html = `<html><head><title>Dispatch Pullout Sheet</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap" rel="stylesheet">
      <style>${SHARED_STYLES}</style></head><body>
      <h1 class="font-cinzel" style="font-size:20px;margin:0 0 4px;">PULLOUT / DISPATCH SHEET</h1>
      <p class="meta">⚠ INTERNAL USE ONLY — DO NOT SEND TO CLIENT &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; ${forPullout.length} items${toCancelCount ? ` &nbsp;|&nbsp; ${toCancelCount} to cancel` : ''}</p>`;

    grouped.forEach((byMiner, source) => {
      const allItems = Array.from(byMiner.values()).flat();
      const totalGrams = allItems.reduce((s, r) => {
        const c = (r.category || '').toLowerCase();
        return c.includes('per pc') || c.includes('screw type') || c.includes('diamond') ? s : s + (Number(r.grams) || 0);
      }, 0);

      html += `<div class="source-block">
        <div class="source-header">
          <span class="source-title">📦 ${source}</span>
          <div class="source-math">
            <span>Items: ${allItems.length}</span>
            <span>Total Grams: ${totalGrams.toFixed(2)}g</span>
          </div>
        </div>
        <div class="source-body">`;

      byMiner.forEach((items, miner) => {
        const minerGrams = items.reduce((s, r) => {
          const c = (r.category || '').toLowerCase();
          return c.includes('per pc') || c.includes('screw type') || c.includes('diamond') ? s : s + (Number(r.grams) || 0);
        }, 0);
        const dates = orderedRangeLabel(items);
        const livers = liversOf(items);

        html += `<div class="client-block">
          <div class="client-header">
            <span>${miner}</span>
            <span class="client-meta">${livers ? `${livers} &nbsp;·&nbsp; ` : ''}${dates} &nbsp;·&nbsp; ${items.length} item${items.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${minerGrams.toFixed(2)}g</span>
          </div>
          <table><thead><tr>
            <th style="width:28px">Pull</th>
            <th>Order ID</th>
            <th>Item Description</th>
            <th class="r">Grams</th>
            <th>Liver / Source</th>
          </tr></thead><tbody>`;

        items.forEach(r => {
          html += `<tr>
            <td style="text-align:center"><div class="check-box"></div></td>
            <td class="order-id">${r.orderId || `#${r.id}`}</td>
            <td>${r.itemDescription || '—'}</td>
            <td class="r">${gramsDisplay(r)}</td>
            <td>${r.liverName || r.source || '—'}</td>
          </tr>`;
        });

        html += `</tbody></table></div>`;
      });

      html += `</div></div>`;
    });

    html += cancelHtml();
    html += `</body></html>`;
    win.document.write(html);
    win.document.close();
    win.print();
  };

  const printFinancialReport = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const grandTotal = { price: 0, cost: 0, profit: 0 };

    let html = `<html><head><title>Pullout Financial Report</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap" rel="stylesheet">
      <style>${SHARED_STYLES}</style></head><body>
      <h1 class="font-cinzel" style="font-size:20px;margin:0 0 4px;">PULLOUT FINANCIAL REPORT</h1>
      <p class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; ${forPullout.length} items for pullout</p>`;

    grouped.forEach((byMiner, source) => {
      const allItems = Array.from(byMiner.values()).flat();
      const sPrice = allItems.reduce((s, r) => s + calcItemPriceAED(r), 0);
      const sCost = allItems.reduce((s, r) => s + calcItemCostAED(r), 0);
      const sProfit = allItems.reduce((s, r) => s + calcProfitAED(r), 0);
      const sGrams = allItems.reduce((s, r) => {
        const c = (r.category || '').toLowerCase();
        return c.includes('per pc') || c.includes('screw type') || c.includes('diamond') ? s : s + (Number(r.grams) || 0);
      }, 0);
      grandTotal.price += sPrice;
      grandTotal.cost += sCost;
      grandTotal.profit += sProfit;

      html += `<div class="source-block">
        <div class="source-header">
          <span class="source-title">📦 ${source}</span>
          <div class="source-math">
            <span>Grams: ${sGrams.toFixed(2)}g</span>
            <span class="highlight-pay">To Pay: AED ${sCost.toFixed(2)}</span>
            <span class="highlight-profit">Profit: AED ${sProfit.toFixed(2)}</span>
          </div>
        </div>
        <div class="source-body">`;

      byMiner.forEach((items, miner) => {
        const mPrice = items.reduce((s, r) => s + calcItemPriceAED(r), 0);
        const mCost = items.reduce((s, r) => s + calcItemCostAED(r), 0);
        const mProfit = items.reduce((s, r) => s + calcProfitAED(r), 0);
        const mGrams = items.reduce((s, r) => {
          const c = (r.category || '').toLowerCase();
          return c.includes('per pc') || c.includes('screw type') || c.includes('diamond') ? s : s + (Number(r.grams) || 0);
        }, 0);
        const dates = orderedRangeLabel(items);

        html += `<div class="client-block">
          <div class="client-header">
            <span>${miner}</span>
            <span class="client-meta">${dates} &nbsp;·&nbsp; ${items.length} item${items.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${mGrams.toFixed(2)}g</span>
          </div>
          <table><thead><tr>
            <th style="width:28px">Pull</th>
            <th>Order ID</th>
            <th>Item Description</th>
            <th class="r">Grams</th>
            <th class="r">Price (AED)</th>
            <th class="r">Cost (AED)</th>
            <th class="r">Profit (AED)</th>
          </tr></thead><tbody>`;

        items.forEach(r => {
          const pr = calcProfitAED(r);
          html += `<tr>
            <td style="text-align:center"><div class="check-box"></div></td>
            <td class="order-id">${r.orderId || `#${r.id}`}</td>
            <td>${r.itemDescription || '—'}</td>
            <td class="r">${gramsDisplay(r)}</td>
            <td class="r">${calcItemPriceAED(r).toFixed(2)}</td>
            <td class="r">${calcItemCostAED(r).toFixed(2)}</td>
            <td class="r ${pr >= 0 ? 'profit-pos' : 'profit-neg'}">${pr.toFixed(2)}</td>
          </tr>`;
        });

        html += `<tr class="subtotal-row">
          <td colspan="4">${miner} — Subtotal (${items.length} items)</td>
          <td class="r">${mPrice.toFixed(2)}</td>
          <td class="r">${mCost.toFixed(2)}</td>
          <td class="r ${mProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${mProfit.toFixed(2)}</td>
        </tr>`;

        html += `</tbody></table></div>`;
      });

      html += `</div></div>`;
    });

    // Grand Total
    html += `<div style="margin-top:20px;border:2px solid #111;padding:12px 16px;border-radius:4px;background:#f9f9f9;">
      <strong style="font-size:13px;">GRAND TOTAL — ${forPullout.length} items</strong>
      <div style="display:flex;gap:24px;margin-top:6px;font-size:12px;font-weight:bold;">
        <span>Total Price: AED ${grandTotal.price.toFixed(2)}</span>
        <span style="color:#dc2626">Total Cost: AED ${grandTotal.cost.toFixed(2)}</span>
        <span style="color:#16a34a">Total Profit: AED ${grandTotal.profit.toFixed(2)}</span>
      </div>
    </div>`;

    html += `</body></html>`;
    win.document.write(html);
    win.document.close();
    win.print();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary text-base">Pullout Report</DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1">
          <p className="text-xs text-muted-foreground font-medium">
            {forPullout.length} items to pull out · {aed(sumAmount(forPullout))}
          </p>
          {forPullout.length === 0 && (
            <p className="text-xs text-muted-foreground">No items in For International Shipment, For COD, For Pick Up or Reseller.</p>
          )}
        </div>

        {/* One block per box, one row per customer (same as the work queue) */}
        {grouped.size > 0 && (
          <div className="space-y-3">
            {Array.from(grouped.entries()).map(([box, byCustomer]) => {
              const allItems = Array.from(byCustomer.values()).flat();
              const noRate = unpriced(allItems);
              return (
                <div key={box} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-secondary/50 flex justify-between items-center gap-2">
                    <span className="font-cinzel text-xs font-bold text-primary">{box}</span>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>{byCustomer.size} customer{byCustomer.size !== 1 ? 's' : ''}</span>
                      <span>{allItems.length} item{allItems.length !== 1 ? 's' : ''}</span>
                      <span>{sumGrams(allItems).toFixed(2)}g</span>
                      <span className="font-semibold text-foreground">{aed(sumAmount(allItems))}</span>
                    </div>
                  </div>
                  {noRate > 0 && (
                    <p className="px-3 pt-1.5 text-[10px] text-warning">{noRate} item{noRate !== 1 ? 's have' : ' has'} no rate yet, so {noRate !== 1 ? 'they are' : 'it is'} not in the amount.</p>
                  )}
                  <div className="divide-y divide-border/50">
                    {Array.from(byCustomer.entries()).map(([customer, items]) => {
                      const livers = liversOf(items);
                      const amt = sumAmount(items);
                      return (
                        <div key={customer} className="px-3 py-1.5 flex justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <span className="font-medium">{customer}</span>
                            {livers && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{livers}</span>}
                            <p className="text-[10px] text-muted-foreground">{orderedRangeLabel(items)}</p>
                          </div>
                          <div className="text-right shrink-0 text-muted-foreground">
                            <p>{items.length} item{items.length !== 1 ? 's' : ''} · {sumGrams(items).toFixed(2)}g</p>
                            <p className="text-foreground font-medium">{amt > 0 ? aed(amt) : 'No rate yet'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Past deadline → cancel */}
        {toCancelCount > 0 && (
          <div className="rounded-lg border border-destructive/40 overflow-hidden">
            <div className="px-3 py-2 bg-destructive/10 flex justify-between items-center">
              <span className="font-cinzel text-xs font-bold text-destructive">Needs to be cancelled — past deadline</span>
              <span className="text-[10px] text-destructive">{toCancelCount} item{toCancelCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="px-3 py-2 space-y-2">
              {toCancel.map(sec => (
                <div key={sec.rule.status}>
                  <p className="text-[11px] font-semibold text-muted-foreground">{sec.rule.status} — over {sec.rule.days} day{sec.rule.days === 1 ? '' : 's'}</p>
                  {sec.items.map(r => (
                    <div key={r.id} className="flex justify-between gap-2 text-xs">
                      <span className="truncate"><b>{r.minerName || '—'}</b> · {[r.orderId, r.itemDescription].filter(Boolean).join(' · ')}</span>
                      <span className="text-muted-foreground shrink-0">{r.liverName || '—'} · {Math.floor(hoursInStatus(r) / 24)}d</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Two print buttons */}
        <div className="grid grid-cols-1 gap-3 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground font-medium">Choose what to print:</p>

          <button
            onClick={printDispatchSheet}
            disabled={forPullout.length === 0 && toCancelCount === 0}
            className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 hover:bg-primary/10 transition-colors text-left disabled:opacity-50"
          >
            <ClipboardList className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Dispatch Sheet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Checklist for dispatchers — shows Order ID, Item, Grams, Liver. Hides all prices & costs. Safe to share with floor staff.
              </p>
            </div>
            <Printer className="h-4 w-4 text-primary shrink-0 mt-0.5 ml-auto" />
          </button>

          <button
            onClick={printFinancialReport}
            disabled={forPullout.length === 0}
            className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 hover:bg-warning/10 transition-colors text-left disabled:opacity-50"
          >
            <DollarSign className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">Financial / Audit Report</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Full financials — grouped by box with supplier payout totals, client subtotals, and per-item profit. For boss & accounts only.
              </p>
            </div>
            <Printer className="h-4 w-4 text-warning shrink-0 mt-0.5 ml-auto" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
