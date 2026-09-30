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
import { isPulloutStatus } from '@/lib/appConfig';
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
  // Shipments abroad count as dispatched as soon as they're marked, including
  // "For Shipment International", even if Settings lists them as a pullout status.
  if (/\b(shipment|shipping|international)\b/.test(s)) return 'dispatched';
  if (/\bpull ?out\b/.test(s) || isPulloutStatus(s) || /^for (cod|pick ?up|dispatch|delivery)\b/.test(s)) return 'pullout';
  // Anything about couriers that isn't "for …" (still waiting) is on the way.
  if (/\b(shipped|courier|in transit|out for delivery|dispatched)\b/.test(s)) return 'dispatched';
  return 'active';
}

/** yyyy-mm-dd, or '' when the value isn't a date. */
function dayKey(v?: string): string {
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
