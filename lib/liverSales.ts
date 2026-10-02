/**
 * Pure helpers for the liver's My Sales tab: date ranges, status groups in
 * Crown's box order, and the per-live summary.
 */

import type { DatabaseRowType } from '@/types';
import { startOfMonth, startOfWeek, endOfMonth, subMonths } from 'date-fns';
import { parseDateRobust, sumGrams, customerKey } from '@/lib/calculations';
import { ORDER_BOXES, boxFromStatus, dayKey, fulfilmentStage, isSold, isStillWithAdmin } from '@/lib/fulfilment';

// ─── Date ranges ─────────────────────────────────────────────────────────────

export type DateRange = 'all' | 'week' | 'month' | 'lastMonth' | 'custom';

export const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'custom', label: 'Custom' },
];

/**
 * From / to of a range, or null for All Time. Custom with no dates is All Time;
 * a reversed custom range is swapped. Custom days are whole local days.
 */
export function rangeBounds(range: DateRange, now: Date, start = '', end = ''): { from: Date | null; to: Date | null } | null {
  if (range === 'week') return { from: startOfWeek(now, { weekStartsOn: 1 }), to: null };
  if (range === 'month') return { from: startOfMonth(now), to: null };
  if (range === 'lastMonth') {
    const m = subMonths(now, 1);
    return { from: startOfMonth(m), to: endOfMonth(m) };
  }
  if (range === 'custom') {
    let [a, b] = [start, end];
    if (!a && !b) return null;
    if (a && b && a > b) [a, b] = [b, a];
    return {
      from: a ? new Date(`${a}T00:00:00`) : null,
      to: b ? new Date(`${b}T23:59:59.999`) : null,
    };
  }
  return null;
}

/** true / false, or null when the date can't be read. */
export function inBounds(dateStr: string | undefined, b: { from: Date | null; to: Date | null }): boolean | null {
  const d = parseDateRobust(dateStr);
  if (!d) return null;
  return (!b.from || d >= b.from) && (!b.to || d <= b.to);
}

// ─── Status groups ───────────────────────────────────────────────────────────

/** A row with no status shows under Waiting for Details, as Admin shows it. */
export function statusOf(r: DatabaseRowType): string {
  return String(r.status ?? '').trim() || 'Waiting for Details';
}

/**
 * Where a status sits in the page, following Crown's boxes:
 * With Admin (Pending, Waiting for…, payment holds) → For Pullout → Outsource →
 * For International Shipment → For COD → For Pick Up → Reseller → Dispatched →
 * Delivered. Statuses that fit none go last.
 */
export function rankStatus(status: string): number {
  const s = status.trim().toLowerCase();
  const box = boxFromStatus(s);
  if (box) {
    const i = ORDER_BOXES.findIndex(b => b.key === box);
    return 2 + (i < 0 ? ORDER_BOXES.length : i);
  }
  if (s === 'dispatch' || /\bpull\s?-?out\b/.test(s)) return 1;
  if (isStillWithAdmin(s) && /pending|waiting|payment|paid|hold|tabby|tamara|verif|layaway|downpayment/.test(s)) return 0;
  return 2 + ORDER_BOXES.length + 1;
}

export interface StatusGroup {
  /** Lower-cased status, the group's key. */
  key: string;
  /** The spelling most of its rows use. */
  label: string;
  items: DatabaseRowType[];
}

/** One group per status (spelling variants merged), in box order. */
export function groupByStatus(rows: DatabaseRowType[]): StatusGroup[] {
  const m = new Map<string, { items: DatabaseRowType[]; spellings: Map<string, number> }>();
  for (const r of rows) {
    const s = statusOf(r);
    const k = s.toLowerCase();
    let g = m.get(k);
    if (!g) { g = { items: [], spellings: new Map() }; m.set(k, g); }
    g.items.push(r);
    g.spellings.set(s, (g.spellings.get(s) ?? 0) + 1);
  }
  return Array.from(m, ([key, g]) => ({
    key,
    label: Array.from(g.spellings).sort((a, b) => b[1] - a[1])[0][0],
    items: g.items,
  })).sort((a, b) => rankStatus(a.label) - rankStatus(b.label) || a.label.localeCompare(b.label));
}

/** Newest order first; rows with no readable date last. */
export function newestFirst(rows: DatabaseRowType[]): DatabaseRowType[] {
  return [...rows].sort((a, b) => {
    const da = dayKey(a.dateOfLive), db = dayKey(b.dateOfLive);
    if (da !== db) return !da ? 1 : !db ? -1 : db.localeCompare(da);
    return String(a.rowKey ?? a.id).localeCompare(String(b.rowKey ?? b.id));
  });
}

// ─── Per day ─────────────────────────────────────────────────────────────────

/** Rows by a normalised day (yyyy-mm-dd), newest first, 'Unknown' last. */
export function groupByDay(rows: DatabaseRowType[], dayOf: (r: DatabaseRowType) => string): [string, DatabaseRowType[]][] {
  const m = new Map<string, DatabaseRowType[]>();
  for (const r of rows) {
    const k = dayOf(r) || 'Unknown';
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  return Array.from(m).sort((a, b) => (a[0] === 'Unknown' ? 1 : b[0] === 'Unknown' ? -1 : b[0].localeCompare(a[0])));
}

export interface LiveSummary {
  day: string;
  page: string;
  customers: number;
  items: number;
  grams: number;
  soldItems: number;
  soldGrams: number;
  waiting: number;
  cancelled: number;
}

/** One row per live (day + page): customers, items, grams, sold, waiting, cancelled. */
export function summariseLives(rows: DatabaseRowType[]): LiveSummary[] {
  const m = new Map<string, DatabaseRowType[]>();
  for (const r of rows) {
    const k = `${dayKey(r.dateOfLive) || 'Unknown'}|${String(r.page ?? '').trim()}`;
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  return Array.from(m, ([k, items]) => {
    const [day, page] = k.split('|');
    const live = items.filter(r => fulfilmentStage(r.status) !== 'excluded');
    const sold = live.filter(isSold);
    return {
      day,
      page,
      customers: new Set(live.map(customerKey)).size,
      items: live.length,
      grams: sumGrams(live),
      soldItems: sold.length,
      soldGrams: sumGrams(sold),
      waiting: live.length - sold.length,
      cancelled: items.length - live.length,
    };
  }).sort((a, b) => (a.day === 'Unknown' ? 1 : b.day === 'Unknown' ? -1 : b.day.localeCompare(a.day) || a.page.localeCompare(b.page)));
}
