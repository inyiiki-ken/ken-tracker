const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const cache = new Map();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: key => cache.get(key) ?? null,
  setItem: (key, value) => cache.set(key, String(value)),
  removeItem: key => cache.delete(key),
}, configurable: true });
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return originalResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
const compile = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
};
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === '@/components/BrandThemeLoader') return { useBrand: () => ({
    settings: { companyName: 'Test shop', location: 'UAE' }, pageLogos: {},
  }) };
  return originalLoad.call(this, name, ...args);
};
const { DEFAULT_PRICING, setPricing, getPricing, applyPricingConfig } = require('../lib/pricingConfig.ts');
const { upgradeCrownDeliveryRules } = require('../lib/crownDeliveryRules.ts');
const { roundPrice, calcItemPriceAED, calcItemPrice, groupShippingFee, calcInvoiceLedger, shipmentIdentityFor } = require('../lib/calculations.ts');
const { customerCollectAED, collectForAED, sharedShippingCarriers } = require('../lib/liverMoney.ts');
const row = (id, extra = {}) => ({ id, minerName: 'Test customer', clientRate: 409, grams: 1.23,
  currency: 'AED', locationOfMiner: 'LOCAL', modeOfPayment: 'COD', dateOfLive: '2026-10-01', status: 'For COD', ...extra });
const crown = upgradeCrownDeliveryRules(JSON.stringify(DEFAULT_PRICING), 'Crown');
applyPricingConfig(crown);
assert.equal(getPricing().shippingFeeInternational, 450);
assert.equal(groupShippingFee([row(1, { regions: 'Western Region' })]), 45);
assert.equal(groupShippingFee([row(1, { regions: 'Dubai' })]), 30);
assert.equal(groupShippingFee([row(1, { regions: 'International' })]), 450);
assert.equal(upgradeCrownDeliveryRules(crown, 'Crown'), crown);
assert.equal(upgradeCrownDeliveryRules('{}', 'Silver Zone'), '{}');
assert.equal(roundPrice(514.49), 514);
assert.equal(roundPrice(514.5), 515);
assert.equal(roundPrice(2.3 * 445), 1024);
const tabby = row(1, { modeOfPayment: 'Tabby' });
assert.equal(calcItemPriceAED(tabby), 579);
assert.equal(calcItemPrice(tabby), 579);
assert.equal(calcItemPriceAED(row(1, { modeOfPayment: 'Tamara' })), 503);
assert.equal(calcItemPriceAED(tabby) + calcItemPriceAED(tabby), 1158);
const shipped = [row(1, { status: 'Delivered', dispatchDate: '2026-10-04T08:00:00Z' }),
  row(2, { dateOfLive: '2026-10-02', status: 'Delivered', dispatchDate: '2026-10-04T08:00:00Z' }),
  row(3, { dateOfLive: '2026-10-03', status: 'Delivered', dispatchDate: '2026-10-04T08:00:00Z' })];
const next = row(4, { dateOfLive: '2026-10-05' });
assert.equal(groupShippingFee(shipped), 30);
assert.equal(groupShippingFee([...shipped, next]), 60);
const sentToday = row(8, { shipmentId: 'parcel-a', dispatchDate: '2026-10-08T08:00:00Z', status: 'Dispatched' });
const waiting = row(9, { dateOfLive: '2026-10-08', auditTrail: '2026-10-08T07:00:00Z | test | Created' });
const newToday = row(10, { dateOfLive: '2026-10-08', auditTrail: '2026-10-08T09:00:00Z | test | Created' });
assert.equal(groupShippingFee([sentToday, waiting]), 30);
assert.equal(groupShippingFee([sentToday, newToday]), 60);
assert.equal(shipmentIdentityFor(waiting, [sentToday, waiting], '2026-10-08T10:00:00Z'), 'parcel-a');
assert.equal(shipmentIdentityFor(newToday, [sentToday, newToday], '2026-10-08T10:00:00Z'), 'shipment:2026-10-08T10:00:00Z');
assert.equal(groupShippingFee([sentToday, { ...newToday, shipmentId: 'parcel-b', dispatchDate: '2026-10-08T10:00:00Z' }]), 60);
assert.equal(customerCollectAED([...shipped, next]), 533);
assert.equal(collectForAED([next], [...shipped, next]), 533);
assert.equal(sharedShippingCarriers([...shipped, next], new Set(['TEST CUSTOMER'])).has(4), true);
assert.equal(sharedShippingCarriers([...shipped, next], new Set(['TEST CUSTOMER']), { perShipment: true, timezoneOffsetMs: 14400000 }).has(4), true);
assert.equal(groupShippingFee([...shipped.map(r => ({ ...r, freeSf: 'TRUE' })), next]), 30);
assert.deepEqual(calcInvoiceLedger([shipped, [next]]), [{ balance: 1539 }, { balance: 533 }]);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Invoice = require('../components/InvoicePrintContent.tsx').default;
const markup = renderToStaticMarkup(React.createElement(Invoice, { records: [tabby, { ...tabby, id: 2 }], currency: 'AED' }));
assert.match(markup, /1,158/); // sum of two independently rounded Tabby items
assert.match(markup, /579/);
const nextInvoice = renderToStaticMarkup(React.createElement(Invoice, { records: [next], priorRecords: shipped, currency: 'AED' }));
assert.match(nextInvoice, /AED 30/);
setPricing({ ...DEFAULT_PRICING });
assert.equal(calcItemPriceAED(tabby), 503);
assert.equal(groupShippingFee([...shipped, next]), 35);
applyPricingConfig(crown);
applyPricingConfig('');
assert.equal(getPricing().tabbySurchargePct, 0);
console.log('Delivery pricing checks passed.');
