"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, PackageCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { DatabaseRowType } from '@/types';
import { formatDate } from '@/lib/formatters';
import { getPulloutRequests, setPulloutRequestStatus, updatePulloutRequest } from '@/lib/api';
import {
  PULLOUT_METHODS, findItems, isOpenRequest, isOverdueRequest, methodStatus, todayISO,
  type PulloutMethod, type PulloutRequest,
} from '@/lib/pulloutRequests';

/**
 * Livers' pullout requests, at the top of the Dispatch board: prepare the
 * items, mark Ready, and when the liver comes set them to For COD / For Pick Up.
 */
export default function PulloutRequestsPanel({ records, onBulkUpdate, onUpdate }: {
  records: DatabaseRowType[];
  onBulkUpdate?: (updates: { rowId: number; fields: Partial<DatabaseRowType> }[]) => Promise<void>;
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}) {
  const [requests, setRequests] = useState<PulloutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setRequests(await getPulloutRequests());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load pullout requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const openRequests = useMemo(() => requests.filter(isOpenRequest), [requests]);
  const today = todayISO();

  const run = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy('');
    }
  };

  const markDone = (q: PulloutRequest) => run(q.id, async () => {
    const status = methodStatus(q.method);
    const updates = findItems(records, q.itemKeys).map(r => ({ rowId: r.id, fields: { status } as Partial<DatabaseRowType> }));
    if (updates.length) {
      if (onBulkUpdate) await onBulkUpdate(updates);
      else for (const u of updates) await onUpdate(u.rowId, u.fields);
    }
    await setPulloutRequestStatus({ id: q.id, status: 'Done' });
  }, `Done — items set to ${methodStatus(q.method)}`);

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
            const items = findItems(records, q.itemKeys);
            const overdue = isOverdueRequest(q, today);
            const grams = items.reduce((s, r) => s + (Number(r.grams) || 0), 0);
            return (
              <div key={q.id} className={`px-4 py-3 space-y-2 ${overdue ? 'bg-destructive/5' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-cinzel font-bold text-sm text-primary">{q.liver}</span>
                  <span className={`text-xs ${overdue ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                    {q.date === today ? 'Today' : formatDate(q.date)}{overdue ? ' · overdue' : ''}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${q.status === 'Ready' ? 'border-success/40 bg-success/10 text-success' : 'border-warning/40 bg-warning/10 text-warning'}`}>
                    {q.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''}{grams > 0 ? ` · ${grams.toFixed(2)}g` : ''}</span>
                  <div className="ml-auto flex gap-1">
                    {PULLOUT_METHODS.map(m => (
                      <button
                        key={m.key}
                        disabled={busy === q.id}
                        onClick={() => q.method !== m.key && run(q.id, () => updatePulloutRequest({ id: q.id, method: m.key as PulloutMethod }), `Changed to ${m.label}`)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border ${q.method === m.key ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-border text-muted-foreground hover:bg-secondary'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                {q.note && <p className="text-xs italic text-muted-foreground">“{q.note}”</p>}
                <ul className="text-xs space-y-0.5">
                  {items.length > 0 ? items.map(r => (
                    <li key={r.id} className="flex gap-2">
                      <span className="font-medium truncate max-w-[140px]">{r.minerName || '—'}</span>
                      <span className="text-muted-foreground truncate flex-1">{r.itemDescription || '—'}</span>
                      <span className="shrink-0">{r.grams ? `${r.grams}g` : ''}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{r.status}</span>
                    </li>
                  )) : (
                    <li className="whitespace-pre-line text-muted-foreground">{q.summary || 'Items not found — refresh.'}</li>
                  )}
                </ul>
                <div className="flex flex-wrap gap-2 pt-1">
                  {q.status === 'Requested' && (
                    <Button size="sm" className="h-7 text-xs" disabled={busy === q.id}
                      onClick={() => run(q.id, () => setPulloutRequestStatus({ id: q.id, status: 'Ready' }), 'Marked Ready — the liver can see it')}>
                      Mark Ready
                    </Button>
                  )}
                  {q.status === 'Ready' && (
                    <>
                      <Button size="sm" className="h-7 text-xs" disabled={busy === q.id} onClick={() => markDone(q)}>
                        Liver came — set to {methodStatus(q.method)}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy === q.id}
                        onClick={() => run(q.id, () => setPulloutRequestStatus({ id: q.id, status: 'Requested' }), 'Back to Requested')}>
                        Not ready
                      </Button>
                    </>
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
