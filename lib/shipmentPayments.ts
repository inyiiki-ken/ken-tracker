import type { DatabaseRowType } from '@/types';

export interface ShipmentPayment {
  id: string;
  accountKey: string;
  customerName: string;
  batchKey: string;
  scope: 'shipment' | 'items';
  amountAED: number;
  date: string;
  method: string;
  reference: string;
  createdAt: string;
  createdBy: string;
  requestSignature: string;
  allocations: { rowKey: string; amountAED: number; description: string }[];
}
export interface ShipmentPaymentInput {
  id: string;
  accountKey: string;
  batchKey: string;
  scope: 'shipment' | 'items';
  amountAED: number;
  date: string;
  method: string;
  reference: string;
  items: { id: number; rowKey: string; fingerprint: string }[];
}
export const paymentFingerprint = (r: DatabaseRowType) => JSON.stringify([
  r.orderId || '', r.minerName || '', r.itemDescription || '', r.dateOfLive || '', String(r.grams || ''),
]);

/** Allocations are bookkeeping links, not edits to the item's downpayment.
 * Equal cent-exact shares let a payment follow selected items if a pending
 * batch is later split into separate shipments. */
export function allocatePayment(amountAED: number, rows: DatabaseRowType[]): ShipmentPayment['allocations'] {
  const total = Math.round(amountAED * 100);
  if (!Number.isSafeInteger(total) || total <= 0 || !rows.length || rows.some(r => !r.rowKey)) throw new Error('Invalid payment or items.');
  const sorted = [...rows].sort((a, b) => a.rowKey!.localeCompare(b.rowKey!));
  if (new Set(sorted.map(r => r.rowKey)).size !== sorted.length) throw new Error('Duplicate item keys.');
  const each = Math.floor(total / sorted.length), extra = total % sorted.length;
  return sorted.map((r, i) => ({ rowKey: r.rowKey!, amountAED: (each + (i < extra ? 1 : 0)) / 100, description: r.itemDescription || 'Item' }));
}

export function attachShipmentPayments(records: DatabaseRowType[], payments: ShipmentPayment[]): DatabaseRowType[] {
  const byKey = new Map<string, number>();
  const seen = new Set<string>();
  for (const p of payments) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    for (const a of p.allocations) byKey.set(a.rowKey, (byKey.get(a.rowKey) || 0) + Math.round(a.amountAED * 100));
  }
  // Refuse ambiguous duplicate row keys instead of counting a payment twice.
  const keys = records.map(r => r.rowKey).filter(Boolean);
  const duplicates = new Set(keys.filter((k, i) => keys.indexOf(k) !== i));
  if ([...duplicates].some(k => byKey.has(k!))) throw new Error('Payment-linked items have duplicate Row Keys. Fix Row Keys before loading balances.');
  return records.map(r => ({ ...r, shipmentPaymentAED: (byKey.get(r.rowKey || '') || 0) / 100 }));
}
