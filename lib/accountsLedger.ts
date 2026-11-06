import type { DatabaseRowType } from '@/types';
import { getAppConfig, isSaleStatus } from '@/lib/appConfig';
import { businessDay, calcGroupBalance, calcShippingFee, calcTotalPaid, customerKey, parseDateRobust, shippingFeeRow } from '@/lib/calculations';
import { fulfilmentStage } from '@/lib/fulfilment';

const normalize = (s?: string) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function isAccountsRelevant(r: DatabaseRowType): boolean {
  const stage = fulfilmentStage(r.status);
  if (stage === 'excluded') return false;
  return stage !== 'active' || isSaleStatus(r.status || '') || calcTotalPaid(r) !== 0
    || /reseller|layaway|payment|item hold/i.test(r.status || '')
    || getAppConfig().statusDeadlines.some(d => normalize(d.status) === normalize(r.status));
}

/** Reseller imports can retain the end buyer's ID. Only an explicitly billed
 * reseller name bridges those IDs; ordinary namesakes remain separate. */
export function groupAccounts(records: DatabaseRowType[]): Map<string, DatabaseRowType[]> {
  const resellerNames = new Set(records.filter(r => /reseller/i.test(r.status || '')
    || /Reseller invoice \| Billed to /i.test(r.auditTrail || '')).map(r => normalize(r.minerName)).filter(Boolean));
  const groups = new Map<string, DatabaseRowType[]>();
  for (const r of records) {
    const name = normalize(r.minerName);
    const key = resellerNames.has(name) ? `reseller:${name}` : `customer:${customerKey(r)}`;
    const group = groups.get(key) || [];
    group.push(r);
    groups.set(key, group);
  }
  return groups;
}

export interface AccountBatch {
  key: string;
  date?: string;
  pending: boolean;
  uncertain: boolean;
  records: DatabaseRowType[];
  charges: number;
  shipping: number;
  paid: number;
  creditUsed: number;
  creditAdded: number;
  due: number;
}

export interface CustomerAccount {
  key: string;
  name: string;
  records: DatabaseRowType[];
  excludedPayments: DatabaseRowType[];
  batches: AccountBatch[];
  paid: number;
  charges: number;
  due: number;
  credit: number;
  verification: boolean;
}

export function accountBatchIdentity(r: DatabaseRowType): { key: string; date?: string; pending: boolean; uncertain: boolean } {
  const stage = fulfilmentStage(r.status);
  const shipped = stage === 'dispatched' || stage === 'delivered';
  if (!shipped) return { key: 'pending', pending: true, uncertain: false };
  const date = r.dispatchDate || r.deliveredDate || undefined;
  if (r.shipmentId?.trim()) return { key: r.shipmentId.trim(), date, pending: false, uncertain: !r.dispatchDate };
  const day = businessDay(date);
  // Legacy shipments share a business day, never a live-sale date.
  if (day) return { key: `legacy:${day}`, date, pending: false, uncertain: true };
  return { key: 'unknown-shipment', pending: false, uncertain: true };
}

export function buildAccount(key: string, source: DatabaseRowType[]): CustomerAccount {
  const records = source.some(isAccountsRelevant) ? source.filter(r => fulfilmentStage(r.status) !== 'excluded') : [];
  const groups = new Map<string, AccountBatch>();
  for (const r of records) {
    const identity = accountBatchIdentity(r);
    let group = groups.get(identity.key);
    if (!group) {
      group = { ...identity, records: [], charges: 0, shipping: 0, paid: 0, creditUsed: 0, creditAdded: 0, due: 0 };
      groups.set(identity.key, group);
    }
    group.records.push(r);
    if (r.dispatchDate) { group.date = r.dispatchDate; group.uncertain = !r.shipmentId; }
  }
  const batches = [...groups.values()].sort((a, b) => Number(a.pending) - Number(b.pending)
    || (parseDateRobust(a.date)?.getTime() || 0) - (parseDateRobust(b.date)?.getTime() || 0)
    || a.key.localeCompare(b.key));

  // Accounts is a shipment ledger: every batch carries its own shipping fee.
  // Do not subtract cumulative account invoices here. Their legacy/live-date
  // grouping can let an earlier parcel's free-SF flag or promo suppress fees
  // on later parcels and incorrectly turn delivery payments into credit.
  // Keep existing regional rates and batch-local free/promo/pickup exceptions.
  // Unshipped items form one provisional next shipment, with its estimated fee.
  let totalCharges = 0;
  let credit = 0;
  for (const batch of batches) {
    const feeRow = shippingFeeRow(batch.records);
    batch.shipping = feeRow ? calcShippingFee(feeRow) : 0;
    const unpaidWithoutShipping = batch.records.map(r => ({ ...r, shipmentPaymentAED: 0, freeSf: 'TRUE', downpayment: '', amountReceived: '',
      la1MonthPayment: '', la2MonthPayment: '', la3MonthPayment: '', la4MonthPayment: '' }));
    batch.charges = cents(calcGroupBalance(unpaidWithoutShipping) + batch.shipping);
    totalCharges = cents(totalCharges + batch.charges);
    batch.paid = cents(batch.records.reduce((total, r) => total + calcTotalPaid(r), 0));
    const remaining = cents(batch.charges - batch.paid);
    batch.creditUsed = Math.min(credit, Math.max(0, remaining));
    batch.due = cents(Math.max(0, remaining - batch.creditUsed));
    batch.creditAdded = cents(Math.max(0, -remaining));
    credit = cents(credit - batch.creditUsed + batch.creditAdded);
  }
  return {
    key, name: source.find(r => r.minerName?.trim())?.minerName?.trim() || 'Unknown customer', records, batches,
    excludedPayments: source.filter(r => fulfilmentStage(r.status) === 'excluded' && calcTotalPaid(r) !== 0),
    paid: cents(batches.reduce((s, b) => s + b.paid, 0)), charges: totalCharges,
    due: cents(batches.reduce((s, b) => s + b.due, 0)), credit,
    verification: records.some(r => /payment for verification/i.test(r.status || '')),
  };
}

export function buildAccounts(records: DatabaseRowType[]): CustomerAccount[] {
  return [...groupAccounts(records)].map(([key, rows]) => buildAccount(key, rows))
    .filter(a => a.records.length > 0 || a.excludedPayments.length > 0);
}
