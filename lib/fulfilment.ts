/**
 * Where an order sits in its life, worked out from its status.
 *
 * Customers name their own statuses ("Other Reseller", "Shipment International",
 * "Given to Courier Aramex"…), so exact matches alone leave most of them in no
 * bucket. Known names match first; anything else is placed by keywords, and a
 * status that says nothing about shipping stays an active order.
 *
 *   excluded   → Cancelled, Returned Item (never invoiced)
 *   delivered  → Delivered, Given to Shop, Picked Up…
 *   dispatched → Dispatched, Shipment International, Given to Courier…, In Transit…
 *   pullout    → For Pullout, For COD, For Pick Up, For Dispatch…
 *   active     → everything else (Pending, Reseller, Other Reseller, payment holds…)
 */

import type { DatabaseRowType } from '@/types';
import { isPulloutStatus, isSaleStatus } from '@/lib/appConfig';
import { parseDateRobust } from '@/lib/calculations';

export type FulfilmentStage = 'excluded' | 'active' | 'pullout' | 'dispatched' | 'delivered';

const EXCLUDED = new Set(['cancelled', 'canceled', 'returned item', 'returned']);
const DELIVERED = new Set(['delivered', 'given to shop', 'picked up', 'completed', 'received']);
const DISPATCHED = new Set(['dispatched', 'shipped', 'in transit', 'out for delivery']);

export function fulfilmentStage(status?: string): FulfilmentStage {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return 'active';
  if (EXCLUDED.has(s) || s.startsWith('cancel') || s.startsWith('returned')) return 'excluded';
  if (DELIVERED.has(s) || /\bdelivered\b/.test(s) || /\bpicked up\b/.test(s)) return 'delivered';
  if (DISPATCHED.has(s)) return 'dispatched';
  // "For International Shipment" / "Shipment International" is still waiting to go out.
  if (/\b(shipment|shipping|international)\b/.test(s)) return 'pullout';
  if (/\bpull ?out\b/.test(s) || isPulloutStatus(s) || /^for (cod|pick ?up|dispatch|delivery)\b/.test(s)) return 'pullout';
  // Anything about couriers that isn't "for …" (still waiting) is on the way.
  if (/\b(shipped|courier|in transit|out for delivery|dispatched)\b/.test(s)) return 'dispatched';
  return 'active';
}

/** yyyy-mm-dd, or '' when the value isn't a date. */
export function dayKey(v?: string): string {
  if (!v) return '';
  const d = parseDateRobust(v);
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The day an item shipped: Dispatch Date, else Delivered Date, else the live date. */
export function shipmentDay(r: DatabaseRowType): string {
  return dayKey(r.dispatchDate) || dayKey(r.deliveredDate) || dayKey(r.dateOfLive) || 'Unknown Date';
}

// ─── Sold ─────────────────────────────────────────────────────────────────────
// What counts as SOLD for a liver (My Sales) and for Bossing. Kept in one place
// so both tabs agree; change it here only.

/** Sold = shipped or delivered, or a status in Settings → App Settings → sale statuses. Never a cancelled/returned item. */
export function isSoldStatus(status?: string): boolean {
  const stage = fulfilmentStage(status);
  if (stage === 'excluded') return false;
  return stage === 'dispatched' || stage === 'delivered' || isSaleStatus(status);
}

export function isSold(r: Pick<DatabaseRowType, 'status'>): boolean {
  return isSoldStatus(r.status);
}

/** The day a sale counts on: the day it shipped (see shipmentDay); '' when no date at all. */
export function soldDay(r: DatabaseRowType): string {
  const d = shipmentDay(r);
  return d === 'Unknown Date' ? '' : d;
}

// ─── Cancelled / returned ─────────────────────────────────────────────────────

const ISO_AT_START = /^(\d{4}-\d{2}-\d{2}T[^ |]+)\s*\|/;

/**
 * When the item got its current status: the latest change-history line that
 * touched "status" (source 'history'), else the live date (source 'order'),
 * e.g. an item cancelled straight in the sheet.
 */
export function statusChangedInfo(r: DatabaseRowType): { date: Date; source: 'history' | 'order' } | null {
  const lines = String(r.auditTrail ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/\bstatus\b/i.test(lines[i])) continue;
    const m = lines[i].match(ISO_AT_START);
    if (m) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) return { date: d, source: 'history' };
    }
  }
  const d = parseDateRobust(r.dateOfLive);
  return d ? { date: d, source: 'order' } : null;
}

export function statusChangedAt(r: DatabaseRowType): Date | null {
  return statusChangedInfo(r)?.date ?? null;
}

/** The day an item was cancelled / returned: when its status last changed, else the live date. */
export function cancelDay(r: DatabaseRowType): string {
  const d = statusChangedAt(r);
  return d ? dayKey(d.toISOString()) || 'Unknown Date' : 'Unknown Date';
}

/** Cancelled or returned (Dispatch's "Cancelled / Returned" box). */
export function isCancelledOrReturned(r: Pick<DatabaseRowType, 'status'>): boolean {
  return fulfilmentStage(String(r.status ?? '')) === 'excluded';
}

/**
 * Dates to fill in automatically when a status changes, so nobody has to type
 * the Dispatch / Delivered date by hand. Existing dates are never overwritten.
 */
export function autoStageDates(
  before: Pick<DatabaseRowType, 'dispatchDate' | 'deliveredDate'> | undefined,
  newStatus: string,
  now: string = new Date().toISOString(),
): Partial<DatabaseRowType> {
  const stage = fulfilmentStage(newStatus);
  const out: Partial<DatabaseRowType> = {};
  if (stage === 'dispatched' && !String(before?.dispatchDate ?? '').trim()) {
    out.dispatchDate = now;
  }
  if (stage === 'delivered' && !String(before?.deliveredDate ?? '').trim()) {
    out.deliveredDate = now;
  }
  return out;
}

// ─── Boxes ───────────────────────────────────────────────────────────────────
// Crown sorts orders into physical boxes / containers. The Dispatch work queue,
// the Statement of Account tabs and the Pullout Report all use these.

export type OrderBox = 'outsource' | 'intl' | 'cod' | 'pickup' | 'reseller' | 'dispatched' | 'delivered' | 'cancelled';

export const ORDER_BOXES: { key: OrderBox; label: string }[] = [
  { key: 'outsource', label: 'Outsource' },
  { key: 'intl', label: 'For International Shipment' },
  { key: 'cod', label: 'For COD' },
  { key: 'pickup', label: 'For Pick Up' },
  { key: 'reseller', label: 'Reseller' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled / Returned' },
];

export function boxLabel(box: OrderBox): string {
  return ORDER_BOXES.find(b => b.key === box)?.label ?? box;
}

/** The box a status names outright, or null when it doesn't name one (Pending, For Pullout…). */
export function boxFromStatus(status?: string): OrderBox | null {
  const s = String(status ?? '').trim().toLowerCase();
  if (!s) return null;
  const stage = fulfilmentStage(s);
  if (stage === 'excluded') return 'cancelled';
  if (stage === 'delivered') return 'delivered';
  if (stage === 'dispatched') return 'dispatched';
  if (/outsourc/.test(s)) return 'outsource';
  if (/\b(international|shipment|shipping)\b/.test(s)) return 'intl';
  if (/\bcod\b/.test(s)) return 'cod';
  if (/\bpick ?up\b/.test(s)) return 'pickup';
  if (/resell/.test(s)) return 'reseller';
  return null;
}

/** The box that matches how the order is paid for / delivered. */
export function boxFromDelivery(r: DatabaseRowType): OrderBox {
  const where = `${r.locationOfMiner ?? ''} ${r.regions ?? ''} ${r.modeOfPayment ?? ''}`.toLowerCase();
  if (/international|pinas/.test(where)) return 'intl';
  const mop = String(r.modeOfPayment ?? '').toLowerCase();
  if (/pick ?up|meet ?up/.test(mop)) return 'pickup';
  if (/resell/i.test(`${r.modeOfSale ?? ''}`)) return 'reseller';
  return 'cod';
}

/**
 * Which box an item belongs in. The status decides when it names a box;
 * otherwise (For Pullout, Pending, Waiting for…, Paid/DP but Item Hold,
 * Payment for Verification…) the delivery details decide.
 */
/**
 * Outsource an item came from, shown first on the Outsource queue: its Source,
 * else the page it was sold on (the outsource's page, e.g. JOLAI, whose livers
 * sell for it), else whoever uploaded it (the outsource's own masterlist, e.g. BELLA).
 */
export function outsourceName(r: DatabaseRowType): string {
  return String(r.source ?? '').trim() || String(r.page ?? '').trim() || String(r.liverName ?? '').trim() || 'No outsource name';
}

/**
 * Which outsource each liver sells for (e.g. JAY -> JOLAI), keyed by
 * `keyOf(liverName)`. A liver with items in the Outsource box belongs to the
 * outsource those items name most. A liver whose items are all on one page
 * that an outsource sells on belongs to it too, so she stays under it after her
 * items ship. Livers with neither are the shop's own. (A Source alone doesn't
 * count: shop stock has one too, e.g. "Shop Stock".)
 */
export function outsourceOfLivers(records: DatabaseRowType[], keyOf: (v: unknown) => string): Map<string, string> {
  const signal = (r: DatabaseRowType) => orderBox(r) === 'outsource';
  const counts = new Map<string, Map<string, number>>();
  const known = new Set<string>();
  // Page an outsource's items were sold on -> that outsource (e.g. JOLAI page -> JOLAI SUPPLY).
  const pageOut = new Map<string, string>();
  for (const r of records) {
    const liver = keyOf(r.liverName);
    if (!liver || !signal(r)) continue;
    const out = outsourceName(r);
    known.add(out);
    const page = String(r.page ?? '').trim();
    if (page && !pageOut.has(page)) pageOut.set(page, out);
    if (!counts.has(liver)) counts.set(liver, new Map());
    const c = counts.get(liver)!;
    c.set(out, (c.get(out) ?? 0) + 1);
  }
  const result = new Map<string, string>();
  for (const [liver, c] of counts) {
    result.set(liver, [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  // No outsource items (any more): all on one page named after an outsource, or
  // on a page an outsource's items were sold on. That second case is skipped for
  // a page with open non-outsource items (the shop's own page, most likely).
  const pages = new Map<string, Set<string>>();
  const shopPages = new Set<string>();
  for (const r of records) {
    const liver = keyOf(r.liverName);
    if (!liver || result.has(liver)) continue;
    const page = String(r.page ?? '').trim();
    if (!pages.has(liver)) pages.set(liver, new Set());
    pages.get(liver)!.add(page);
    if (!['dispatched', 'delivered', 'cancelled'].includes(orderBox(r))) shopPages.add(page);
  }
  for (const [liver, set] of pages) {
    const [only] = [...set];
    if (set.size !== 1 || !only) continue;
    const out = known.has(only) ? only : shopPages.has(only) ? undefined : pageOut.get(only);
    if (out) result.set(liver, out);
  }
  return result;
}

export function orderBox(r: DatabaseRowType): OrderBox {
  return boxFromStatus(r.status) ?? boxFromDelivery(r);
}

/**
 * Still being sorted out by Admin / Accounts (unpaid, on hold, being verified):
 * not ready for a box on the Dispatch work queue or the Pullout Report yet.
 */
export function isStillWithAdmin(status?: string): boolean {
  if (boxFromStatus(status)) return false;
  return fulfilmentStage(status) !== 'pullout';
}
