"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, PackageCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DatabaseRowType } from '@/types';
import { formatDate } from '@/lib/formatters';
import { gramsLabel, gramsTotalLabel, sumGrams, pieceCount } from '@/lib/calculations';
import { completePulloutRequest, getPulloutRequests, setPulloutRequestStatus, undoCompletePulloutRequest, updatePulloutRequest } from '@/lib/api';
import {
  PULLOUT_METHODS, isOpenRequest, isOverdueRequest, itemsByKey, itemsFor, todayISO,
  type LiverCameMove, type LiverCamePlan, type PulloutMethod, type PulloutRequest,
} from '@/lib/pulloutRequests';
import { liverCameStatus } from '@/lib/pulloutTargets';
import { useVisiblePolling } from '@/lib/useVisiblePolling';

/** "3 set to For COD · 1 set to Reseller · 1 skipped (Cancelled)". */
function planSummary(plan: LiverCamePlan): string {
  const byTo = new Map<string, number>();
  for (const m of plan.moves) byTo.set(m.to, (byTo.get(m.to) ?? 0) + 1);
  const parts = Array.from(byTo, ([to, n]) => `${n} set to ${to}`);
  if (plan.skipped.length) parts.push(`${plan.skipped.length} skipped (${Array.from(new Set(plan.skipped.map(s => s.reason))).join(', ')})`);
  if (plan.missing) parts.push(`${plan.missing} not found`);
  return parts.join(' · ') || 'no items moved';
}

/**
 * Livers' pullout requests, at the top of the Dispatch board: prepare the
 * items, mark Ready, reply / move the day / cancel, and when the liver comes
 * set them to For COD / For Pick Up (international and reseller items to their
 * own box).
 */
export default function PulloutRequestsPanel({ records, onRefresh }: {
  records: DatabaseRowType[];
  /** Reload the records after items moved. */
  onRefresh?: () => void;
}) {
  const [requests, setRequests] = useState<PulloutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState('');
  // Drafts per request: Dispatch's reply, and a new day while "Change day" is open.
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [dayEdit, setDayEdit] = useState<Record<string, string>>({});
  const failedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setRequests(await getPulloutRequests());
      failedRef.current = false;
      setFailed(false);
    } catch (err) {
      // One toast per failure streak; then the quiet line in the header.
      if (!failedRef.current) toast.error(err instanceof Error ? err.message : 'Could not load pullout requests');
      failedRef.current = true;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisiblePolling(load, 60_000);

  const openRequests = useMemo(() => requests.filter(isOpenRequest), [requests]);
  const byKey = useMemo(() => itemsByKey(records), [records]);
  const statuses = useMemo(() => records.map(r => String(r.status ?? '')), [records]);
  const today = todayISO();

  const clearDrafts = (id: string) => {
    setReplies(p => { const n = { ...p }; delete n[id]; return n; });
    setDayEdit(p => { const n = { ...p }; delete n[id]; return n; });
  };

  const run = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      clearDrafts(id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
      await load();
    } finally {
      setBusy('');
    }
  };

  const undo = async (q: PulloutRequest, moves: LiverCameMove[]) => {
    try {
      const res = await undoCompletePulloutRequest({ id: q.id, moves });
      toast.success(`Undone — ${res.restored} item${res.restored !== 1 ? 's' : ''} back${res.skipped ? ` · ${res.skipped} changed since, left as they are` : ''}`);
      onRefresh?.();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not undo');
    }
  };

  // Ask first (the plan comes from the sheet as it is now), then move the items
  // and mark Done in one server step.
  const liverCame = async (q: PulloutRequest) => {
    setBusy(q.id);
    try {
      const plan = await completePulloutRequest({ id: q.id, dryRun: true, seenUpdatedAt: q.updatedAt });
      const lines = [
        ...plan.moves.map(m => `• ${m.summary} → ${m.to}`),
        ...plan.skipped.map(s => `• ${s.summary} — left as ${s.reason}`),
      ].join('\n');
      const problems = plan.missing + plan.skipped.length;
      const anyway = `${problems} of ${plan.total} item${plan.total !== 1 ? 's' : ''} not found / already moved — mark Done anyway?`;
      const msg = plan.moves.length === 0
        ? `${anyway}${lines ? `\n\n${lines}` : ''}`
        : `${q.liver} came. Set these items:\n\n${lines}${problems ? `\n\n${anyway}` : ''}`;
      if (!window.confirm(msg)) return;
      const done = await completePulloutRequest({ id: q.id, expectMoves: plan.moves.length, seenUpdatedAt: q.updatedAt });
      const moves = done.moves;
      toast.success(`Done — ${planSummary(done)}`, moves.length
        ? { duration: 10_000, action: { label: 'Undo', onClick: () => { void undo(q, moves); } } }
        : undefined);
      clearDrafts(q.id);
      onRefresh?.();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
      await load();
    } finally {
      setBusy('');
    }
  };

  const notReady = (q: PulloutRequest) => {
    // A reason typed now: an earlier reply still in the box would tell her something out of date.
    const typed = (replies[q.id] ?? '').trim();
    if (!typed || typed === String(q.dispatchReply ?? '').trim()) { toast.error('Write why it isn’t ready now, so the liver knows.'); return; }
    void run(q.id, () => setPulloutRequestStatus({ id: q.id, status: 'Requested', reply: typed, seenUpdatedAt: q.updatedAt }), 'Back to Requested — the liver sees your reply');
  };

  const cancelRequest = (q: PulloutRequest, reply: string) => {
    const tell = reply.trim() ? `\n\nShe will see: “${reply.trim()}”` : '\n\nTip: write a reply first so she knows why.';
    if (!window.confirm(`Cancel ${q.liver}'s pullout request for ${formatDate(q.date)}?${tell}`)) return;
    void run(q.id, () => setPulloutRequestStatus({ id: q.id, status: 'Cancelled', reply: reply.trim(), seenUpdatedAt: q.updatedAt }), 'Request cancelled');
  };

  const saveDay = (q: PulloutRequest, day: string) => {
    if (!day || day < today) { toast.error('Pick today or a later day.'); return; }
    void run(q.id, () => updatePulloutRequest({ id: q.id, date: day, seenUpdatedAt: q.updatedAt }), `Moved to ${formatDate(day)}`);
  };

  if (loading || openRequests.length === 0) return null;

  return (
    <div className="mx-4 mt-4 rounded-xl border border-primary/30 bg-card overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/20"
      >
        <PackageCheck className="h-4 w-4 text-primary" />
        <span className="font-cinzel text-sm text-foreground">Pullout Requests</span>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{openRequests.length}</span>
        {failed && <span className="text-[10px] text-destructive">Couldn&apos;t refresh</span>}
        <div className="h-px flex-1 bg-border/40" />
        <span
          role="button"
          tabIndex={0}
          title="Refresh"
          onClick={e => { e.stopPropagation(); load(); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); load(); } }}
          className="p-1 rounded hover:bg-secondary"
        >
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {openRequests.map(q => {
            const items = itemsFor(byKey, q.itemKeys);
            const notFound = items.length === 0;
            const overdue = isOverdueRequest(q, today);
            // Same grams rule as the liver's own request card.
            const weighs = sumGrams(items) > 0 || pieceCount(items) > 0;
            const isBusy = busy === q.id;
            const reply = replies[q.id] ?? q.dispatchReply;
            const day = dayEdit[q.id];
            const targets = Array.from(new Set(items.map(r => liverCameStatus(r, q.method, statuses))));
            return (
              <div key={q.id} className={`px-4 py-3 space-y-2 ${overdue ? 'bg-destructive/5' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-cinzel font-bold text-sm text-primary">{q.liver}</span>
                  <span className={`text-xs ${overdue ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                    Pull out on {q.date === today ? 'Today' : formatDate(q.date)}{overdue ? ' · overdue' : ''}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${q.status === 'Ready' ? 'border-success/40 bg-success/10 text-success' : 'border-warning/40 bg-warning/10 text-warning'}`}>
                    {q.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''}{weighs ? ` · ${gramsTotalLabel(items)}` : ''}</span>
                  {q.onBehalf && q.requestedBy && <span className="text-[10px] text-muted-foreground">by {q.requestedBy}</span>}
                  <div className="ml-auto flex gap-1.5">
                    {PULLOUT_METHODS.map(m => (
                      <button
                        key={m.key}
                        disabled={isBusy}
                        onClick={() => q.method !== m.key && run(q.id, () => updatePulloutRequest({ id: q.id, method: m.key as PulloutMethod, seenUpdatedAt: q.updatedAt }), `Changed to ${m.label}`)}
                        className={`text-xs px-3 py-1.5 rounded-full border ${q.method === m.key ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border text-muted-foreground hover:bg-secondary'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                {q.note && <p className="text-xs italic text-muted-foreground">“{q.note}”</p>}
                <ul className="text-xs space-y-0.5">
                  {notFound ? (
                    <li className="text-destructive font-medium">Items not found — refresh</li>
                  ) : items.map(r => (
                    <li key={r.id} className="flex gap-2">
                      <span className="font-medium truncate max-w-[140px]">{r.minerName || '—'}</span>
                      <span className="text-muted-foreground truncate flex-1">{r.itemDescription || '—'}</span>
                      <span className="shrink-0">{gramsLabel(r) === '—' ? '' : gramsLabel(r)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{r.status}</span>
                    </li>
                  ))}
                </ul>

                {/* Reply to the liver (shown on her request card) */}
                <div className="flex gap-2">
                  <Input
                    value={reply}
                    onChange={e => setReplies(p => ({ ...p, [q.id]: e.target.value }))}
                    placeholder="Reply to the liver (e.g. Ring not found — call me)"
                    className="h-8 text-xs bg-background border-border"
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs border-border shrink-0" disabled={isBusy || reply.trim() === q.dispatchReply}
                    onClick={() => run(q.id, () => updatePulloutRequest({ id: q.id, reply: reply.trim(), seenUpdatedAt: q.updatedAt }), 'Reply sent')}>
                    Send reply
                  </Button>
                </div>

                {day !== undefined && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <Input type="date" min={today} value={day} onChange={e => setDayEdit(p => ({ ...p, [q.id]: e.target.value }))} className="h-8 text-xs w-40 bg-background border-border" />
                    <Button size="sm" className="h-8 text-xs" disabled={isBusy} onClick={() => saveDay(q, day)}>Save day</Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setDayEdit(p => { const n = { ...p }; delete n[q.id]; return n; })}>Close</Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {q.status === 'Requested' && (
                    <Button size="sm" className="h-8 text-xs" disabled={isBusy}
                      onClick={() => run(q.id, () => setPulloutRequestStatus({ id: q.id, status: 'Ready', seenUpdatedAt: q.updatedAt }), 'Marked Ready — the liver can see it')}>
                      Mark Ready
                    </Button>
                  )}
                  {q.status === 'Ready' && (
                    <>
                      <Button size="sm" className="h-8 text-xs" disabled={isBusy || notFound} onClick={() => liverCame(q)}>
                        {targets.length === 1 ? `Liver came — set to ${targets[0]}` : 'Liver came'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={isBusy} onClick={() => notReady(q)}>
                        Not ready
                      </Button>
                    </>
                  )}
                  {day === undefined && (
                    <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={isBusy}
                      onClick={() => setDayEdit(p => ({ ...p, [q.id]: q.date < today ? today : q.date }))}>
                      Change day
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={isBusy} onClick={() => cancelRequest(q, reply)}>
                    Cancel request
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
