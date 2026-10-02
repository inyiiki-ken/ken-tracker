"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DatabaseRowType } from '@/types';
import { formatDateShort } from '@/lib/formatters';
import { customerKey, gramsLabel, gramsTotalLabel, groupByCustomer, parseDateRobust, pieceCount, sumGrams } from '@/lib/calculations';
import { aedLabel, collectForAED } from '@/lib/liverMoney';
import { createDeliveryReport, ensurePulloutRowKeys, getDeliveryReports, withdrawDeliveryReport } from '@/lib/api';
import {
  deliveryKindOf, isOpenReport, parseCash,
  type DeliveryKind, type DeliveryReport, type DeliveryReportStatus,
} from '@/lib/deliveryReports';
import { finishedAfterLoad, isRealItemKey, itemKey, itemLine, itemsByKey, itemsFor } from '@/lib/pulloutRequests';
import { useVisiblePolling } from '@/lib/useVisiblePolling';
import { CustomerNameButton, Highlight } from './LiverRowBits';

const STATUS_STYLE: Record<DeliveryReportStatus, string> = {
  Reported: 'border-warning/40 bg-warning/10 text-warning',
  Confirmed: 'border-success/40 bg-success/10 text-success',
  Rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
  Withdrawn: 'border-border bg-secondary text-muted-foreground line-through',
};
const STATUS_LABEL: Record<DeliveryReportStatus, string> = {
  Reported: 'Waiting for Dispatch',
  Confirmed: 'Confirmed',
  Rejected: 'Not confirmed',
  Withdrawn: 'Taken back',
};

// A report Dispatch didn't confirm stays flagged this long.
const REJECTED_SHOWN_MS = 7 * 24 * 3600_000;

function weightOf(items: DatabaseRowType[]): string {
  return sumGrams(items) > 0 || pieceCount(items) > 0 ? gramsTotalLabel(items) : '0g';
}

function orderTime(r: DatabaseRowType): number {
  return parseDateRobust(r.dateOfLive)?.getTime() ?? 0;
}

/**
 * Recently rejected reports still worth flagging (Today card, this card's
 * header): at least one item wasn't reported again since (waiting or
 * confirmed) and is still For COD / For Pick Up in her items.
 */
export function recentlyRejected(reports: DeliveryReport[], records: DatabaseRowType[], now = Date.now()): DeliveryReport[] {
  const byKey = itemsByKey(records);
  return reports.filter(q => {
    const rejectedAt = Date.parse(q.updatedAt);
    if (q.status !== 'Rejected' || !(now - rejectedAt < REJECTED_SHOWN_MS)) return false;
    return q.itemKeys.some(k => {
      const reportedAgain = reports.some(o => o.id !== q.id && (o.status === 'Reported' || o.status === 'Confirmed')
        && Date.parse(o.reportedAt || o.updatedAt) > rejectedAt && o.itemKeys.includes(k));
      return !reportedAgain && (byKey.get(k) ?? []).some(r => deliveryKindOf(r) !== null);
    });
  });
}

/**
 * For COD / For Pick Up items: the liver reports Delivered / Picked up (COD
 * with the cash she collected). Dispatch confirms, which sets the status.
 */
export function DeliveryPanel({ liver, records, recordsAt, onRefresh, previewing, visibleIds, query, onReportsChange, onLoaded, onOpenCustomer, open: openProp, onOpenChange }: {
  liver: string;
  /** This liver's items. */
  records: DatabaseRowType[];
  /** When her records last loaded (ms), so a confirmed report locks its items only until they refresh. */
  recordsAt: number;
  /** Reload the records (after Dispatch confirmed). */
  onRefresh?: () => void;
  /** An admin previewing her view: nothing is sent. */
  previewing?: boolean;
  /** While searching: the rows to show. */
  visibleIds?: Set<number> | null;
  query?: string;
  /** Her reports, whenever they load (the page's overdue list and Today card use them). */
  onReportsChange?: (list: DeliveryReport[]) => void;
  /** A load ended: ok = her reports arrived, false = it failed (the page decides what that means). */
  onLoaded?: (ok: boolean) => void;
  onOpenCustomer?: (customer: string) => void;
  /** Folded open or shut; null = open only when Dispatch didn't confirm a report. */
  open?: boolean | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const [reports, setReports] = useState<DeliveryReport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // The customer group whose report form is open, and its draft.
  const [active, setActive] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Row Keys given out on this screen, until the refreshed records carry them.
  const [newKeys, setNewKeys] = useState<Record<number, string>>({});

  const liveRef = useRef(liver);
  useEffect(() => {
    liveRef.current = liver;
    return () => { liveRef.current = ''; };
  }, [liver]);
  const statusRef = useRef(new Map<string, DeliveryReportStatus>());
  const failedRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const onReportsChangeRef = useRef(onReportsChange);
  onReportsChangeRef.current = onReportsChange;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  // When this card last asked for her items (0 = not yet).
  const askedRefreshRef = useRef(0);

  const load = useCallback(async () => {
    if (!liver) return;
    const asked = liver;
    try {
      const list = await getDeliveryReports({ liver: asked });
      if (liveRef.current !== asked) return;
      const prev = statusRef.current;
      const confirmed = list.some(q => q.status === 'Confirmed' && prev.get(q.id) === 'Reported');
      statusRef.current = new Map(list.map(q => [q.id, q.status]));
      setReports(list);
      onReportsChangeRef.current?.(list);
      setLoaded(true);
      onLoadedRef.current?.(true);
      failedRef.current = false;
      setFailed(false);
      // Dispatch confirmed: her items are Delivered now, fetch them.
      if (confirmed) { askedRefreshRef.current = Date.now(); onRefreshRef.current?.(); }
    } catch (err) {
      if (liveRef.current !== asked) return;
      if (!failedRef.current) toast.error(err instanceof Error ? err.message : 'Could not load your delivery reports');
      failedRef.current = true;
      setFailed(true);
      onLoadedRef.current?.(false);
    }
  }, [liver]);

  useEffect(() => { load(); }, [load]);
  useVisiblePolling(load, 60_000);

  const keyOf = useCallback((r: DatabaseRowType) => newKeys[r.id] ?? itemKey(r), [newKeys]);
  const toReport = useMemo(() => records.filter(r => deliveryKindOf(r)), [records]);

  // Items in an open report, and which report.
  const reportedIn = useMemo(() => {
    const m = new Map<string, DeliveryReport>();
    for (const q of reports) if (isOpenReport(q)) for (const k of q.itemKeys) m.set(k, q);
    return m;
  }, [reports]);
  // Reports Dispatch confirmed since her records loaded: items are moving even before the refresh arrives.
  const recentlyConfirmed = useMemo(() => {
    const s = new Set<string>();
    for (const q of reports) if (q.status === 'Confirmed' && finishedAfterLoad(q.updatedAt, recordsAt)) for (const k of q.itemKeys) s.add(k);
    return s;
  }, [reports, recordsAt]);
  // Fetch her items then (unless just asked), so the lock ends as soon as they show Delivered.
  useEffect(() => {
    if (recentlyConfirmed.size === 0 || Date.now() - askedRefreshRef.current <= 5_000) return;
    askedRefreshRef.current = Date.now();
    onRefreshRef.current?.();
  }, [recentlyConfirmed.size]);
  const isFree = useCallback((r: DatabaseRowType) => !reportedIn.has(keyOf(r)) && !recentlyConfirmed.has(keyOf(r)), [reportedIn, recentlyConfirmed, keyOf]);

  // One group per customer and kind (a customer may have COD and Pick Up items).
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; customer: string; name: string; kind: DeliveryKind; rows: DatabaseRowType[] }>();
    for (const r of toReport) {
      const kind = deliveryKindOf(r)!;
      const key = `${customerKey(r)}|${kind}`;
      const g = m.get(key);
      if (g) g.rows.push(r);
      else m.set(key, { key, customer: customerKey(r), name: r.minerName || '—', kind, rows: [r] });
    }
    return Array.from(m.values())
      .map(g => ({ ...g, rows: [...g.rows].sort((a, b) => orderTime(b) - orderTime(a)) }))
      .sort((a, b) => orderTime(b.rows[0]) - orderTime(a.rows[0]));
  }, [toReport]);
  const shows = useCallback((r: DatabaseRowType) => !visibleIds || visibleIds.has(r.id), [visibleIds]);
  const shownGroups = visibleIds ? groups.map(g => ({ ...g, rows: g.rows.filter(shows) })).filter(g => g.rows.length > 0) : groups;

  const byKey = useMemo(() => itemsByKey(records), [records]);
  // All her items per customer, so Collect nets a group downpayment saved on one item.
  const byCustomer = useMemo(() => groupByCustomer(records), [records]);
  const shownReports = useMemo(() => {
    const open = reports.filter(isOpenReport);
    const closed = reports.filter(q => !isOpenReport(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    return [...open, ...closed];
  }, [reports]);

  const freeCount = toReport.filter(isFree).length;
  const openCount = reports.filter(isOpenReport).length;
  const rejected = useMemo(() => recentlyRejected(reports, records), [reports, records]);
  const [openLocal, setOpenLocal] = useState<boolean | null>(null);
  const isOpen = (openProp ?? openLocal) ?? rejected.length > 0;
  const setOpen = (v: boolean) => { setOpenLocal(v); onOpenChange?.(v); };

  const startReport = (g: typeof groups[number]) => {
    setActive(g.key);
    setPicked(new Set(g.rows.filter(isFree).map(r => r.id)));
    setCash('');
    setNote('');
  };
  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const send = async (g: typeof groups[number]) => {
    if (previewing) return;
    const items = g.rows.filter(r => isFree(r) && picked.has(r.id));
    if (items.length === 0) { toast.error('Tick the items the customer got.'); return; }
    const amount = g.kind === 'Delivered' ? parseCash(cash) : null;
    if (amount !== null && Number.isNaN(amount)) { toast.error('Type the cash as a number, e.g. 1250.'); return; }
    setSaving(true);
    try {
      // Items with no Row Key yet get one first, so the report never tracks a row number.
      let keyed = items.map(r => ({ r, k: keyOf(r) }));
      const noKey = keyed.filter(x => !isRealItemKey(x.k));
      if (noKey.length) {
        const got = await ensurePulloutRowKeys({
          liver,
          rows: noKey.map(x => ({ rowId: x.r.id, minerName: x.r.minerName, itemDescription: x.r.itemDescription })),
        });
        setNewKeys(prev => ({ ...prev, ...got }));
        keyed = keyed.map(x => ({ ...x, k: got[x.r.id] ?? x.k }));
      }
      await createDeliveryReport({ input: { liver, kind: g.kind, itemKeys: keyed.map(x => x.k), cash: amount, note } });
      toast.success(`Sent to Dispatch — ${g.kind === 'Delivered' ? 'they will confirm the delivery' : 'they will confirm the pick-up'}`);
      setActive('');
      await load();
      if (noKey.length) onRefreshRef.current?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the report');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (q: DeliveryReport) => {
    if (previewing) return;
    if (!window.confirm('Take back this report? The items stay as they are.')) return;
    setSaving(true);
    try {
      await withdrawDeliveryReport({ id: q.id, seenUpdatedAt: q.updatedAt });
      toast.success('Report taken back');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not take back the report');
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (toReport.length === 0 && shownReports.length === 0) return null;

  return (
    <div id="liver-deliveries" className="rounded-xl border border-info/40 bg-card overflow-hidden scroll-mt-24">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left hover:bg-secondary/20"
        aria-expanded={isOpen}
      >
        <Truck className="h-4 w-4 text-info" />
        <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Delivered / Picked up</span>
        <span className="text-xs text-muted-foreground">
          {freeCount} to report{openCount > 0 ? ` · ${openCount} waiting for Dispatch` : ''}
        </span>
        {rejected.length > 0 && <span className="text-xs font-semibold text-destructive">{rejected.length} not confirmed</span>}
        <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="border-t border-border">
          {failed && (
            <p className="px-4 pt-2 text-xs text-destructive">
              Couldn&apos;t refresh your reports · <button className="underline px-1 py-2" onClick={() => load()}>Retry</button>
            </p>
          )}
          <p className="px-4 py-2 text-xs text-muted-foreground">
            Customer got the items? Tap Delivered or Picked up. Dispatch confirms and sets the status.
          </p>
          {!loaded && !failed && <p className="px-4 pb-2 text-xs text-muted-foreground">Loading your reports…</p>}
          {toReport.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-muted-foreground">No For COD or For Pick Up items right now.</p>
          ) : shownGroups.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-muted-foreground">No items here match your search.</p>
          ) : (
            <div className="divide-y divide-border/50 border-t border-border/50">
              {shownGroups.map(g => {
                const free = g.rows.filter(isFree);
                const collect = collectForAED(free, byCustomer.get(g.customer) ?? g.rows);
                const editing = active === g.key;
                const ticked = free.filter(r => picked.has(r.id));
                // Cash expected for the items she ticked (what Dispatch will see as "expected").
                const expected = editing ? collectForAED(ticked, byCustomer.get(g.customer) ?? g.rows) : 0;
                return (
                  <div key={g.key} className="px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {onOpenCustomer ? (
                        <span className="text-sm"><CustomerNameButton name={g.name} query={query} onOpen={() => onOpenCustomer(g.customer)} bold /></span>
                      ) : <span className="font-semibold text-sm"><Highlight text={g.name} query={query} /></span>}
                      <span className="text-xs text-muted-foreground">
                        {g.kind === 'Delivered' ? 'For COD' : 'For Pick Up'} · {g.rows.length} item{g.rows.length !== 1 ? 's' : ''} · {weightOf(g.rows)}
                      </span>
                      {collect > 0 && <span className="text-xs font-semibold text-attention">Collect {aedLabel(collect)}</span>}
                      {free.length > 0 && !editing && (
                        <Button size="sm" className="ml-auto h-9 text-xs" disabled={!loaded || saving || previewing} onClick={() => startReport(g)}>
                          {previewing ? 'Preview only' : g.kind}
                        </Button>
                      )}
                    </div>
                    <ul className="text-xs space-y-1">
                      {g.rows.map(r => {
                        const q = reportedIn.get(keyOf(r));
                        const done = !q && recentlyConfirmed.has(keyOf(r));
                        const canTick = editing && isFree(r);
                        return (
                          // While ticking, the whole row toggles (easier on a phone than the box).
                          <li
                            key={r.id}
                            className={`flex items-start gap-2 ${editing ? 'min-h-10 py-1' : ''} ${canTick ? 'cursor-pointer' : ''}`}
                            onClick={() => canTick && toggle(r.id)}
                          >
                            {editing && (
                              <input
                                type="checkbox"
                                className="mt-0.5 h-5 w-5 shrink-0"
                                aria-label={`Tick ${r.itemDescription || 'item'}`}
                                disabled={!canTick}
                                checked={!canTick || picked.has(r.id)}
                                onChange={() => toggle(r.id)}
                                onClick={e => e.stopPropagation()}
                              />
                            )}
                            <div className="min-w-0 flex-1 break-words">
                              <Highlight text={[r.itemDescription, r.orderId].filter(Boolean).join(' · ') || '—'} query={query} />
                              {r.dateOfLive && <span className="text-muted-foreground"> · Ordered {formatDateShort(r.dateOfLive)}</span>}
                              {q && <div className="text-primary">Reported {q.kind.toLowerCase()} · waiting for Dispatch</div>}
                              {done && <div className="text-primary">Confirmed · updating…</div>}
                            </div>
                            <span className="shrink-0">{gramsLabel(r)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {editing && (
                      <div className="space-y-2 rounded-lg bg-secondary/10 p-3">
                        <p className="text-xs font-medium">
                          {g.kind} · {ticked.length} item{ticked.length !== 1 ? 's' : ''}
                        </p>
                        {g.kind === 'Delivered' && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Cash you collected, AED (optional)</label>
                            <div className="flex flex-wrap items-center gap-2">
                              <Input
                                inputMode="decimal"
                                value={cash}
                                onChange={e => setCash(e.target.value)}
                                placeholder="e.g. 1250"
                                className="h-9 text-sm w-40 bg-background border-border"
                              />
                              {expected > 0 && (
                                <>
                                  <span className="text-xs text-muted-foreground">Expected {aedLabel(expected)}</span>
                                  <Button type="button" size="sm" variant="outline" className="h-9 text-xs border-border" onClick={() => setCash(String(expected))}>
                                    Same
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                        <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="h-9 text-xs bg-background border-border" />
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" className="h-9 text-xs" disabled={saving || previewing || ticked.length === 0} onClick={() => send(g)}>
                            {previewing ? 'Preview only' : saving ? 'Sending…' : 'Send to Dispatch'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setActive('')}>Close</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* My reports: open first, then the last few answered */}
          {shownReports.length > 0 && (
            <div className="border-t border-border">
              <div className="px-4 py-2 text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">My reports</div>
              <div className="divide-y divide-border/50">
                {shownReports.map(q => {
                  const items = itemsFor(byKey, q.itemKeys);
                  return (
                    <div key={q.id} className="px-4 py-2.5 space-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{q.kind}</span>
                        <span className="text-muted-foreground">Reported {q.reportedAt ? formatDateShort(q.reportedAt) : '—'}</span>
                        {q.cash !== null && <span className="text-muted-foreground">· Cash collected {aedLabel(q.cash)}</span>}
                        <span className={`ml-auto font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                      </div>
                      <ul className="text-muted-foreground space-y-0.5">
                        {items.length > 0
                          ? items.map(r => <li key={r.id} className="break-words">{itemLine(r)}</li>)
                          : <li className="whitespace-pre-line">{q.summary}</li>}
                      </ul>
                      {q.note && <p className="italic text-muted-foreground">“{q.note}”</p>}
                      {q.dispatchReply && <p className="font-medium text-destructive">Dispatch: {q.dispatchReply}</p>}
                      {isOpenReport(q) && (
                        <div className="flex">
                          <Button size="sm" variant="ghost" className="ml-auto h-9 text-xs text-destructive" disabled={saving || previewing} onClick={() => withdraw(q)}>
                            {previewing ? 'Preview only' : 'Take back'}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
