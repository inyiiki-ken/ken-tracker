/**
 * Money a liver may see on My Sales (owner decision): per customer "Paid" /
 * "Balance due AED X", and "Collect AED X" on COD items. Worked out with the
 * same helpers Dispatch uses (price + card fee − paid), plus the customer's
 * shipping fee (once) and extra charges / discounts, so the balance matches
 * the invoice and Accounts (calcGroupBalance) and the COD cash isn't short.
 * Never cost, supplier rate, gold rate or profit. Change what she sees here.
 */

import type { DatabaseRowType } from '@/types';
import { calcCCFee, calcGroupBalance, calcItemPriceAED, calcTotalPaid, customerKey, groupShippingFee, netChargeAED, roundPrice } from '@/lib/calculations';
import { boxFromStatus, fulfilmentStage, isCancelledOrReturned } from '@/lib/fulfilment';
import { itemKey, liverKey } from '@/lib/pulloutRequests';
import type { DeliveryReport } from '@/lib/deliveryReports';

/** What the customer owes for one item (price + card fee), AED. */
export function itemDueAED(r: DatabaseRowType): number {
  return calcItemPriceAED(r) + calcCCFee(r);
}

/** Items that count towards a customer's balance: every one that isn't cancelled / returned. */
export function moneyRows(rows: DatabaseRowType[]): DatabaseRowType[] {
  return rows.filter(r => fulfilmentStage(r.status) !== 'excluded');
}

/**
 * One customer's items: paid so far, total due and what is left (never below 0),
 * AED. The balance is the invoice's (shipping once, charges and discounts in).
 */
export function customerMoney(rows: DatabaseRowType[]): { paid: number; due: number; balance: number } {
  const counted = moneyRows(rows);
  const paid = roundPrice(counted.reduce((s, r) => s + calcTotalPaid(r), 0));
  const owed = calcGroupBalance(counted);
  return { paid, due: roundPrice(owed + paid), balance: Math.max(0, owed) };
}

/**
 * The customer also bought from another liver (the server marks a liver's rows,
 * customerHasOtherLivers). Her rows alone can't give the whole balance, a group
 * downpayment saved on another liver's item, or the shipping fee, so she sees
 * item-level figures only and Accounts / Dispatch have the rest.
 */
export function sharedCustomer(customerRows: DatabaseRowType[]): boolean {
  return customerRows.some(r => r.customerHasOtherLivers);
}

/**
 * Customers (customerKey) who have an item still open (not delivered, not
 * cancelled / returned) from a liver other than this one: the rule behind
 * customerHasOtherLivers. An old, delivered purchase from someone else doesn't
 * count, so it never switches her money figures off for good. The server
 * stamps it on a liver's own rows; staff screens (the admin preview of My
 * Sales, Dispatch's delivery reports) work it out here from every row, so the
 * liver, the preview and Dispatch show the same figures.
 */
export function customersWithOtherLivers(all: DatabaseRowType[], liver: string): Set<string> {
  const me = liverKey(liver);
  return new Set(all.filter(r => {
    if (liverKey(r.liverName) === me) return false;
    const stage = fulfilmentStage(r.status);
    return stage !== 'delivered' && stage !== 'excluded';
  }).map(customerKey));
}

/**
 * Customers who ever bought (not cancelled / returned) from another liver: her
 * rows alone can't give their loyalty count (customerBoughtFromOtherLivers).
 */
export function customersEverWithOtherLivers(all: DatabaseRowType[], liver: string): Set<string> {
  const me = liverKey(liver);
  return new Set(all.filter(r => liverKey(r.liverName) !== me && !isCancelledOrReturned(r)).map(customerKey));
}

/** These rows with customerHasOtherLivers set for the customers in `shared`. */
export function withOtherLivers(rows: DatabaseRowType[], shared: Set<string>): DatabaseRowType[] {
  if (shared.size === 0) return rows;
  return rows.map(r => (!r.customerHasOtherLivers && shared.has(customerKey(r)) ? { ...r, customerHasOtherLivers: true } : r));
}

/** A COD item (paid in cash on delivery). */
export function isCodItem(r: DatabaseRowType): boolean {
  return /\bcod\b/i.test(String(r.modeOfPayment ?? '')) || boxFromStatus(r.status) === 'cod';
}

/** A COD item still to be delivered (cash still to collect on it). */
function isOpenCod(r: DatabaseRowType): boolean {
  if (!isCodItem(r)) return false;
  const stage = fulfilmentStage(r.status);
  return stage !== 'excluded' && stage !== 'delivered';
}

/** Cash to collect for one COD item not yet delivered (with its own charges), on its own; 0 otherwise. */
export function collectAED(r: DatabaseRowType): number {
  if (!isOpenCod(r)) return 0;
  return Math.max(0, roundPrice(itemDueAED(r) + netChargeAED(r) - calcTotalPaid(r)));
}

/**
 * The customer's shipping fee, collected with her first COD delivery only (a
 * delivered COD item means it was already collected; cash isn't written to
 * the payment columns, so the balance alone can't tell).
 */
function codShippingAED(customerRows: DatabaseRowType[]): number {
  if (customerRows.some(r => isCodItem(r) && fulfilmentStage(r.status) === 'delivered')) return 0;
  return groupShippingFee(moneyRows(customerRows));
}

/**
 * The open COD item the shipping fee is collected with: the lowest row id, so
 * the row, card and report figures all add up the same way.
 */
function shippingCarrier(customerRows: DatabaseRowType[]): DatabaseRowType | undefined {
  return customerRows.filter(isOpenCod).reduce<DatabaseRowType | undefined>((a, r) => (!a || r.id < a.id ? r : a), undefined);
}

/**
 * Cash to collect from one customer (pass ALL the items for that customer): the
 * COD items not yet delivered, netted together, so a group downpayment saved on
 * one item counts for all, plus the shipping fee (codShippingAED); never more
 * than her whole balance.
 */
export function customerCollectAED(rows: DatabaseRowType[]): number {
  const cod = rows.filter(isOpenCod);
  if (cod.length === 0) return 0;
  const net = roundPrice(cod.reduce((s, r) => s + itemDueAED(r) + netChargeAED(r) - calcTotalPaid(r), 0) + codShippingAED(rows));
  return Math.max(0, Math.min(net, customerMoney(rows).balance));
}

/**
 * Collect for some of one customer's items (a row, a delivery, a report): their
 * own figures (the shipping fee goes with one item, see shippingCarrier),
 * capped at what the customer still owes on COD (customerRows = all the items
 * for that customer).
 */
export function collectForAED(items: DatabaseRowType[], customerRows: DatabaseRowType[]): number {
  // Shared customer: each item's own figure, no shipping fee or group cap (see sharedCustomer).
  if (sharedCustomer(customerRows)) return roundPrice(items.reduce((s, r) => s + collectAED(r), 0));
  const carrier = shippingCarrier(customerRows);
  const sf = carrier && items.some(r => r.id === carrier.id) ? codShippingAED(customerRows) : 0;
  const own = items.reduce((s, r) => s + collectAED(r), 0) + sf;
  return own > 0 ? Math.min(roundPrice(own), customerCollectAED(customerRows)) : 0;
}

/**
 * Cash she reported collecting from this customer (her Delivered reports on any
 * of the customer's items), AED. The cash isn't in the payment columns until
 * Accounts enters it, so the balance can still show it as due; this lets the
 * screen say so instead of a bare "Balance due". An open report counts in full;
 * a confirmed one only while its items still show money due (once Accounts
 * enters the payment it drops out, so the note clears).
 */
export function reportedCashAED(reports: DeliveryReport[], customerRows: DatabaseRowType[]): number {
  const byKey = new Map(customerRows.map(r => [itemKey(r), r] as const));
  const stillDue = (q: DeliveryReport) => {
    const items = q.itemKeys.map(k => byKey.get(k)).filter((r): r is DatabaseRowType => !!r);
    return roundPrice(items.reduce((s, r) => s + itemDueAED(r) + netChargeAED(r) - calcTotalPaid(r), 0)) > 0;
  };
  return roundPrice(reports
    .filter(q => q.kind === 'Delivered' && (q.cash ?? 0) > 0)
    .filter(q => q.itemKeys.some(k => byKey.has(k)))
    .filter(q => q.status === 'Reported' || (q.status === 'Confirmed' && stillDue(q)))
    .reduce((s, q) => s + (q.cash ?? 0), 0));
}

/** "AED 1,250". */
export function aedLabel(v: number): string {
  return `AED ${roundPrice(v).toLocaleString('en-US')}`;
}
