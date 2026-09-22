"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, ClipboardList, DollarSign } from 'lucide-react';
import { DatabaseRowType } from '@/types';
import { formatDate } from '@/lib/formatters';
import { calcProfitAED, calcItemPriceAED, calcItemCostAED, getQty } from '@/lib/calculations';

interface Props {
  records: DatabaseRowType[];
  onClose: () => void;
}

function groupBySourceThenMiner(records: DatabaseRowType[]) {
  const grouped = new Map<string, Map<string, DatabaseRowType[]>>();
  for (const r of records) {
    const source = r.source?.trim() || r.liverName?.trim() || 'Main Store';
    const miner = r.minerName?.trim() || 'Unknown Client';
    if (!grouped.has(source)) grouped.set(source, new Map());
    const bySource = grouped.get(source)!;
    if (!bySource.has(miner)) bySource.set(miner, []);
    bySource.get(miner)!.push(r);
  }
  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

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
  const forPullout = records.filter(r => r.status === 'For Pullout' || r.status === 'Dispatch');
  const grouped = groupBySourceThenMiner(forPullout);

  const printDispatchSheet = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    let html = `<html><head><title>Dispatch Pullout Sheet</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap" rel="stylesheet">
      <style>${SHARED_STYLES}</style></head><body>
      <h1 class="font-cinzel" style="font-size:20px;margin:0 0 4px;">PULLOUT / DISPATCH SHEET</h1>
      <p class="meta">⚠ INTERNAL USE ONLY — DO NOT SEND TO CLIENT &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; ${forPullout.length} items</p>`;

    grouped.forEach((byMiner, source) => {
      const allItems = Array.from(byMiner.values()).flat();
      const totalGrams = allItems.reduce((s, r) => {
        const c = (r.category || '').toLowerCase();
        return c.includes('per pc') || c.includes('screw type') || c.includes('diamond') ? s : s + (Number(r.grams) || 0);
      }, 0);

      html += `<div class="source-block">
        <div class="source-header">
          <span class="source-title">📦 SOURCE: ${source}</span>
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
        const dates = [...new Set(items.map(r => formatDate(r.dateOfLive)).filter(Boolean))].join(', ');

        html += `<div class="client-block">
          <div class="client-header">
            <span>${miner}</span>
            <span class="client-meta">${dates} &nbsp;·&nbsp; ${items.length} item${items.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${minerGrams.toFixed(2)}g</span>
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
            <td>${r.liverName || source}</td>
          </tr>`;
        });

        html += `</tbody></table></div>`;
      });

      html += `</div></div>`;
    });

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
          <span class="source-title">📦 SOURCE: ${source}</span>
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
        const dates = [...new Set(items.map(r => formatDate(r.dateOfLive)).filter(Boolean))].join(', ');

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
            {forPullout.length} items ready for pullout across {grouped.size} source{grouped.size !== 1 ? 's' : ''}
          </p>
          {forPullout.length === 0 && (
            <p className="text-xs text-muted-foreground">No items currently marked "For Pullout" or "Dispatch".</p>
          )}
        </div>

        {/* Source breakdown preview */}
        {grouped.size > 0 && (
          <div className="space-y-3">
            {Array.from(grouped.entries()).map(([source, byMiner]) => {
              const allItems = Array.from(byMiner.values()).flat();
              const totalProfit = allItems.reduce((s, r) => s + calcProfitAED(r), 0);
              const totalGrams = allItems.reduce((s, r) => {
                const c = (r.category || '').toLowerCase();
                return c.includes('per pc') || c.includes('screw type') || c.includes('diamond') ? s : s + (Number(r.grams) || 0);
              }, 0);
              return (
                <div key={source} className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 bg-secondary/50 flex justify-between items-center">
                    <span className="font-cinzel text-xs font-bold text-primary">{source}</span>
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>{allItems.length} items</span>
                      <span>{totalGrams.toFixed(2)}g</span>
                      <span className="text-success font-semibold">AED {totalProfit.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {Array.from(byMiner.entries()).map(([miner, items]) => (
                      <div key={miner} className="flex justify-between text-xs">
                        <span className="font-medium">{miner}</span>
                        <span className="text-muted-foreground">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Two print buttons */}
        <div className="grid grid-cols-1 gap-3 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground font-medium">Choose what to print:</p>

          <button
            onClick={printDispatchSheet}
            disabled={forPullout.length === 0}
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
                Full financials — grouped by Source with supplier payout totals, client subtotals, and per-item profit. For boss & accounts only.
              </p>
            </div>
            <Printer className="h-4 w-4 text-warning shrink-0 mt-0.5 ml-auto" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
