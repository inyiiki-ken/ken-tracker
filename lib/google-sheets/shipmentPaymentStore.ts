import 'server-only';
import { getActiveDoc } from './tenant-context';
import type { ShipmentPayment } from '@/lib/shipmentPayments';
export const PAYMENT_TAB = 'Shipment Payments';
export const PAYMENT_HEADERS = ['Payment ID', 'Payment JSON'];

/** Reads never create a sheet. Failure is not treated as an empty ledger. */
export async function readShipmentPayments(): Promise<ShipmentPayment[]> {
  const doc = await getActiveDoc();
  const sheet = doc.sheetsByTitle[PAYMENT_TAB];
  if (!sheet) return [];
  const entries = new Map<string, ShipmentPayment>();
  for (const row of await sheet.getRows()) {
    const id = String(row.get('Payment ID') || '').trim();
    if (!id) continue;
    const payment = JSON.parse(String(row.get('Payment JSON') || '')) as ShipmentPayment;
    if (payment.id !== id || !Array.isArray(payment.allocations) || !Number.isFinite(payment.amountAED)
      || payment.amountAED <= 0 || payment.allocations.some(a => !a.rowKey || !Number.isFinite(a.amountAED) || a.amountAED < 0)
      || Math.round(payment.allocations.reduce((s, a) => s + a.amountAED, 0) * 100) !== Math.round(payment.amountAED * 100)) {
      throw new Error('A shipment payment is invalid. Check the Shipment Payments sheet.');
    }
    const previous = entries.get(id);
    if (previous && (previous.requestSignature !== payment.requestSignature
      || JSON.stringify(previous.allocations) !== JSON.stringify(payment.allocations))) throw new Error('Conflicting shipment payment IDs. Check the payment ledger.');
    entries.set(id, payment);
  }
  return [...entries.values()];
}
