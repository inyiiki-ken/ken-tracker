"use client";

import { useState } from 'react';
import { StickyNote } from 'lucide-react';
import type { DatabaseRowType } from '@/types';
import { formatDateShort } from '@/lib/formatters';
import { fulfilmentStage, outsourceName } from '@/lib/fulfilment';
import { parseNotes } from '@/lib/notes';

/** The search text marked in a value, like Dispatch's search highlight. */
export function Highlight({ text, query }: { text?: string; query?: string }) {
  const t = String(text ?? '');
  const q = (query ?? '').trim();
  if (!q || !t) return <>{t}</>;
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{t}</>;
  return (
    <>
      {t.slice(0, i)}
      <mark className="rounded-sm bg-primary/25 text-foreground px-0.5">{t.slice(i, i + q.length)}</mark>
      {t.slice(i + q.length)}
    </>
  );
}

/** Outsource items: a small tag, with the supplier when it isn't her own name. */
export function OutsourceTag({ r }: { r: DatabaseRowType }) {
  if (!/outsourc/i.test(String(r.status ?? ''))) return null;
  const who = outsourceName(r);
  const showWho = who && who.toUpperCase() !== String(r.liverName ?? '').trim().toUpperCase();
  return (
    <span className="inline-flex items-center rounded border border-success/30 bg-success/10 px-1 text-[10px] font-semibold text-success">
      Outsource{showWho ? ` · ${who}` : ''}
    </span>
  );
}

/** "Shipped Oct 01" / "Delivered Oct 03" for items that left. */
export function ShippedLine({ r }: { r: DatabaseRowType }) {
  const stage = fulfilmentStage(r.status);
  if (stage !== 'dispatched' && stage !== 'delivered') return null;
  const parts = [
    r.dispatchDate ? `Shipped ${formatDateShort(r.dispatchDate)}` : '',
    stage === 'delivered' && r.deliveredDate ? `Delivered ${formatDateShort(r.deliveredDate)}` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div className="text-xs text-success">{parts.join(' · ')}</div>;
}

/** Notes Dispatch / Admin wrote on the item (read-only). */
export function notesOf(r: DatabaseRowType) {
  const { remarks, notes } = parseNotes(r.liverAdminRemarks);
  return { remarks, notes, count: notes.length + (remarks ? 1 : 0) };
}

export function NotesToggle({ r }: { r: DatabaseRowType }) {
  const [open, setOpen] = useState(false);
  const { remarks, notes, count } = notesOf(r);
  if (!count) return null;
  return (
    <div>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="inline-flex items-center gap-1 text-xs text-info hover:underline py-1"
        aria-expanded={open}
      >
        <StickyNote className="h-3.5 w-3.5" /> {count} note{count !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded-md border border-info/30 bg-info/5 p-2 text-xs">
          {remarks && <p><span className="text-muted-foreground">Remarks:</span> {remarks}</p>}
          {notes.map((n, i) => (
            <p key={i}>
              <span className="text-muted-foreground">{n.author} · {n.time}:</span> {n.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
