"use client";

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer } from 'lucide-react';
import { DatabaseRowType } from '@/types';
import { formatDate } from '@/lib/formatters';
import { getQty } from '@/lib/calculations';
import { orderBox, cancelDay } from '@/lib/fulfilment';
import { SHARED_STYLES } from './PulloutReport';

interface Props {
  records: DatabaseRowType[];
  onClose: () => void;
}

const ALL = '__all__';

/** yyyy-mm-dd for today, in the viewer's local time (same as cancelDay). */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const isPc = (r: DatabaseRowType) => {
  const c = (r.category || '').toLowerCase();
  return c.includes('per pc') || c.includes('screw type') || c.includes('diamond');
};
const gramsDisplay = (r: DatabaseRowType) => isPc(r) ? `${getQty(r)} PC` : r.grams ? `${Number(r.grams).toFixed(2)}g` : '—';
const sumGrams = (items: DatabaseRowType[]) => items.reduce((s, r) => isPc(r) ? s : s + (Number(r.grams) || 0), 0);

/** Printable list of cancelled / returned items, to take to the box on paper. */
export default function CancelReport({ records, onClose }: Props) {
  const [from, setFrom] = useState(todayKey());
  const [to, setTo] = useState(todayKey());
  const [liver, setLiver] = useState(ALL);

  const cancelled = useMemo(() => records.filter(r => orderBox(r) === 'cancelled'), [records]);
  const livers = useMemo(
    () => [...new Set(cancelled.map(r => r.liverName?.trim() || 'No liver'))].sort(),
    [cancelled],
  );
  const picked = useMemo(() => cancelled.filter(r => {
    const day = cancelDay(r);
    if (day === 'Unknown Date' || (from && day < from) || (to && day > to)) return false;
    return liver === ALL || (r.liverName?.trim() || 'No liver') === liver;
  }), [cancelled, from, to, liver]);

  // Liver → customer → items
  const grouped = useMemo(() => {
    const g = new Map<string, Map<string, DatabaseRowType[]>>();
    const sorted = [...picked].sort((a, b) => cancelDay(a).localeCompare(cancelDay(b)));
    for (const r of sorted) {
      const lv = r.liverName?.trim() || 'No liver';
      const cust = r.minerName?.trim() || 'Unknown Client';
      if (!g.has(lv)) g.set(lv, new Map());
      const byCust = g.get(lv)!;
      if (!byCust.has(cust)) byCust.set(cust, []);
      byCust.get(cust)!.push(r);
    }
    return new Map([...g].sort(([a], [b]) => a.localeCompare(b)));
  }, [picked]);

  const rangeLabel = from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;

  const print = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    let html = `<html><head><title>Cancelled / Returned Report</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap" rel="stylesheet">
      <style>${SHARED_STYLES}
        .sign { display: flex; gap: 40px; margin-top: 36px; page-break-inside: avoid; }
        .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 10px; }
      </style></head><body>
      <h1 class="font-cinzel" style="font-size:20px;margin:0 0 4px;">CANCELLED / RETURNED ITEMS</h1>
      <p class="meta">Cancelled: ${esc(rangeLabel)} &nbsp;|&nbsp; Liver: ${esc(liver === ALL ? 'All' : liver)} &nbsp;|&nbsp; ${picked.length} item${picked.length !== 1 ? 's' : ''} &nbsp;|&nbsp; ${sumGrams(picked).toFixed(2)}g &nbsp;|&nbsp; Generated: ${esc(new Date().toLocaleString())}</p>`;

    if (picked.length === 0) html += `<p>No cancelled or returned items for these dates.</p>`;

    grouped.forEach((byCust, lv) => {
      const all = [...byCust.values()].flat();
      html += `<div class="source-block">
        <div class="source-header">
          <span class="source-title">${esc(lv)}</span>
          <div class="source-math"><span>Items: ${all.length}</span><span>Total Grams: ${sumGrams(all).toFixed(2)}g</span></div>
        </div><div class="source-body">`;
      byCust.forEach((items, cust) => {
        html += `<div class="client-block">
          <div class="client-header"><span>${esc(cust)}</span><span class="client-meta">${items.length} item${items.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${sumGrams(items).toFixed(2)}g</span></div>
          <table><thead><tr>
            <th style="width:28px">Done</th><th>Order ID</th><th>Item Description</th><th class="r">Grams</th>
            <th>Ordered</th><th>Cancelled</th><th>Status</th><th>Reason</th>
          </tr></thead><tbody>`;
        for (const r of items) {
          html += `<tr><td style="text-align:center"><div class="check-box"></div></td>
            <td class="order-id">${esc(r.orderId || `#${r.id}`)}</td>
            <td>${esc(r.itemDescription || '—')}</td>
            <td class="r">${esc(gramsDisplay(r))}</td>
            <td>${esc(formatDate(r.dateOfLive))}</td>
            <td>${esc(formatDate(cancelDay(r)))}</td>
            <td>${esc(r.status || '—')}</td>
            <td>${esc(r.cancelReason || '—')}</td></tr>`;
        }
        html += `</tbody></table></div>`;
      });
      html += `</div></div>`;
    });

    html += `<div class="sign"><div>Prepared by / Date</div><div>Checked by / Date</div><div>Received by / Date</div></div>
      </body></html>`;
    win.document.write(html);
    win.document.close();
    win.print();
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-cinzel">Cancelled / Returned report</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Cancelled from</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Liver</Label>
            <Select value={liver} onValueChange={setLiver}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All livers</SelectItem>
                {livers.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {picked.length} item{picked.length !== 1 ? 's' : ''} · {sumGrams(picked).toFixed(2)}g cancelled {rangeLabel}
        </p>
        <Button onClick={print} disabled={picked.length === 0}>
          <Printer className="h-4 w-4 mr-1" /> Print report
        </Button>
      </DialogContent>
    </Dialog>
  );
}
