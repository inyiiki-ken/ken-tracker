/**
 * Money a liver may see on My Sales (owner decision): per customer "Paid" /
 * "Balance due AED X", and "Collect AED X" on COD items. Worked out with the
 * same helpers Dispatch uses for "Paid: AED X / Y" (price + card fee − paid).
 * Never cost, supplier rate, gold rate or profit. Change what she sees here.
 */

import type { DatabaseRowType } from '@/types';
import { calcCCFee, calcItemPriceAED, calcTotalPaid, roundPrice } from '@/lib/calculations';
import { boxFromStatus, fulfilmentStage } from '@/lib/fulfilment';

/** What the customer owes for one item (price + card fee), AED. */
export function itemDueAED(r: DatabaseRowType): number {
  return calcItemPriceAED(r) + calcCCFee(r);
}

/** Items that count towards a customer's balance: every one that isn't cancelled / returned. */
export function moneyRows(rows: DatabaseRowType[]): DatabaseRowType[] {
  return rows.filter(r => fulfilmentStage(r.status) !== 'excluded');
}

/** One customer's items: paid so far, total due and what is left (never below 0), AED. */
export function customerMoney(rows: DatabaseRowType[]): { paid: number; due: number; balance: number } {
  const counted = moneyRows(rows);
  const due = roundPrice(counted.reduce((s, r) => s + itemDueAED(r), 0));
  const paid = roundPrice(counted.reduce((s, r) => s + calcTotalPaid(r), 0));
  return { paid, due, balance: Math.max(0, roundPrice(due - paid)) };
}

/** A COD item (paid in cash on delivery). */
export function isCodItem(r: DatabaseRowType): boolean {
  return /\bcod\b/i.test(String(r.modeOfPayment ?? '')) || boxFromStatus(r.status) === 'cod';
}

/** Cash to collect for a COD item not yet delivered; 0 otherwise. */
export function collectAED(r: DatabaseRowType): number {
  if (!isCodItem(r)) return 0;
  const stage = fulfilmentStage(r.status);
  if (stage === 'excluded' || stage === 'delivered') return 0;
  return Math.max(0, roundPrice(itemDueAED(r) - calcTotalPaid(r)));
}

/** "AED 1,250". */
export function aedLabel(v: number): string {
  return `AED ${roundPrice(v).toLocaleString('en-US')}`;
}
