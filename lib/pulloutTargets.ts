/**
 * Where "Liver came" sends each item of a pullout request (owner decision):
 * international and reseller items go to their own box; the request's
 * COD / Pick Up applies only to local items. Pure — used by Dispatch's
 * confirm, the liver's form and the server action alike.
 */

import type { DatabaseRowType } from '@/types';
import { boxFromDelivery } from '@/lib/fulfilment';
import { methodStatus, type PulloutMethod } from '@/lib/pulloutRequests';

/** Status names for the boxes that don't follow COD / Pick Up. */
export const LIVER_CAME_BOX_STATUS = {
  intl: 'For International Shipment',
  reseller: 'Reseller',
} as const;
type OwnBox = keyof typeof LIVER_CAME_BOX_STATUS;

const BOX_PATTERN: Record<OwnBox, RegExp> = {
  intl: /\binternational\b/,
  reseller: /\bresell/,
};
// Statuses that already mean shipped / done, never a box to wait in.
const NOT_A_BOX = /cancel|return|deliver|dispatched|shipped|given to|picked up|in transit/;

/**
 * The status this customer's sheet already uses for a box: the default name in
 * its own spelling, else its most-used status of that kind, else the default.
 */
export function boxStatusName(box: OwnBox, statusesInUse: string[]): string {
  const def = LIVER_CAME_BOX_STATUS[box];
  const counts = new Map<string, { name: string; n: number }>();
  for (const raw of statusesInUse) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const c = counts.get(k);
    if (c) c.n++; else counts.set(k, { name, n: 1 });
  }
  const exact = counts.get(def.toLowerCase());
  if (exact) return exact.name;
  let best: { name: string; n: number } | null = null;
  for (const [k, c] of counts) {
    if (!BOX_PATTERN[box].test(k) || NOT_A_BOX.test(k)) continue;
    if (!best || c.n > best.n) best = c;
  }
  return best?.name ?? def;
}

/** The box an item goes to on "Liver came": its own box, or null for a local item. */
export function ownBox(r: DatabaseRowType): OwnBox | null {
  const box = boxFromDelivery(r);
  return box === 'intl' || box === 'reseller' ? box : null;
}

/** The status "Liver came" sets on one item. */
export function liverCameStatus(r: DatabaseRowType, method: PulloutMethod, statusesInUse: string[]): string {
  const box = ownBox(r);
  return box ? boxStatusName(box, statusesInUse) : methodStatus(method);
}
