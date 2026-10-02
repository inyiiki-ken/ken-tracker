/**
 * Notes Dispatch / Admin add to an item, stored after the remarks in the
 * "Liver/Admin Remarks" column as ⟦NOTE:author|time|text⟧. Dispatch writes
 * them; the liver's tab shows them read-only.
 */

const NOTE_SEP = '⟦NOTE:';
const NOTE_END = '⟧';

export interface ParsedNote { author: string; time: string; text: string; }

export function parseNotes(val?: string): { remarks: string; notes: ParsedNote[] } {
  if (!val) return { remarks: '', notes: [] };
  const notes: ParsedNote[] = [];
  const parts = val.split(NOTE_SEP);
  const remarks = parts[0].trim();
  for (let i = 1; i < parts.length; i++) {
    const endIdx = parts[i].indexOf(NOTE_END);
    if (endIdx === -1) continue;
    const inner = parts[i].substring(0, endIdx);
    const p1 = inner.indexOf('|');
    const p2 = inner.indexOf('|', p1 + 1);
    if (p1 === -1 || p2 === -1) continue;
    notes.push({ author: inner.substring(0, p1), time: inner.substring(p1 + 1, p2), text: inner.substring(p2 + 1) });
  }
  return { remarks, notes };
}

export function buildNoteAppend(existing: string | undefined, author: string, text: string): string {
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${existing || ''}${NOTE_SEP}${author}|${now}|${text}${NOTE_END}`;
}
