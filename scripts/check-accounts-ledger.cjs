// Run: node scripts/check-accounts-ledger.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
} });
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { buildAccounts } = require('../lib/accountsLedger.ts');
const { calcGroupBalance, calcTotalPaid } = require('../lib/calculations.ts');
const { applyPricingConfig } = require('../lib/pricingConfig.ts');
const row = (id, extra = {}) => ({ id, minerName: 'Customer', customerId: 'C1', grams: 1, clientRate: 100,
  dateOfLive: '2026-09-01', status: 'Delivered', currency: 'AED', modeOfPayment: 'Bank Transfer AED',
  freeSf: 'TRUE', shipmentId: 's1', dispatchDate: '2026-10-01T10:00:00Z', ...extra });
const one = rows => { const accounts = buildAccounts(rows); assert.equal(accounts.length, 1); return accounts[0]; };
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name); };
check('one payment settles different live dates in one shipment', () => {
  const a = one([row(1, { downpayment: '200' }), row(2, { dateOfLive: '2026-09-28' })]);
  assert.equal(a.batches.length, 1); assert.equal(a.due, 0); assert.equal(a.credit, 0); assert.equal(a.paid, 200);
});
check('Mai Mai separate extra payment is counted once', () => {
  const a = one([row(1, { clientRate: 17454, downpayment: '17454' }), row(2, { status: 'Reseller', shipmentId: '', dispatchDate: '', clientRate: 100, downpayment: '76' })]);
  assert.equal(a.paid, 17530); assert.equal(a.batches[0].due, 0); assert.equal(a.batches[1].due, 24);
});
check('excess credit covers next shipment and retains remainder', () => {
  const a = one([row(1, { downpayment: '350' }), row(2, { shipmentId: 's2', dispatchDate: '2026-11-01' })]);
  assert.equal(a.batches[0].creditAdded, 250); assert.equal(a.batches[1].creditUsed, 100); assert.equal(a.credit, 150); assert.equal(a.due, 0);
});
check('credit applies to unshipped items after shipped batches', () => {
  const a = one([row(2, { status: 'For International Shipment', shipmentId: '', dispatchDate: '' }), row(1, { downpayment: '150' })]);
  assert.equal(a.batches[1].pending, true); assert.equal(a.batches[1].creditUsed, 50); assert.equal(a.due, 50);
});
check('later payment stays with later shipment, never conceals old debt', () => {
  const a = one([row(1), row(2, { shipmentId: 's2', dispatchDate: '2026-11-01', downpayment: '300' })]);
  assert.equal(a.due, 100); assert.equal(a.credit, 200); assert.equal(a.charges - a.paid, a.due - a.credit);
});
check('reseller billed identity reunites original buyer IDs', () => {
  const a = one([row(1, { customerId: 'buyer1', minerName: 'ARIAN', downpayment: '200', auditTrail: '2026-10-01 | Reseller invoice | Billed to ARIAN (customer buyer1)' }), row(2, { customerId: 'buyer2', minerName: ' arian ' })]);
  assert.equal(a.due, 0); assert.equal(a.records.length, 2);
});
check('ordinary namesakes with different IDs stay separate', () => {
  assert.equal(buildAccounts([row(1), row(2, { customerId: 'C2' })]).length, 2);
});
check('cancelled money is flagged, never assumed to be unrefunded credit', () => {
  const a = one([row(1), row(2, { status: 'Cancelled', downpayment: '200' })]);
  assert.equal(a.paid, 0); assert.equal(a.due, 100); assert.equal(a.excludedPayments.length, 1);
});
check('legacy shipment groups by dispatch day, not sale date', () => {
  const a = one([row(1, { shipmentId: '' }), row(2, { shipmentId: '', dateOfLive: '2026-11-01', dispatchDate: '2026-10-01T13:00:00Z' })]);
  assert.equal(a.batches.length, 1); assert.equal(a.batches[0].uncertain, true);
});
check('different shipment IDs on same day remain separate', () => {
  assert.equal(one([row(1), row(2, { shipmentId: 's2' })]).batches.length, 2);
});
check('shipment date absence is explicit, not inferred from live date', () => {
  const a = one([row(1, { shipmentId: '', dispatchDate: '' })]);
  assert.equal(a.batches[0].date, undefined); assert.equal(a.batches[0].uncertain, true);
});
check('payments retain cents and repeated audit edits are not extra payments', () => {
  const a = one([row(1, { downpayment: '100.08', auditTrail: 'Updated: downpayment\nUpdated: downpayment' })]);
  assert.equal(a.paid, 100.08); assert.equal(a.credit, 0.08);
});
check('remittance confirmation does not remove an unpaid purchase', () => {
  assert.equal(one([row(1, { remittanceStatus: 'Received' })]).due, 100);
});
check('chronological ordering handles month strings numerically', () => {
  const a = one([row(1, { dispatchDate: '11/1/2026', shipmentId: 'nov' }), row(2, { dispatchDate: '9/1/2026', shipmentId: 'sep' })]);
  assert.equal(a.batches[0].key, 'sep');
});
check('shipment charges reconcile with current invoice shipping rules', () => {
  applyPricingConfig(JSON.stringify({ shippingPerShipment: true, newRulesFrom: '2026-10-10', leftoverShipping: 'charge', shippingFeeInternational: 450 }));
  const rows = [row(1, { freeSf: '', locationOfMiner: 'INTERNATIONAL', dateOfLive: '2026-10-12', downpayment: '500' }), row(2, { freeSf: '', locationOfMiner: 'INTERNATIONAL', dateOfLive: '2026-10-14', shipmentId: 's2', dispatchDate: '2026-11-01' })];
  const a = one(rows);
  assert.equal(a.charges - a.paid, calcGroupBalance(rows));
  assert.equal(a.due - a.credit, a.charges - a.paid);
  assert.equal(a.paid, rows.reduce((s, r) => s + calcTotalPaid(r), 0));
});
console.log(`${count} accounts ledger checks passed.`);
