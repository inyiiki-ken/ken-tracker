"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, PackageOpen, XCircle } from 'lucide-react';
import { startOfWeek, startOfMonth } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DatabaseRowType } from '@/types';
import { formatDate, formatDateObj } from '@/lib/formatters';
import { createPulloutRequest, getPulloutRequests, setPulloutRequestStatus, updatePulloutRequest } from '@/lib/api';
import {
  PULLOUT_METHODS, findItems, isCancelledItem, isOpenRequest, isOverdueRequest, isToPullOut,
  itemKey, itemSummary, statusChangedAt, todayISO,
  type PulloutMethod, type PulloutRequest,
} from '@/lib/pulloutRequests';

function gramsOf(items: DatabaseRowType[]): number {
  return items.reduce((s, r) => s + (Number(r.grams) || 0), 0);
}

function MethodToggle({ value, onChange, disabled }: { value: PulloutMethod; onChange: (m: PulloutMethod) => void; disabled?: boolean }) {
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

// ─── Items to pull out + pullout requests ────────────────────────────────────
export function PulloutPanel({ liver, records, allRecords }: {
  liver: string;
  /** This liver's items. */
  records: DatabaseRowType[];
  allRecords: DatabaseRowType[];
}) {
  const [requests, setRequests] = useState<PulloutRequest[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PulloutMethod>('Pick Up');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string>('');
  const [editDate, setEditDate] = useState('');
  const [editMethod, setEditMethod] = useState<PulloutMethod>('Pick Up');
  const [editNote, setEditNote] = useState('');

  const load = useCallback(async () => {
    if (!liver) return;
    try {
      setRequests(await getPulloutRequests({ liver }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load your pullout requests');
    }
  }, [liver]);

  useEffect(() => {
    setRequests([]);
    setPicked(new Set());
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const toPullOut = useMemo(() => records.filter(isToPullOut), [records]);

  // Items already in an open request, and which request.
  const requestedFor = useMemo(() => {
    const m = new Map<string, PulloutRequest>();
    for (const q of requests) if (isOpenRequest(q)) for (const k of q.itemKeys) m.set(k, q);
    return m;
  }, [requests]);

  const free = toPullOut.filter(r => !requestedFor.has(itemKey(r)));
  const pickedItems = toPullOut.filter(r => picked.has(itemKey(r)));
  const today = todayISO();

  // Open requests first, then the last few finished ones.
  const shownRequests = useMemo(() => {
    const open = requests.filter(isOpenRequest);
    const closed = requests.filter(q => !isOpenRequest(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);
    return [...open, ...closed];
  }, [requests]);

  const toggle = (k: string) => setPicked(prev => {
    const next = new Set(prev);
    next.has(k) ? next.delete(k) : next.add(k);
    return next;
  });

  const submit = async () => {
    if (pickedItems.length === 0) { toast.error('Tick the items you will pull out.'); return; }
    if (!date) { toast.error('Pick the day you will come.'); return; }
    setSaving(true);
    try {
      await createPulloutRequest({
        input: {
          liver,
          date,
          method,
          note,
          itemKeys: pickedItems.map(itemKey),
          summary: itemSummary(pickedItems),
        },
      });
      toast.success('Pullout request sent to Dispatch');
      setPicked(new Set());
      setNote('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the request');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (q: PulloutRequest) => {
    setEditing(q.id);
    setEditDate(q.date);
    setEditMethod(q.method);
    setEditNote(q.note);
  };

  const saveEdit = async (q: PulloutRequest) => {
    setSaving(true);
    try {
      await updatePulloutRequest({ id: q.id, date: editDate, method: editMethod, note: editNote });
      toast.success('Request updated');
      setEditing('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the request');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (q: PulloutRequest) => {
    if (!window.confirm('Cancel this pullout request?')) return;
    setSaving(true);
    try {
      await setPulloutRequestStatus({ id: q.id, status: 'Cancelled' });
      toast.success('Request cancelled');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel the request');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Items to pull out */}
      <div className="rounded-xl border border-warning/40 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <PackageOpen className="h-4 w-4 text-warning" />
          <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Items to pull out</span>
          <span className="text-[10px] text-muted-foreground">{toPullOut.length} item{toPullOut.length !== 1 ? 's' : ''} · {gramsOf(toPullOut).toFixed(2)}g</span>
          <div className="h-px flex-1 bg-border/40" />
        </div>
        {toPullOut.length === 0 ? (
          <p className="border-t border-border px-4 py-4 text-xs text-muted-foreground">Nothing to pull out right now.</p>
        ) : (
          <div className="border-t border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-secondary/20 border-b border-border">
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Tick all"
                      checked={free.length > 0 && free.every(r => picked.has(itemKey(r)))}
                      onChange={e => setPicked(e.target.checked ? new Set(free.map(itemKey)) : new Set())}
                    />
                  </th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Client</th>
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Item</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
                </tr>
              </thead>
              <tbody>
                {toPullOut.map((r, i) => {
                  const k = itemKey(r);
                  const q = requestedFor.get(k);
                  return (
                    <tr key={r.id} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/10'} ${q ? 'opacity-70' : 'cursor-pointer'}`} onClick={() => !q && toggle(k)}>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" disabled={!!q} checked={!!q || picked.has(k)} onChange={() => toggle(k)} onClick={e => e.stopPropagation()} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.dateOfLive ? formatDate(r.dateOfLive) : '—'}</td>
                      <td className="px-3 py-2 font-medium max-w-[110px]">
                        <div className="truncate">{r.minerName || '—'}</div>
                        {q && <div className="text-[10px] font-normal text-primary">Requested · {formatDate(q.date)} · {q.status}</div>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate hidden sm:table-cell">{r.itemDescription || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.grams ? `${r.grams}g` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Request form */}
            <div className="p-4 space-y-3 bg-secondary/10">
              <p className="text-xs font-medium">
                Request pullout {pickedItems.length > 0 && <span className="text-primary">· {pickedItems.length} item{pickedItems.length !== 1 ? 's' : ''} · {gramsOf(pickedItems).toFixed(2)}g</span>}
              </p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">Day you will come</label>
                  <Input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className="h-8 text-xs w-40 bg-background border-border" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-muted-foreground">COD or Pick Up</label>
                  <MethodToggle value={method} onChange={setMethod} />
                </div>
              </div>
              <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="text-xs min-h-[48px] bg-background" />
              <Button size="sm" className="h-8 text-xs" disabled={saving || pickedItems.length === 0} onClick={submit}>
                {saving ? 'Sending…' : 'Send request to Dispatch'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* My pullout requests */}
      {shownRequests.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">My pullout requests</div>
          <div className="border-t border-border divide-y divide-border/50">
            {shownRequests.map(q => {
              const items = findItems(allRecords, q.itemKeys);
              const overdue = isOverdueRequest(q, today);
              const isEditing = editing === q.id;
              return (
                <div key={q.id} className={`px-4 py-3 space-y-2 ${overdue ? 'bg-destructive/5' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={overdue ? 'text-destructive font-semibold' : 'font-medium'}>
                      {q.date === today ? 'Today' : formatDate(q.date)}{overdue ? ' · day has passed' : ''}
                    </span>
                    <span className="text-muted-foreground">{q.method}</span>
                    <span className="text-muted-foreground">· {q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''}{items.length ? ` · ${gramsOf(items).toFixed(2)}g` : ''}</span>
                    <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_STYLE[q.status]}`}>
                      {q.status === 'Ready' ? 'Ready for you' : q.status}
                    </span>
                  </div>
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    {items.length > 0
                      ? items.map(r => <li key={r.id} className="truncate">{[r.minerName, r.itemDescription, r.grams ? `${r.grams}g` : ''].filter(Boolean).join(' · ')}</li>)
                      : <li className="whitespace-pre-line">{q.summary}</li>}
                  </ul>
                  {q.note && !isEditing && <p className="text-[11px] italic text-muted-foreground">“{q.note}”</p>}

                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-3 items-end">
                        <Input type="date" min={today} value={editDate} onChange={e => setEditDate(e.target.value)} className="h-8 text-xs w-40 bg-background border-border" />
                        <MethodToggle value={editMethod} onChange={setEditMethod} />
                      </div>
                      <Textarea value={editNote} onChange={e => setEditNote(e.target.value)} placeholder="Note for Dispatch (optional)" className="text-xs min-h-[48px] bg-background" />
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs" disabled={saving} onClick={() => saveEdit(q)}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing('')}>Close</Button>
                      </div>
                    </div>
                  ) : q.status === 'Requested' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs border-border" disabled={saving} onClick={() => startEdit(q)}>Change</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={saving} onClick={() => withdraw(q)}>Cancel request</Button>
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
