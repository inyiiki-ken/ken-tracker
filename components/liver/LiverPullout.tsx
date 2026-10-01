"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, PackageOpen, XCircle } from 'lucide-react';
import { startOfWeek, startOfMonth } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DatabaseRowType } from '@/types';
import { formatDate, formatDateObj } from '@/lib/formatters';
import { customerKey, groupByCustomer, parseDateRobust } from '@/lib/calculations';
import { boxFromDelivery } from '@/lib/fulfilment';
import {
  addItemsToPulloutRequest, createPulloutRequest, ensurePulloutRowKeys, getPulloutRequests,
  setPulloutRequestStatus, updatePulloutRequest,
} from '@/lib/api';
import {
  PULLOUT_METHODS, isCancelledItem, isOpenRequest, isOverdueRequest, isRealItemKey, isToPullOut,
  itemKey, itemLine, itemSummary, itemsByKey, itemsFor, statusChangedAt, todayISO,
  type PulloutMethod, type PulloutRequest, type PulloutRequestStatus,
} from '@/lib/pulloutRequests';
import { liverCameStatus, ownBox } from '@/lib/pulloutTargets';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

function gramsOf(items: DatabaseRowType[]): number {
  return items.reduce((s, r) => s + (Number(r.grams) || 0), 0);
}

function orderTime(r: DatabaseRowType): number {
  return parseDateRobust(r.dateOfLive)?.getTime() ?? 0;
}

function MethodToggle({ value, onChange, disabled }: { value: PulloutMethod | null; onChange: (m: PulloutMethod) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-1.5">
      {PULLOUT_METHODS.map(m => (
        <Button
          key={m.key}
          type="button"
          size="sm"
          disabled={disabled}
          variant={value === m.key ? 'default' : 'outline'}
          className={`text-xs h-7 ${value === m.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
          onClick={() => onChange(m.key)}
        >
          {m.label}
        </Button>
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  Requested: 'border-warning/40 bg-warning/10 text-warning',
  Ready: 'border-success/40 bg-success/10 text-success',
  Done: 'border-border bg-secondary text-muted-foreground',
  Cancelled: 'border-border bg-secondary text-muted-foreground line-through',
};

const DAY_MS = 24 * 3600_000;
// Coming back to the app reloads her items at most this often (it reads the whole sheet).
const RECORDS_REFRESH_MS = 2 * 60_000;

/** A customer's checkbox: ticked, unticked, or partly ticked. */
function GroupCheckbox({ checked, partial, disabled, onChange, label }: {
  checked: boolean; partial: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      ref={el => { if (el) el.indeterminate = partial; }}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
      onClick={e => e.stopPropagation()}
    />
  );
}

// ─── Items to pull out + pullout requests ────────────────────────────────────
export function PulloutPanel({ liver, records, allRecords, onRefresh, previewing }: {
  liver: string;
  /** This liver's items. */
  records: DatabaseRowType[];
  /** Every row this screen holds (her own rows for a liver), to spot shared Row Keys. */
  allRecords: DatabaseRowType[];
  /** Reload the records (after Dispatch moved her items). */
  onRefresh?: () => void;
  /** An admin previewing her view: nothing is sent. */
  previewing?: boolean;
}) {
  const [requests, setRequests] = useState<PulloutRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Ticked items, by row id.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [date, setDate] = useState(() => todayISO());
  // No method until she picks one (or every ticked customer says the same).
  const [method, setMethod] = useState<PulloutMethod | null>(null);
  const [methodChosen, setMethodChosen] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string>('');
  const [editDate, setEditDate] = useState('');
  const [editMethod, setEditMethod] = useState<PulloutMethod>('Pick Up');
  const [editNote, setEditNote] = useState('');
  // Row Keys given out on this screen, until the refreshed records carry them.
  const [newKeys, setNewKeys] = useState<Record<number, string>>({});

  // The liver this panel is for; a response for anyone else is ignored.
  const liveRef = useRef(liver);
  useEffect(() => {
    liveRef.current = liver;
    return () => { liveRef.current = ''; };
  }, [liver]);
  const statusRef = useRef(new Map<string, PulloutRequestStatus>());
  const failedRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const lastRefreshRef = useRef(Date.now());

  const refreshRecords = useCallback((force = false) => {
    if (!onRefreshRef.current) return;
    if (!force && Date.now() - lastRefreshRef.current < RECORDS_REFRESH_MS) return;
    lastRefreshRef.current = Date.now();
    onRefreshRef.current();
  }, []);

  const load = useCallback(async () => {
    if (!liver) return;
    const asked = liver;
    try {
      const list = await getPulloutRequests({ liver: asked });
      if (liveRef.current !== asked) return;
      const prev = statusRef.current;
      const turnedDone = list.some(q => q.status === 'Done' && prev.has(q.id) && prev.get(q.id) !== 'Done');
      statusRef.current = new Map(list.map(q => [q.id, q.status]));
      setRequests(list);
      setLoaded(true);
      failedRef.current = false;
      setFailed(false);
      // Dispatch pressed "Liver came": her items moved, fetch them now.
      if (turnedDone) refreshRecords(true);
    } catch (err) {
      if (liveRef.current !== asked) return;
      // One toast per failure streak; then the quiet "Couldn't refresh" line.
      if (!failedRef.current) toast.error(err instanceof Error ? err.message : 'Could not load your pullout requests');
      failedRef.current = true;
      setFailed(true);
    }
  }, [liver, refreshRecords]);

  useEffect(() => { load(); }, [load]);
  useVisiblePolling(load, 60_000);
  // Back in the app: her items may have moved too (not on every poll).
  useEffect(() => {
    const onBack = () => { if (!document.hidden) refreshRecords(); };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [refreshRecords]);

  const keyOf = useCallback((r: DatabaseRowType) => newKeys[r.id] ?? itemKey(r), [newKeys]);
  const toPullOut = useMemo(() => records.filter(isToPullOut), [records]);
  const statuses = useMemo(() => records.map(r => String(r.status ?? '')), [records]);

  // Items already in an open request, and which request.
  const requestedFor = useMemo(() => {
    const m = new Map<string, PulloutRequest>();
    for (const q of requests) if (isOpenRequest(q)) for (const k of q.itemKeys) m.set(k, q);
    return m;
  }, [requests]);

  // Requests Dispatch finished in the last day: their items are moving to
  // For COD / Pick Up even before the refreshed records arrive.
  const recentlyDone = useMemo(() => {
    const since = Date.now() - DAY_MS;
    const s = new Set<string>();
    for (const q of requests) if (q.status === 'Done' && Date.parse(q.updatedAt) >= since) for (const k of q.itemKeys) s.add(k);
    return s;
  }, [requests]);

  const free = useMemo(
    () => toPullOut.filter(r => !requestedFor.has(keyOf(r)) && !recentlyDone.has(keyOf(r))),
    [toPullOut, requestedFor, recentlyDone, keyOf],
  );
  const freeIds = useMemo(() => new Set(free.map(r => r.id)), [free]);
  // Ticks only ever cover free items: drop any that got requested meanwhile.
  useEffect(() => {
    setPicked(prev => {
      const next = new Set(Array.from(prev).filter(id => freeIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [freeIds]);
  const pickedItems = useMemo(() => free.filter(r => picked.has(r.id)), [free, picked]);
  const today = todayISO();

  // A day left open overnight moves on to today.
  useEffect(() => { if (date < today) setDate(today); }, [date, today]);

  // One group per customer, newest order first.
  const groups = useMemo(() => {
    return Array.from(groupByCustomer(toPullOut).values())
      .map(rows => {
        const sorted = [...rows].sort((a, b) => orderTime(b) - orderTime(a));
        return { key: customerKey(sorted[0]), name: sorted[0].minerName || '—', rows: sorted, newest: orderTime(sorted[0]) };
      })
      .sort((a, b) => b.newest - a.newest);
  }, [toPullOut]);

  // Customers she ticked only some of.
  const partial = useMemo(() => groups.flatMap(g => {
    const freeRows = g.rows.filter(r => freeIds.has(r.id));
    const n = freeRows.filter(r => picked.has(r.id)).length;
    return n > 0 && n < freeRows.length ? [{ name: g.name, left: freeRows.length - n }] : [];
  }), [groups, freeIds, picked]);

  // COD / Pick Up only matters for local items; international and reseller
  // items go to their own box when she comes.
  const localPicked = useMemo(() => pickedItems.filter(r => !ownBox(r)), [pickedItems]);
  const codCount = localPicked.filter(r => boxFromDelivery(r) === 'cod').length;
  const suggested: PulloutMethod | null = localPicked.length === 0 ? null
    : codCount === localPicked.length ? 'COD'
    : codCount === 0 ? 'Pick Up'
    : null;
  useEffect(() => { if (!methodChosen) setMethod(suggested); }, [suggested, methodChosen]);
  const needsMethod = localPicked.length > 0;
  const ownBoxNotes = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of pickedItems) if (ownBox(r)) {
      const to = liverCameStatus(r, 'Pick Up', statuses);
      m.set(to, (m.get(to) ?? 0) + 1);
    }
    return Array.from(m, ([to, n]) => `${n} item${n !== 1 ? 's' : ''} go${n === 1 ? 'es' : ''} to ${to}`);
  }, [pickedItems, statuses]);

  // Row Keys used by more than one row: a request can't tell those items apart.
  const sharedKeys = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of allRecords) {
      const k = String(r.rowKey ?? '').trim();
      if (!k) continue;
      if (seen.has(k)) dup.add(k); else seen.add(k);
    }
    return dup;
  }, [allRecords]);

  // Her own items by key (never another customer's), for the request cards.
  const byKey = useMemo(() => {
    const m = itemsByKey(records);
    for (const r of records) {
      const k = newKeys[r.id];
      if (k && !m.has(k)) m.set(k, [r]);
    }
    return m;
  }, [records, newKeys]);

  // Open request for the same day and method: offer to add to it.
  const joinTarget = method
    ? requests.find(q => q.status === 'Requested' && q.date === date && q.method === method)
    : undefined;

  // Open requests first, then the last few finished ones.
  const shownRequests = useMemo(() => {
    const open = requests.filter(isOpenRequest);
    const closed = requests.filter(q => !isOpenRequest(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    return [...open, ...closed];
  }, [requests]);

  const toggle = (id: number) => setPicked(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const setMany = (rows: DatabaseRowType[], on: boolean) => setPicked(prev => {
    const next = new Set(prev);
    for (const r of rows) on ? next.add(r.id) : next.delete(r.id);
    return next;
  });

  const submit = async (join?: PulloutRequest) => {
    if (previewing) return;
    if (pickedItems.length === 0) { toast.error('Tick the items you will pull out.'); return; }
    if (!date) { toast.error('Pick the day you will come.'); return; }
    if (date < today) { toast.error('Pick today or a later day.'); return; }
    if (needsMethod && !method) { toast.error('Choose COD or Pick Up.'); return; }
    const shared = pickedItems.find(r => sharedKeys.has(String(r.rowKey ?? '').trim()));
    if (shared) {
      toast.error(`${itemLine(shared)}: this item has no unique ID — ask the admin to fix its Row Key in the sheet.`);
      return;
    }
    setSaving(true);
    try {
      // Items with no Row Key yet get one first, so the request never tracks a row number.
      let keyed = pickedItems.map(r => ({ r, k: keyOf(r) }));
      const noKey = keyed.filter(x => !isRealItemKey(x.k));
      if (noKey.length) {
        const got = await ensurePulloutRowKeys({
          liver,
          rows: noKey.map(x => ({ rowId: x.r.id, minerName: x.r.minerName, itemDescription: x.r.itemDescription })),
        });
        setNewKeys(prev => ({ ...prev, ...got }));
        keyed = keyed.map(x => ({ ...x, k: got[x.r.id] ?? x.k }));
      }
      const itemKeys = keyed.map(x => x.k);
      if (join) {
        await addItemsToPulloutRequest({ id: join.id, itemKeys, note, seenUpdatedAt: join.updatedAt });
        toast.success(`Added to your request for ${formatDate(join.date)}`);
      } else {
        await createPulloutRequest({
          input: { liver, date, method: method ?? 'Pick Up', note, itemKeys, summary: itemSummary(pickedItems) },
        });
        toast.success('Pullout request sent to Dispatch');
      }
      setPicked(new Set());
      setNote('');
      setMethod(null);
      setMethodChosen(false);
      await load();
      if (noKey.length) refreshRecords(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the request');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (q: PulloutRequest) => {
    setEditing(q.id);
    setEditDate(q.date < today ? today : q.date);
    setEditMethod(q.method);
    setEditNote(q.note);
  };

  const saveEdit = async (q: PulloutRequest) => {
    if (previewing) return;
    if (!editDate || editDate < today) { toast.error('Pick today or a later day.'); return; }
    setSaving(true);
    try {
      await updatePulloutRequest({ id: q.id, date: editDate, method: editMethod, note: editNote, seenUpdatedAt: q.updatedAt });
      toast.success('Request updated');
      setEditing('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the request');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (q: PulloutRequest) => {
    if (previewing) return;
    if (!window.confirm('Cancel this pullout request?')) return;
    setSaving(true);
    try {
      await setPulloutRequestStatus({ id: q.id, status: 'Cancelled', seenUpdatedAt: q.updatedAt });
      toast.success('Request cancelled');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the request');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const requestedCount = toPullOut.length - free.length;
  const sendLabel = previewing ? 'Preview only' : saving ? 'Sending…' : null;

  return (
    <div className="space-y-3">
      {previewing && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">Preview — actions are disabled</p>
      )}
      {failed && (
        <p className="text-xs text-destructive">
          Couldn&apos;t refresh your pullout requests ·{' '}
          <button className="underline" onClick={() => load()}>Retry</button>
        </p>
      )}

      {/* Items to pull out */}
      <div className="rounded-xl border border-warning/40 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <PackageOpen className="h-4 w-4 text-warning" />
          <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Items to pull out</span>
          <span className="text-[10px] text-muted-foreground">
            {loaded && toPullOut.length > 0
              ? `${free.length} to request · ${requestedCount} already requested`
              : `${toPullOut.length} item${toPullOut.length !== 1 ? 's' : ''}`}
            {' · '}{gramsOf(toPullOut).toFixed(2)}g
          </span>
          <div className="h-px flex-1 bg-border/40" />
        </div>
        {toPullOut.length === 0 ? (
          <p className="border-t border-border px-4 py-4 text-xs text-muted-foreground">Nothing to pull out right now.</p>
        ) : (
          <div className="border-t border-border">
            {!loaded && <p className="px-4 py-2 text-xs text-muted-foreground">Loading your requests…</p>}
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary/20 border-b border-border">
                  <th className="w-8 px-3 py-2">
                    <GroupCheckbox
                      label="Tick all"
                      checked={free.length > 0 && free.every(r => picked.has(r.id))}
                      partial={pickedItems.length > 0 && pickedItems.length < free.length}
                      disabled={!loaded || free.length === 0}
                      onChange={on => setPicked(on ? new Set(free.map(r => r.id)) : new Set())}
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Ordered</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap(g => {
                  const freeRows = g.rows.filter(r => freeIds.has(r.id));
                  const n = freeRows.filter(r => picked.has(r.id)).length;
                  return [
                    <tr key={`g-${g.key}`} className={`border-b border-border/30 bg-secondary/20 ${freeRows.length ? 'cursor-pointer' : ''}`}
                      onClick={() => loaded && freeRows.length && setMany(freeRows, n < freeRows.length)}>
                      <td className="px-3 py-2 text-center">
                        <GroupCheckbox
                          label={`Tick all of ${g.name}`}
                          checked={freeRows.length > 0 && n === freeRows.length}
                          partial={n > 0 && n < freeRows.length}
                          disabled={!loaded || freeRows.length === 0}
                          onChange={on => setMany(freeRows, on)}
                        />
                      </td>
                      <td colSpan={3} className="px-3 py-2">
                        <span className="font-semibold">{g.name}</span>
                        <span className="text-[10px] text-muted-foreground"> · {g.rows.length} item{g.rows.length !== 1 ? 's' : ''} · {gramsOf(g.rows).toFixed(2)}g</span>
                      </td>
                    </tr>,
                    ...g.rows.map(r => {
                      const k = keyOf(r);
                      const q = requestedFor.get(k);
                      const done = !q && recentlyDone.has(k);
                      const locked = !!q || done;
                      return (
                        <tr key={r.id} className={`border-b border-border/30 ${locked ? 'opacity-70' : 'cursor-pointer'}`} onClick={() => loaded && !locked && toggle(r.id)}>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" disabled={!loaded || locked} checked={locked || picked.has(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.dateOfLive ? formatDate(r.dateOfLive) : '—'}</td>
                          <td className="px-3 py-2 max-w-[160px]">
                            <div className="truncate">{r.itemDescription || '—'}</div>
                            {q && (
                              <div className="text-[10px] text-primary">
                                In request · pull out {formatDate(q.date)} · {q.status === 'Ready' ? 'Ready for you' : 'waiting for Dispatch'}
                              </div>
                            )}
                            {done && <div className="text-[10px] text-primary">Dispatch set it out · updating…</div>}
                          </td>
                          <td className="px-3 py-2 text-right">{r.grams ? `${r.grams}g` : '—'}</td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>

            {/* Request form */}
            {loaded && free.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground bg-secondary/10">All your items are in a request below.</p>
            ) : loaded && (
              <div className="p-4 space-y-3 bg-secondary/10">
                <p className="text-xs font-medium">
                  Request pullout {pickedItems.length > 0 && <span className="text-primary">· {pickedItems.length} item{pickedItems.length !== 1 ? 's' : ''} · {gramsOf(pickedItems).toFixed(2)}g</span>}
                </p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted-foreground">Day you will come</label>
                    <Input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className="h-8 text-xs w-40 bg-background border-border" />
                  </div>
                  {(needsMethod || pickedItems.length === 0) && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-muted-foreground">COD or Pick Up</label>
                      <MethodToggle value={method} onChange={m => { setMethod(m); setMethodChosen(true); }} />
                    </div>
                  )}
                </div>
                {needsMethod && !suggested && codCount > 0 && (
                  <p className="text-[11px] text-warning">
                    {codCount} of these {codCount === 1 ? 'is a COD client' : 'are COD clients'} — consider sending two requests.
                  </p>
                )}
                {ownBoxNotes.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">{ownBoxNotes.join(' · ')} when you come.</p>
                )}
                {partial.length > 0 && (
                  <p className="text-[11px] text-warning">
                    {partial.map(p => `You left ${p.left} of ${p.name}'s items`).join(' · ')} — {partial.length === 1 && partial[0].left === 1 ? 'it' : 'they'} will go separately.
                  </p>
                )}
                <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="text-xs min-h-[48px] bg-background" />
                {joinTarget ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="h-8 text-xs" disabled={saving || previewing} onClick={() => submit(joinTarget)}>
                      {sendLabel ?? `Add to my request for ${formatDate(joinTarget.date)}`}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-border" disabled={saving || previewing} onClick={() => submit()}>
                      Send as a new request
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" className="h-8 text-xs" disabled={saving || previewing} onClick={() => submit()}>
                    {sendLabel ?? 'Send request to Dispatch'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* My pullout requests */}
      {shownRequests.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">My pullout requests</div>
          <div className="border-t border-border divide-y divide-border/50">
            {shownRequests.map(q => {
              const items = itemsFor(byKey, q.itemKeys);
              const overdue = isOverdueRequest(q, today);
              const isEditing = editing === q.id;
              return (
                <div key={q.id} className={`px-4 py-3 space-y-2 ${overdue ? 'bg-destructive/5' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={overdue ? 'text-destructive font-semibold' : 'font-medium'}>
                      Pull out on {q.date === today ? 'Today' : formatDate(q.date)}{overdue ? ' · day has passed' : ''}
                    </span>
                    <span className="text-muted-foreground">{q.method}</span>
                    <span className="text-muted-foreground">· {q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''}{items.length ? ` · ${gramsOf(items).toFixed(2)}g` : ''}</span>
                    <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[q.status]}`}>
                      {q.status === 'Ready' ? 'Ready for you' : q.status}
                    </span>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    {items.length > 0
                      ? items.map(r => <li key={r.id} className="truncate">{itemLine(r)}</li>)
                      : <li className="whitespace-pre-line">{q.summary}</li>}
                  </ul>
                  {q.note && !isEditing && <p className="text-[11px] italic text-muted-foreground">“{q.note}”</p>}
                  {q.dispatchReply && (
                    <p className={`text-[11px] font-medium ${q.status === 'Ready' || q.status === 'Done' ? 'text-muted-foreground' : 'text-destructive'}`}>
                      Dispatch: {q.dispatchReply}
                    </p>
                  )}
                  {q.status === 'Ready' && <p className="text-[11px] text-muted-foreground">Need another day? Ask Dispatch.</p>}

                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-3 items-end">
                        <Input type="date" min={today} value={editDate} onChange={e => setEditDate(e.target.value)} className="h-8 text-xs w-40 bg-background border-border" />
                        <MethodToggle value={editMethod} onChange={setEditMethod} />
                      </div>
                      <Textarea value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="text-xs min-h-[48px] bg-background" />
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs" disabled={saving || previewing} onClick={() => saveEdit(q)}>{previewing ? 'Preview only' : 'Save'}</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing('')}>Close</Button>
                      </div>
                    </div>
                  ) : q.status === 'Requested' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs border-border" disabled={saving || previewing} onClick={() => startEdit(q)}>
                        {previewing ? 'Preview only' : 'Change'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={saving || previewing} onClick={() => withdraw(q)}>
                        {previewing ? 'Preview only' : 'Cancel request'}
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
  );
}

// ─── Cancelled items (with the reason Dispatch typed) ────────────────────────
type CancelRange = 'all' | 'week' | 'month' | 'custom';
const CANCEL_RANGES: { key: CancelRange; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
];

export function CancelledItems({ records }: { records: DatabaseRowType[] }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<CancelRange>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const rows = useMemo(() => {
    const now = new Date();
    let from: Date | null = null;
    let to: Date | null = null;
    if (range === 'week') from = startOfWeek(now, { weekStartsOn: 1 });
    else if (range === 'month') from = startOfMonth(now);
    else if (range === 'custom') {
      from = start ? new Date(`${start}T00:00:00`) : null;
      to = end ? new Date(`${end}T23:59:59.999`) : null;
    }
    return records
      .filter(isCancelledItem)
      .map(r => ({ r, at: statusChangedAt(r) }))
      .filter(({ at }) => {
        if (!from && !to) return true;
        if (!at) return false;
        return (!from || at >= from) && (!to || at <= to);
      })
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  }, [records, range, start, end]);

  const grams = gramsOf(rows.map(x => x.r));

  return (
    <div className="rounded-xl border border-destructive/30 bg-card overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/20">
        <XCircle className="h-4 w-4 text-destructive" />
        <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Cancelled items</span>
        <span className="text-[10px] text-muted-foreground">{rows.length} item{rows.length !== 1 ? 's' : ''}{grams > 0 ? ` · ${grams.toFixed(2)}g` : ''}</span>
        <div className="h-px flex-1 bg-border/40" />
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="px-4 py-3 space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {CANCEL_RANGES.map(x => (
                <Button
                  key={x.key}
                  size="sm"
                  variant={range === x.key ? 'default' : 'outline'}
                  className={`text-xs h-7 ${range === x.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                  onClick={() => setRange(x.key)}
                >
                  {x.label}
                </Button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="flex gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Start Date</label>
                  <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="h-8 text-xs w-36 bg-background border-border" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">End Date</label>
                  <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="h-8 text-xs w-36 bg-background border-border" />
                </div>
              </div>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">No cancelled items in this period.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary/20 border-y border-border">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Cancelled</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Client</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Item</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ r, at }, i) => (
                  <tr key={r.id} className={`border-b border-border/30 align-top ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDateObj(at)}</td>
                    <td className="px-3 py-2 max-w-[150px]">
                      <div className="font-medium truncate">{r.minerName || '—'}</div>
                      <div className="text-[10px] text-muted-foreground sm:hidden truncate">{r.itemDescription}</div>
                      <div className="text-[10px] text-destructive">{r.cancelReason ? r.cancelReason : 'No reason given'}</div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate hidden sm:table-cell">{r.itemDescription || '—'}</td>
                    <td className="px-3 py-2 text-right">{r.grams ? `${r.grams}g` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
