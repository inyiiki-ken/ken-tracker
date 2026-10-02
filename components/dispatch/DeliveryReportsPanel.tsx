"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DatabaseRowType } from '@/types';
import { formatDateShort } from '@/lib/formatters';
import { gramsLabel, gramsTotalLabel, groupByCustomer } from '@/lib/calculations';
import { aedLabel, collectForAED, customersWithOtherLivers, sharedShippingCarriers, withOtherLivers } from '@/lib/liverMoney';
import { confirmDeliveryReport, getDeliveryReports, rejectDeliveryReport } from '@/lib/api';
import { confirmStatusFor, isOpenReport, type DeliveryReport } from '@/lib/deliveryReports';
import { itemsByKey, itemsFor, liverKey } from '@/lib/pulloutRequests';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

/**
 * Livers' "Delivered" / "Picked up" reports, at the top of the Dispatch board
 * under the pullout requests: confirm in one tap (sets the status and the
 * Delivered date) or reject with a reason the liver sees.
 */
export default function DeliveryReportsPanel({ records, onRefresh, onOpenReportsChange }: {
  records: DatabaseRowType[];
  /** Reload the records after items moved. */
  onRefresh?: () => void;
  /** Ids of items in an open report (kept out of the overdue reminders). */
  onOpenReportsChange?: (ids: Set<number>) => void;
}) {
  const [reports, setReports] = useState<DeliveryReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState('');
  // Reject reason drafts, per report; present while "Reject" is open.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const failedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setReports(await getDeliveryReports());
      failedRef.current = false;
      setFailed(false);
    } catch (err) {
      if (!failedRef.current) toast.error(err instanceof Error ? err.message : 'Could not load delivery reports');
      failedRef.current = true;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisiblePolling(load, 60_000);

  const openReports = useMemo(() => reports.filter(isOpenReport), [reports]);
  const byKey = useMemo(() => itemsByKey(records), [records]);
  const byCustomer = useMemo(() => groupByCustomer(records), [records]);

  const onOpenReportsChangeRef = useRef(onOpenReportsChange);
  onOpenReportsChangeRef.current = onOpenReportsChange;
  // Only once the first load ended (or failed), so the board knows the list is real.
  useEffect(() => {
    if (loading) return;
    const ids = new Set<number>();
    for (const q of openReports) for (const r of itemsFor(byKey, q.itemKeys)) ids.add(r.id);
    onOpenReportsChangeRef.current?.(ids);
  }, [openReports, byKey, loading]);

  const closeReason = (id: string) => setReasons(p => { const n = { ...p }; delete n[id]; return n; });

  const confirm = async (q: DeliveryReport, to: string) => {
    setBusy(q.id);
    try {
      const res = await confirmDeliveryReport({
        id: q.id,
        pickedUpStatus: q.kind === 'Picked up' ? to : undefined,
        seenUpdatedAt: q.updatedAt,
      });
      const skipped = res.skipped.length ? ` · ${res.skipped.length} left as they are (${Array.from(new Set(res.skipped.map(s => s.reason))).join(', ')})` : '';
      toast.success(res.moved ? `Confirmed — ${res.moved} item${res.moved !== 1 ? 's' : ''} set to ${res.to}${skipped}` : `Confirmed — items were already ${res.to}`);
      onRefresh?.();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
      await load();
    } finally {
      setBusy('');
    }
  };

  const reject = async (q: DeliveryReport) => {
    const reason = (reasons[q.id] ?? '').trim();
    if (!reason) { toast.error('Write a reason so the liver knows why.'); return; }
    setBusy(q.id);
    try {
      await rejectDeliveryReport({ id: q.id, reason, seenUpdatedAt: q.updatedAt });
      toast.success('Report rejected — the liver sees your reason');
      closeReason(q.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
      await load();
    } finally {
      setBusy('');
    }
  };

  if (loading || openReports.length === 0) return null;
  const dispatchStatuses = getEffectiveStatuses('dispatch');

  return (
    <div className="mx-4 mt-4 rounded-xl border border-primary/30 bg-card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/20"
      >
        <Truck className="h-4 w-4 text-primary" />
        <span className="font-cinzel text-sm text-foreground">Delivered / Picked up</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{openReports.length}</span>
        {failed && <span className="text-[10px] text-destructive">Couldn&apos;t refresh</span>}
        <div className="h-px flex-1 bg-border/40" />
        <span
          role="button"
          tabIndex={0}
          title="Refresh"
          onClick={e => { e.stopPropagation(); load(); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); load(); } }}
          className="h-9 w-9 shrink-0 flex items-center justify-center rounded hover:bg-secondary"
        >
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {openReports.map(q => {
            const items = itemsFor(byKey, q.itemKeys);
            const notFound = items.length === 0;
            const to = confirmStatusFor(q.kind, dispatchStatuses);
            // Per customer, capped at what they still owe (a group downpayment sits on one item).
            // Worked out from this liver's rows only, as she was shown; a customer with open
            // items from another liver gets the item-level figure, plus the shipping fee
            // on the one item that carries it (see sharedCustomer).
            const shared = customersWithOtherLivers(records, q.liver);
            const carriers = sharedShippingCarriers(records, shared);
            const hers = (rows: DatabaseRowType[]) => rows.filter(r => liverKey(r.liverName) === liverKey(q.liver));
            const expected = Array.from(groupByCustomer(items))
              .reduce((s, [k, rows]) => s + collectForAED(withOtherLivers(rows, shared, carriers), withOtherLivers(hers(byCustomer.get(k) ?? rows), shared, carriers)), 0);
            const isBusy = busy === q.id;
            const reason = reasons[q.id];
            return (
              <div key={q.id} className="px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-cinzel font-bold text-sm text-primary">{q.liver}</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-warning/40 bg-warning/10 text-warning">{q.kind}</span>
                  <span className="text-xs text-muted-foreground">Reported {q.reportedAt ? formatDateShort(q.reportedAt) : '—'}</span>
                  <span className="text-[10px] text-muted-foreground">{q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''}{items.length ? ` · ${gramsTotalLabel(items)}` : ''}</span>
                </div>
                {(q.cash !== null || expected > 0) && (
                  <p className="text-xs">
                    {q.cash !== null
                      ? <span className="font-semibold">Cash collected {aedLabel(q.cash)}</span>
                      : <span className="text-muted-foreground">No cash amount given</span>}
                    {expected > 0 && <span className="text-muted-foreground"> · expected {aedLabel(expected)}</span>}
                  </p>
                )}
                {q.note && <p className="text-xs italic text-muted-foreground">“{q.note}”</p>}
                <ul className="text-xs space-y-0.5">
                  {notFound ? (
                    <li className="text-destructive font-medium">Items not found — refresh</li>
                  ) : items.map(r => (
                    <li key={r.id} className="flex gap-2">
                      <span className="font-medium break-words max-w-[40%]">{r.minerName || '—'}</span>
                      <span className="text-muted-foreground break-words flex-1 min-w-0">{[r.itemDescription, r.orderId].filter(Boolean).join(' · ') || '—'}</span>
                      <span className="shrink-0">{gramsLabel(r) === '—' ? '' : gramsLabel(r)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{r.status}</span>
                    </li>
                  ))}
                </ul>

                {reason !== undefined && (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={reason}
                      onChange={e => setReasons(p => ({ ...p, [q.id]: e.target.value }))}
                      placeholder="Why? (e.g. Customer says not received)"
                      className="h-9 text-xs bg-background border-border"
                    />
                    <Button size="sm" variant="outline" className="h-9 text-xs border-border text-destructive shrink-0" disabled={isBusy} onClick={() => reject(q)}>
                      Send
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" className="h-9 text-xs" disabled={isBusy || notFound} onClick={() => confirm(q, to)}>
                    Confirm — set to {to}
                  </Button>
                  {reason === undefined ? (
                    <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive" disabled={isBusy} onClick={() => setReasons(p => ({ ...p, [q.id]: '' }))}>
                      Reject
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => closeReason(q.id)}>Close</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
