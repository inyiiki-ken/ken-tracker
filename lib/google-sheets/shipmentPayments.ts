"use server";

import { requireRole } from './authz';
import { getAppTab } from './appTabs';
import { readDatabase, newRowKey, writeRowsByCells, ensureOptionalColumns } from './recordStore';
import { databaseRecordToRow } from './row-mapper';
import { DATABASE_HEADERS } from './sheet-config';
import { createHash } from 'crypto';
import { readShipmentPayments, PAYMENT_HEADERS, PAYMENT_TAB } from './shipmentPaymentStore';
import { groupAccounts, accountBatchIdentity } from '@/lib/accountsLedger';
import { fulfilmentStage } from '@/lib/fulfilment';
import { allocatePayment, paymentFingerprint, type ShipmentPayment, type ShipmentPaymentInput } from '@/lib/shipmentPayments';

const ROLES = ['super_admin', 'admin', 'accounts'];
let chain: Promise<unknown> = Promise.resolve();

export async function getShipmentPayments(): Promise<ShipmentPayment[]> {
  await requireRole([...ROLES, 'dispatch', 'bossing']);
  return readShipmentPayments();
}

export async function addShipmentPayment(input: ShipmentPaymentInput): Promise<ShipmentPayment> {
  const email = await requireRole(ROLES);
  const run = async () => {
    if (!/^[a-f0-9-]{36}$/i.test(input.id) || !['shipment', 'items'].includes(input.scope)
      || !Number.isFinite(input.amountAED) || input.amountAED <= 0 || input.amountAED > 100000000
      || Math.abs(input.amountAED * 100 - Math.round(input.amountAED * 100)) > 0.00001
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || new Date(input.date).toISOString().slice(0, 10) !== input.date
      || !input.method?.trim() || input.method.length > 100 || input.reference.length > 500
      || !Array.isArray(input.items) || !input.items.length || input.items.length > 500) throw new Error('Check the payment amount, date and selected items.');
    const requestSignature = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = (await readShipmentPayments()).find(p => p.id === input.id);
    if (existing) {
      if (existing.requestSignature !== requestSignature) {
        throw new Error('This payment was already saved with different details. Refresh before entering another.');
      }
      return existing;
    }
    const db = await readDatabase();
    const customer = groupAccounts(db.records).get(input.accountKey);
    if (!customer) throw new Error('Customer changed. Refresh and try again.');
    const currentBatch = customer.filter(r => fulfilmentStage(r.status) !== 'excluded' && accountBatchIdentity(r).key === input.batchKey);
    const selected = input.items.map(ref => {
      const matches = db.records.filter(r => ref.rowKey ? r.rowKey === ref.rowKey : r.id === ref.id);
      const r = matches[0];
      if (matches.length !== 1 || !currentBatch.includes(r) || paymentFingerprint(r) !== ref.fingerprint) throw new Error('Selected items changed. Refresh and try again.');
      return r;
    });
    if (new Set(selected.map(r => r.id)).size !== selected.length) throw new Error('An item was selected twice.');
    if (input.scope === 'shipment' && selected.length !== currentBatch.length) throw new Error('The shipment items changed. Refresh before paying the whole shipment.');
    const missing = selected.filter(r => !r.rowKey);
    if (missing.length) {
      await ensureOptionalColumns(db.sheet, [{ rowKey: 'required' }]);
      const updates = missing.map(r => {
        const key = newRowKey();
        const expect = { ...databaseRecordToRow({ minerName: r.minerName, itemDescription: r.itemDescription,
          dateOfLive: r.dateOfLive, orderId: r.orderId }, db.headers, db.aliases), [DATABASE_HEADERS.rowKey]: '' };
        r.rowKey = key;
        return { rowNumber: r.id, patch: { [DATABASE_HEADERS.rowKey]: key }, expect };
      });
      if (await writeRowsByCells(db.sheet, updates) !== missing.length) throw new Error('Could not identify every item. Refresh and retry.');
    }
    const payment: ShipmentPayment = {
      id: input.id, accountKey: input.accountKey, customerName: customer[0].minerName || 'Customer',
      batchKey: input.batchKey, scope: input.scope, amountAED: input.amountAED,
      date: input.date, method: input.method.trim(), reference: input.reference.trim(),
      createdAt: new Date().toISOString(), createdBy: email || 'Staff', requestSignature, allocations: allocatePayment(input.amountAED, selected),
    };
    const serialized = JSON.stringify(payment);
    if (serialized.length > 45000) throw new Error('Too many item details for one payment. Select a smaller set of items.');
    const tab = await getAppTab(PAYMENT_TAB, PAYMENT_HEADERS);
    // One append is the complete transaction. Retried requests retain their ID;
    // duplicate identical appends across server instances are counted once.
    await tab.addRow({ 'Payment ID': payment.id, 'Payment JSON': serialized });
    return payment;
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}
