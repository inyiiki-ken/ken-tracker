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
  // "For International Shipment" / "Shipment International" is still waiting to go out.
  if (/\b(shipment|shipping|international)\b/.test(s)) return 'pullout';
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
function boxFromDelivery(r: DatabaseRowType): OrderBox {
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
 * Outsource supplier of an item, shown before the date on the Outsource queue:
 * its Source, else whoever uploaded it (the outsource's own masterlist, e.g. BELLA).
 */
export function outsourceName(r: DatabaseRowType): string {
  return String(r.source ?? '').trim() || String(r.liverName ?? '').trim() || 'No outsource name';
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
