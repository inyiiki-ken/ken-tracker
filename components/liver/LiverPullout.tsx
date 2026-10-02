"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, PackageOpen, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DatabaseRowType } from '@/types';
import { formatDate, formatDateShort } from '@/lib/formatters';
import { customerKey, gramsLabel, gramsTotalLabel, groupByCustomer, parseDateRobust, sumGrams, pieceCount } from '@/lib/calculations';
import { boxFromDelivery, statusChangedInfo } from '@/lib/fulfilment';
import StatusBadge from '@/components/StatusBadge';
import { dueFor, getReminderRules, lastPurchases } from '@/lib/reminders';
import { aedLabel, collectForAED, customerMoney } from '@/lib/liverMoney';
import { DATE_RANGES, rangeBounds, type DateRange } from '@/lib/liverSales';
import { Highlight, NotesToggle, OutsourceTag, notesOf } from './LiverRowBits';
import {
  addItemsToPulloutRequest, createPulloutRequest, ensurePulloutRowKeys, getPulloutRequests,
  setPulloutRequestStatus, updatePulloutRequest,
} from '@/lib/api';
import {
  PULLOUT_METHODS, isCancelledItem, methodStatus, isOpenRequest, isOverdueRequest, isRealItemKey, isToPullOut,
  finishedAfterLoad, itemKey, itemLine, itemSummary, itemsByKey, itemsFor, pullOutOnLabel, todayISO,
  type PulloutMethod, type PulloutRequest, type PulloutRequestStatus,
} from '@/lib/pulloutRequests';
import { liverCameStatus, ownBox, requestTargetsLabel } from '@/lib/pulloutTargets';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

/** Weight of some items, e.g. "12.40g + 2 pcs" (per-piece items in pieces). */
function weightOf(items: DatabaseRowType[]): string {
  return sumGrams(items) > 0 || pieceCount(items) > 0 ? gramsTotalLabel(items) : '0g';
}

/** The free-text remarks on an item (not Dispatch's notes). */
function notesOfRemarks(r: DatabaseRowType): string {
  return notesOf(r).remarks;
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
          className={`text-xs h-9 px-4 ${value === m.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
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
export function PulloutPanel({ liver, records, allRecords, recordsAt, onRefresh, previewing, visibleIds, query, onRequestsChange, onLoaded, onOpenCustomer, open: openProp, onOpenChange }: {
  liver: string;
  /** This liver's items. */
  records: DatabaseRowType[];
  /** Every row this screen holds (her own rows for a liver), to spot shared Row Keys. */
  allRecords: DatabaseRowType[];
  /** When her records last loaded (ms), so a finished request locks its items only until they refresh. */
  recordsAt: number;
  /** Reload the records (after Dispatch moved her items). */
  onRefresh?: () => void;
  /** An admin previewing her view: nothing is sent. */
  previewing?: boolean;
  /** While searching: the rows to show. Ticks and requests still cover every item. */
  visibleIds?: Set<number> | null;
  /** The search text, to highlight. */
  query?: string;
  /** Her requests, whenever they load (the page's Today card and overdue list use them). */
  onRequestsChange?: (list: PulloutRequest[]) => void;
  /** A load ended: ok = her requests arrived, false = it failed (the page decides what that means). */
  onLoaded?: (ok: boolean) => void;
  /** Tap a customer's name: her per-customer sheet. */
  onOpenCustomer?: (customer: string) => void;
  /** Items to pull out folded open or shut; null = open when something waits to be requested or is Ready. */
  open?: boolean | null;
  onOpenChange?: (open: boolean) => void;
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
  const onRequestsChangeRef = useRef(onRequestsChange);
  onRequestsChangeRef.current = onRequestsChange;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const lastRefreshRef = useRef(Date.now());
  // When this panel last asked for her items (0 = not yet).
  const askedRefreshRef = useRef(0);

  const refreshRecords = useCallback((force = false) => {
    if (!onRefreshRef.current) return;
    if (!force && Date.now() - lastRefreshRef.current < RECORDS_REFRESH_MS) return;
    lastRefreshRef.current = Date.now();
    askedRefreshRef.current = Date.now();
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
      onRequestsChangeRef.current?.(list);
      setLoaded(true);
      onLoadedRef.current?.(true);
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
      onLoadedRef.current?.(false);
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
  // Box names from every row this screen holds, like Dispatch's (a liver's own
  // rows also carry the server's name, see liverCameStatus).
  const statuses = useMemo(() => allRecords.map(r => String(r.status ?? '')), [allRecords]);

  // Items already in an open request, and which request.
  const requestedFor = useMemo(() => {
    const m = new Map<string, PulloutRequest>();
    for (const q of requests) if (isOpenRequest(q)) for (const k of q.itemKeys) m.set(k, q);
    return m;
  }, [requests]);

  // Requests Dispatch finished since her records loaded: their items are
  // moving to For COD / Pick Up even before the refreshed records arrive.
  const recentlyDone = useMemo(() => {
    const m = new Map<string, PulloutRequest>();
    for (const q of requests) if (q.status === 'Done' && finishedAfterLoad(q.updatedAt, recordsAt)) for (const k of q.itemKeys) m.set(k, q);
    return m;
  }, [requests, recordsAt]);
  // Fetch her items then (unless just asked), so the lock ends as soon as they show where they went.
  useEffect(() => {
    if (recentlyDone.size > 0 && Date.now() - askedRefreshRef.current > 5_000) refreshRecords(true);
  }, [recentlyDone.size, refreshRecords]);

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

  // Searching shows only matching rows; what she ticked before stays ticked.
  const shows = useCallback((r: DatabaseRowType) => !visibleIds || visibleIds.has(r.id), [visibleIds]);
  const visibleFree = useMemo(() => free.filter(shows), [free, shows]);
  const hiddenPicked = pickedItems.filter(r => !shows(r)).length;

  // Deadlines ("Due Oct 03") on each row, same rules as the overdue warning.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the Settings deadlines on each refresh
  const rules = useMemo(() => getReminderRules(), [allRecords]);
  const lastBuys = useMemo(() => lastPurchases(allRecords), [allRecords]);

  // A day left open overnight moves on to today.
  useEffect(() => { if (date < today) setDate(today); }, [date, today]);

  // One group per customer, newest order first.
  const groups = useMemo(() => {
    const allByCustomer = groupByCustomer(records);
    return Array.from(groupByCustomer(toPullOut).values())
      .map(rows => {
        const sorted = [...rows].sort((a, b) => orderTime(b) - orderTime(a));
        const key = customerKey(sorted[0]);
        // Paid / balance over all her items for this customer, not only these.
        const all = allByCustomer.get(key) ?? rows;
        const money = customerMoney(all);
        return { key, name: sorted[0].minerName || '—', rows: sorted, all, newest: orderTime(sorted[0]), money };
      })
      .sort((a, b) => b.newest - a.newest);
  }, [toPullOut, records]);

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
    if (!window.confirm('Withdraw this request? Your items stay in Items to pull out.')) return;
    setSaving(true);
    try {
      await setPulloutRequestStatus({ id: q.id, status: 'Cancelled', seenUpdatedAt: q.updatedAt });
      toast.success('Request withdrawn');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw the request');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const requestedCount = toPullOut.length - free.length;
  const sendLabel = previewing ? 'Preview only' : saving ? 'Sending…' : null;
  // Folded open when something waits to be requested or a request is Ready, until she folds it.
  const autoOpen = free.length > 0 || requests.some(q => q.status === 'Ready');
  const [openLocal, setOpenLocal] = useState<boolean | null>(null);
  const isOpen = (openProp ?? openLocal) ?? autoOpen;
  const setOpen = (v: boolean) => { setOpenLocal(v); onOpenChange?.(v); };
  const shownGroups = visibleIds ? groups.map(g => ({ ...g, rows: g.rows.filter(shows) })).filter(g => g.rows.length > 0) : groups;

  /** Done: where the items went, e.g. "Done · set to For COD" (their status now, once they moved). */
  const doneLabel = (q: PulloutRequest, items: DatabaseRowType[]) => {
    const to = Array.from(new Set(items.length
      ? items.map(r => isToPullOut(r) ? liverCameStatus(r, q.method, statuses) : String(r.status ?? '').trim() || '—')
      : [methodStatus(q.method)]));
    return `Done · set to ${to.join(' / ')}`;
  };

  return (
    <div className="space-y-3">
      {previewing && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">Preview — actions are disabled</p>
      )}
      {failed && (
        <p className="text-xs text-destructive">
          Couldn&apos;t refresh your pullout requests ·{' '}
          <button className="underline px-1 py-2" onClick={() => load()}>Retry</button>
        </p>
      )}

      {/* Items to pull out */}
      <div className="rounded-xl border border-warning/40 bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left hover:bg-secondary/20"
          aria-expanded={isOpen}
        >
          <PackageOpen className="h-4 w-4 text-warning" />
          <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Items to pull out</span>
          <span className="text-xs text-muted-foreground">
            {loaded && toPullOut.length > 0
              ? `${free.length} to request · ${requestedCount} already requested`
              : `${toPullOut.length} item${toPullOut.length !== 1 ? 's' : ''}`}
            {toPullOut.length > 0 && <>{' · '}{weightOf(toPullOut)}</>}
          </span>
          <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {!isOpen ? null : toPullOut.length === 0 ? (
          <p className="border-t border-border px-4 py-4 text-xs text-muted-foreground">Nothing to pull out right now.</p>
        ) : (
          <div className="border-t border-border">
            {!loaded && !failed && <p className="px-4 py-2 text-xs text-muted-foreground">Loading your requests…</p>}
            {visibleIds && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                Showing items that match your search
                {hiddenPicked > 0 && <> · <b className="text-foreground">{pickedItems.length} ticked · {hiddenPicked} hidden by search</b></>}
              </p>
            )}
            {shownGroups.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No items to pull out match your search.</p>
            ) : (
            <>
            <label className={`flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b border-border ${!loaded || visibleFree.length === 0 ? 'opacity-50' : 'cursor-pointer'}`}>
              <GroupCheckbox
                label="Tick all"
                checked={visibleFree.length > 0 && visibleFree.every(r => picked.has(r.id))}
                partial={visibleFree.some(r => picked.has(r.id)) && !visibleFree.every(r => picked.has(r.id))}
                disabled={!loaded || visibleFree.length === 0}
                onChange={on => setMany(visibleFree, on)}
              />
              Tick all{visibleIds ? ' shown' : ''}
            </label>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary/20 border-b border-border">
                  <th className="w-8" />
                  <th className="text-left px-1 py-2 text-muted-foreground font-medium">Ordered</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Item</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
                </tr>
              </thead>
              <tbody>
                {shownGroups.flatMap(g => {
                  const freeRows = g.rows.filter(r => freeIds.has(r.id));
                  const n = freeRows.filter(r => picked.has(r.id)).length;
                  return [
                    <tr key={`g-${g.key}`} className={`border-b border-border/30 bg-secondary/20 ${freeRows.length ? 'cursor-pointer' : ''}`}
                      onClick={() => loaded && freeRows.length && setMany(freeRows, n < freeRows.length)}>
                      <td className="w-8 px-3 py-2 text-center">
                        <GroupCheckbox
                          label={`Tick all of ${g.name}`}
                          checked={freeRows.length > 0 && n === freeRows.length}
                          partial={n > 0 && n < freeRows.length}
                          disabled={!loaded || freeRows.length === 0}
                          onChange={on => setMany(freeRows, on)}
                        />
                      </td>
                      <td colSpan={3} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {onOpenCustomer ? (
                            <button type="button" className="font-semibold underline-offset-2 hover:underline text-left" onClick={e => { e.stopPropagation(); onOpenCustomer(g.key); }}>
                              <Highlight text={g.name} query={query} />
                            </button>
                          ) : <span className="font-semibold"><Highlight text={g.name} query={query} /></span>}
                          <span className="text-xs text-muted-foreground">{g.rows.length} item{g.rows.length !== 1 ? 's' : ''} · {weightOf(g.rows)}</span>
                          {g.money.due > 0 && (
                            <span className={`text-xs font-semibold ${g.money.balance > 0 ? 'text-destructive' : 'text-success'}`}>
                              {g.money.balance > 0 ? `Balance due ${aedLabel(g.money.balance)}` : 'Paid'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>,
                    ...g.rows.map(r => {
                      const k = keyOf(r);
                      const q = requestedFor.get(k);
                      const doneReq = q ? undefined : recentlyDone.get(k);
                      const done = !!doneReq;
                      const locked = !!q || done;
                      const due = dueFor(r, rules, lastBuys);
                      const collect = collectForAED([r], g.all);
                      return (
                        <tr key={r.id} className={`border-b border-border/30 align-top ${locked ? 'opacity-70' : 'cursor-pointer'}`} onClick={() => loaded && !locked && toggle(r.id)}>
                          <td className="w-8 px-3 py-2 text-center">
                            <input type="checkbox" aria-label={`Tick ${r.itemDescription || 'item'}`} disabled={!loaded || locked} checked={locked || picked.has(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} />
                          </td>
                          <td className="px-1 py-2 text-muted-foreground whitespace-nowrap">{r.dateOfLive ? formatDateShort(r.dateOfLive) : '—'}</td>
                          <td className="px-3 py-2 min-w-0 break-words">
                            <div><Highlight text={r.itemDescription || '—'} query={query} /></div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              {r.orderId && <span><Highlight text={r.orderId} query={query} /></span>}
                              <OutsourceTag r={r} />
                            </div>
                            {due && (
                              <div className={`text-xs ${due.due.getTime() < Date.now() ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                                Due {formatDateShort(due.due.toISOString())}
                              </div>
                            )}
                            {collect > 0 && <div className="text-xs font-semibold text-attention">Collect {aedLabel(collect)}</div>}
                            {q && (
                              <div className="text-xs text-primary">
                                In request · {q.date === today ? 'pull out today' : `pull out on ${formatDateShort(q.date)}`} · {q.status === 'Ready' ? 'Ready for you' : 'waiting for Dispatch'}
                              </div>
                            )}
                            {doneReq && <div className="text-xs text-primary">Moved by Dispatch to {liverCameStatus(r, doneReq.method, statuses)} · updating…</div>}
                            <NotesToggle r={r} />
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{gramsLabel(r)}</td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
            </>
            )}

            {/* Request form */}
            {loaded && free.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground bg-secondary/10">All your items are in a request below.</p>
            ) : loaded && (
              <div className="p-4 space-y-3 bg-secondary/10">
                <p className="text-xs font-medium">
                  Request pullout {pickedItems.length > 0 && <span className="text-primary">· {pickedItems.length} item{pickedItems.length !== 1 ? 's' : ''} · {weightOf(pickedItems)}</span>}
                </p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">Day you will come</label>
                    <Input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs w-40 bg-background border-border" />
                  </div>
                  {(needsMethod || pickedItems.length === 0) && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-muted-foreground">COD or Pick Up</label>
                      <MethodToggle value={method} onChange={m => { setMethod(m); setMethodChosen(true); }} />
                    </div>
                  )}
                </div>
                {needsMethod && !suggested && codCount > 0 && (
                  <p className="text-xs text-warning">
                    {codCount} of these {codCount === 1 ? 'is a COD client' : 'are COD clients'} — consider sending two requests.
                  </p>
                )}
                {ownBoxNotes.length > 0 && (
                  <p className="text-xs text-muted-foreground">{ownBoxNotes.join(' · ')} when you come.</p>
                )}
                {partial.length > 0 && (
                  <p className="text-xs text-warning">
                    {partial.map(p => `You left ${p.left} of ${p.name}'s items`).join(' · ')} — {partial.length === 1 && partial[0].left === 1 ? 'it' : 'they'} will go separately.
                  </p>
                )}
                <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="text-xs min-h-[48px] bg-background" />
                {joinTarget ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="h-9 text-xs" disabled={saving || previewing} onClick={() => submit(joinTarget)}>
                      {sendLabel ?? `Add to my request for ${formatDate(joinTarget.date)}`}
                    </Button>
                    <Button size="sm" variant="outline" className="h-9 text-xs border-border" disabled={saving || previewing} onClick={() => submit()}>
                      Send as a new request
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" className="h-9 text-xs" disabled={saving || previewing} onClick={() => submit()}>
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
                      {pullOutOnLabel(q.date, today)}{overdue ? ' · day has passed' : ''}
                    </span>
                    <span className="text-muted-foreground">{requestTargetsLabel(items, q.method, statuses)}</span>
                    <span className="text-muted-foreground">· {q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''}{items.length ? ` · ${weightOf(items)}` : ''}</span>
                    <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[q.status]}`}>
                      {q.status === 'Ready' ? 'Ready for you' : q.status === 'Done' ? doneLabel(q, items) : q.status}
                    </span>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {items.length > 0
                      ? items.map(r => <li key={r.id} className="break-words">{itemLine(r)}</li>)
                      : <li className="whitespace-pre-line">{q.summary}</li>}
                  </ul>
                  {q.note && !isEditing && <p className="text-xs italic text-muted-foreground">“{q.note}”</p>}
                  {q.dispatchReply && (
                    <p className={`text-xs font-medium ${q.status === 'Ready' || q.status === 'Done' ? 'text-muted-foreground' : 'text-destructive'}`}>
                      Dispatch: {q.dispatchReply}
                    </p>
                  )}
                  {q.status === 'Ready' && <p className="text-xs text-muted-foreground">Need another day? Ask Dispatch.</p>}

                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-3 items-end">
                        <Input type="date" min={today} value={editDate} onChange={e => setEditDate(e.target.value)} className="h-9 text-xs w-40 bg-background border-border" />
                        {/* COD / Pick Up only matters when some item is local. */}
                        {(items.length === 0 || items.some(r => !ownBox(r))) && <MethodToggle value={editMethod} onChange={setEditMethod} />}
                      </div>
                      <Textarea value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="text-xs min-h-[48px] bg-background" />
                      <div className="flex gap-2">
                        <Button size="sm" className="h-9 text-xs" disabled={saving || previewing} onClick={() => saveEdit(q)}>{previewing ? 'Preview only' : 'Save'}</Button>
                        <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => setEditing('')}>Close</Button>
                      </div>
                    </div>
                  ) : q.status === 'Requested' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-9 text-xs border-border" disabled={saving || previewing} onClick={() => startEdit(q)}>
                        {previewing ? 'Preview only' : 'Change'}
                      </Button>
                      {/* Kept away from Change, so it isn't tapped by mistake. */}
                      <Button size="sm" variant="ghost" className="ml-auto h-9 text-xs text-destructive" disabled={saving || previewing} onClick={() => withdraw(q)}>
                        {previewing ? 'Preview only' : 'Withdraw request'}
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

// ─── Cancelled / returned items (with the reason Dispatch typed) ─────────────

export function CancelledItems({ records, query, onOpenCustomer, open: openProp, onOpenChange }: {
  records: DatabaseRowType[];
  /** The search text, to highlight. */
  query?: string;
  onOpenCustomer?: (customer: string) => void;
  /** Folded open or shut (shut by default); the page opens it from its link. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = (f: (v: boolean) => boolean) => { const v = f(open); setOpenLocal(v); onOpenChange?.(v); };
  const [range, setRange] = useState<DateRange>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const rows = useMemo(() => {
    const b = rangeBounds(range, new Date(), start, end);
    return records
      .filter(isCancelledItem)
      // When it was cancelled; an item cancelled straight in the sheet has only its order date.
      .map(r => ({ r, info: statusChangedInfo(r) }))
      .filter(({ info }) => {
        if (!b) return true;
        if (!info) return false;
        return (!b.from || info.date >= b.from) && (!b.to || info.date <= b.to);
      })
      .sort((a, b) => (b.info?.date.getTime() ?? 0) - (a.info?.date.getTime() ?? 0));
  }, [records, range, start, end]);

  const items = rows.map(x => x.r);
  const weighs = sumGrams(items) > 0 || pieceCount(items) > 0;

  return (
    <div id="liver-cancelled" className="rounded-xl border border-destructive/30 bg-card overflow-hidden scroll-mt-24">
      <button onClick={() => setOpen(v => !v)} className="w-full flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-left hover:bg-secondary/20" aria-expanded={open}>
        <XCircle className="h-4 w-4 text-destructive" />
        <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Cancelled / Returned</span>
        <span className="text-xs text-muted-foreground">{rows.length} item{rows.length !== 1 ? 's' : ''}{weighs ? ` · ${weightOf(items)}` : ''}</span>
        <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="px-4 py-3 space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {DATE_RANGES.map(x => (
                <Button
                  key={x.key}
                  size="sm"
                  variant={range === x.key ? 'default' : 'outline'}
                  className={`text-xs h-9 ${range === x.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                  onClick={() => setRange(x.key)}
                >
                  {x.label}
                </Button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="flex flex-wrap gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Cancelled from</label>
                  <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="h-9 text-xs w-40 bg-background border-border" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Cancelled to</label>
                  <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="h-9 text-xs w-40 bg-background border-border" />
                </div>
              </div>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">No cancelled or returned items in this period.</p>
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
                {rows.map(({ r, info }, i) => {
                  const returned = /^return/i.test(String(r.status ?? '').trim());
                  const remarks = notesOfRemarks(r);
                  return (
                    <tr key={r.id} className={`border-b border-border/30 align-top ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {!info ? <span className="text-muted-foreground">—</span>
                          : info.source === 'history' ? <span className="text-muted-foreground">{formatDateShort(info.date.toISOString())}</span>
                          // No cancel date recorded: show the order date, and say so.
                          : <span className="text-muted-foreground/70 italic">Ordered {formatDateShort(info.date.toISOString())}</span>}
                      </td>
                      <td className="px-3 py-2 min-w-0 break-words">
                        {onOpenCustomer ? (
                          <button type="button" className="font-medium text-left underline-offset-2 hover:underline" onClick={() => onOpenCustomer(customerKey(r))}>
                            <Highlight text={r.minerName || '—'} query={query} />
                          </button>
                        ) : <div className="font-medium"><Highlight text={r.minerName || '—'} query={query} /></div>}
                        <div className="text-xs text-muted-foreground sm:hidden">
                          <Highlight text={[r.itemDescription, r.orderId].filter(Boolean).join(' · ')} query={query} />
                        </div>
                        <div className="mt-0.5"><StatusBadge status={String(r.status ?? '').trim()} /></div>
                        {r.cancelReason
                          ? <div className="text-xs text-destructive">Reason: {r.cancelReason}</div>
                          : returned
                            ? <div className="text-xs text-muted-foreground">Returned{remarks ? ` · ${remarks}` : ''}</div>
                            : <div className="text-xs text-destructive">No reason given</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground min-w-0 break-words hidden sm:table-cell">
                        <Highlight text={r.itemDescription || '—'} query={query} />
                        {r.orderId && <div className="text-xs"><Highlight text={r.orderId} query={query} /></div>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{gramsLabel(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
