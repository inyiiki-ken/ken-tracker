/**
 * Which Admin pipeline section an item sits in. Shared by the Admin tab and
 * its customer cards so both group items the same way.
 */

import type { DatabaseRowType } from '@/types';

// Statuses that all belong to the "waiting for the payment to be secured" phase,
// grouped under one section so the admin sees them together.
export const WFDP_GROUP = ['Waiting for Downpayment', 'Pending for Tamara', 'Pending for Tabby'];
const WFDP_LOWER = WFDP_GROUP.map(s => s.toLowerCase());

export type AdminBucket = 'mined' | 'wfdp' | 'verif' | 'review' | 'hold';

/**
 * Which Admin section an item belongs in, or null when it isn't Admin's any
 * more. Statuses are compared without case or extra spaces, because they are
 * often typed straight into the sheet; a blank status is Waiting for Details.
 */
export function adminBucket(r: DatabaseRowType, reviewHidden: boolean): AdminBucket | null {
  const s = String(r.status || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!s || s === 'pending' || s === 'waiting for details') return 'mined';
  if (WFDP_LOWER.includes(s)) return 'wfdp';
  if (s === 'payment for verification') return 'verif';
  if (s === 'paid/dp but item hold') return 'hold';
  if (s === 'delivered') {
    if (reviewHidden) return null;
    return r.reviewChasing === 'Skipped' || r.reviewChasing === 'Completed' ? null : 'review';
  }
  return null;
}

/** The page an item is listed under ("Page A" and "page a " are one page). */
export function adminPageName(r: DatabaseRowType): string {
  return String(r.page || '').trim().replace(/\s+/g, ' ') || 'Other';
}
