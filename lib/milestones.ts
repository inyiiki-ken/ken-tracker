/**
 * Invoice-Level Qualifying Orders & Milestone Counter
 *
 * Grouping: records by shared customerId + Invoice # (pureWeight)
 * Status gate: all items in the group must be Dispatched or Delivered
 * Thresholds: Silver items ≥ AED 150 OR Gold items ≥ AED 500
 * Milestones: 3, 5, 10, 15, 20 qualifying orders per client
 * Date filter: Only invoices from June 1 2026 onwards are counted
 */

import { DatabaseRowType } from '@/types';
import { calcItemPriceAED, parseDateRobust } from './calculations';

const DISPATCHED_STATUSES = new Set(['Dispatched', 'Delivered']);
export const MILESTONE_LEVELS = [3, 5, 10, 15, 20] as const;
export type MilestoneLevel = (typeof MILESTONE_LEVELS)[number];

/** Milestone labels for display */
export const MILESTONE_LABELS: Record<string, string> = {
  '3rd_order': '3rd Order',
  '5th_order': '5th Order',
  '10th_order': '10th Order',
  '15th_order': '15th Order',
  '20th_order': '20th Order',
  'unassigned': 'Unassigned',
};

export const MILESTONE_OPTIONS = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: '3rd_order', label: '3rd Order' },
  { value: '5th_order', label: '5th Order' },
  { value: '10th_order', label: '10th Order' },
  { value: '15th_order', label: '15th Order' },
  { value: '20th_order', label: '20th Order' },
] as const;

/** Map milestone value to the numeric order count */
export function milestoneToCount(milestone: string): number | null {
  const map: Record<string, number> = {
    '3rd_order': 3,
    '5th_order': 5,
    '10th_order': 10,
    '15th_order': 15,
    '20th_order': 20,
  };
  return map[milestone] ?? null;
}

/** Map numeric order count to milestone value */
export function countToMilestone(count: number): string | null {
  const map: Record<number, string> = {
    3: '3rd_order',
    5: '5th_order',
    10: '10th_order',
    15: '15th_order',
    20: '20th_order',
  };
  return map[count] ?? null;
}

// ---- Date cutoff: only count invoices from June 1, 2026 onwards ----
const CUTOFF_DATE = new Date('2026-06-01T00:00:00+04:00');

function isAfterCutoff(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = parseDateRobust(dateStr);
  if (!d) return false;
  return d >= CUTOFF_DATE;
}

export interface QualifyingInvoice {
  invoiceId: string;
  customerId: string;
  totalSilverAED: number;
  totalGoldAED: number;
  isQualifying: boolean;
  itemCount: number;
}

export interface ClientMilestone {
  customerId: string;
  minerName: string;
  qualifyingCount: number;
  nextMilestone: number | null;
  currentMilestoneReached: number | null;
  /** Milestones that have been exactly hit (e.g. count === 3) */
  exactMilestonesHit: number[];
}

function isGoldCategory(cat: string): boolean {
  const c = cat.toLowerCase();
  return c.includes('gold') || c.includes('18k') || c.includes('21k') || c.includes('24k')
    || c.includes('special price') || c.includes('vca') || c.includes('diamond');
}

function isSilverCategory(cat: string): boolean {
  return cat.toLowerCase().includes('silver');
}

export function computeQualifyingInvoices(records: DatabaseRowType[]): QualifyingInvoice[] {
  const groups = new Map<string, DatabaseRowType[]>();

  for (const r of records) {
    const invoiceId = String(r.pureWeight || '').trim();
    const customerId = (r.customerId || '').trim();
    if (!invoiceId || !customerId) continue;

    // Date filter: only count records from June 2026 onwards
    if (!isAfterCutoff(r.dateOfLive)) continue;

    const key = `${customerId}__${invoiceId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const results: QualifyingInvoice[] = [];

  for (const [key, items] of groups) {
    const parts = key.split('__');
    const customerId = parts[0];
    const invoiceId = parts.slice(1).join('__');

    // ALL items must be Dispatched or Delivered
    const allDispatched = items.every(r => DISPATCHED_STATUSES.has(r.status || ''));
    if (!allDispatched) continue;

    let totalSilverAED = 0;
    let totalGoldAED = 0;

    for (const r of items) {
      const cat = r.category || '';
      const priceAED = calcItemPriceAED(r);
      if (isSilverCategory(cat)) totalSilverAED += priceAED;
      else if (isGoldCategory(cat)) totalGoldAED += priceAED;
    }

    results.push({
      invoiceId,
      customerId,
      totalSilverAED: Math.round(totalSilverAED),
      totalGoldAED: Math.round(totalGoldAED),
      isQualifying: totalSilverAED >= 150 || totalGoldAED >= 500,
      itemCount: items.length,
    });
  }

  return results;
}

export function computeClientMilestones(records: DatabaseRowType[]): Map<string, ClientMilestone> {
  const qualifying = computeQualifyingInvoices(records);
  const byClient = new Map<string, Set<string>>();
  const nameMap = new Map<string, string>();

  for (const q of qualifying) {
    if (!q.isQualifying) continue;
    if (!byClient.has(q.customerId)) byClient.set(q.customerId, new Set());
    byClient.get(q.customerId)!.add(q.invoiceId);
  }

  // Resolve miner names
  for (const r of records) {
    const cid = (r.customerId || '').trim();
    if (cid && r.minerName && !nameMap.has(cid)) {
      nameMap.set(cid, r.minerName);
    }
  }

  const milestones = new Map<string, ClientMilestone>();

  for (const [customerId, invoiceIds] of byClient) {
    const count = invoiceIds.size;
    const nextMilestone = MILESTONE_LEVELS.find(t => t > count) ?? null;
    const exactMilestonesHit = MILESTONE_LEVELS.filter(t => count >= t);

    milestones.set(customerId, {
      customerId,
      minerName: nameMap.get(customerId) || 'Unknown',
      qualifyingCount: count,
      nextMilestone,
      currentMilestoneReached: exactMilestonesHit.length > 0 ? exactMilestonesHit[exactMilestonesHit.length - 1] : null,
      exactMilestonesHit,
    });
  }

  return milestones;
}

export function getMilestoneAlert(count: number): string | null {
  if (count >= 20) return 'MILESTONE REACHED: 20th Order — ADD ULTIMATE REWARD 🏅';
  if (count >= 15) return 'MILESTONE REACHED: 15th Order — ADD VIP GIFT 🎁';
  if (count >= 10) return 'MILESTONE REACHED: 10th Order — ADD PREMIUM GIFT 🎁';
  if (count >= 5) return 'MILESTONE REACHED: 5th Order — ADD SPECIAL GIFT 🎁';
  if (count >= 3) return 'MILESTONE REACHED: 3rd Order — ADD LUCKY CHARM 🍀';
  return null;
}

export function getMilestoneBadge(count: number): string | null {
  if (count < 3) return null;
  if (count >= 20) return '🏅 Ultimate (20+)';
  if (count >= 15) return '🏆 VIP (15+)';
  if (count >= 10) return '💎 Premium (10+)';
  if (count >= 5) return '⭐ Loyal (5+)';
  return '🍀 Regular (3+)';
}
