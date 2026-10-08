// Regression checks for Tabby pricing, per-parcel shipping, the start date and
// safe pricing reads/saves, run against the real calculation code.
// Run: node scripts/check-delivery-pricing.cjs
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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
};
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;

// Fake Google sheet for the server pricing store.
const sheet = { config: new Map(), uploads: new Map(), failConfig: false, failUploads: false, writes: 0 };
const rowsOf = map => [...map].map(([k, v]) => ({ get: h => (h === 'Status' ? k : h === 'Masterlist File' ? v : '') }));
let tenant = { tenantId: 'crown-ab12', displayName: 'Crown', sheetId: 's1' };
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'server-only') return {};
  if (name === '@/components/BrandThemeLoader') return { useBrand: () => ({ settings: { companyName: 'Test shop', location: 'UAE' }, pageLogos: {} }) };
  if (name === './tenant-context') return {
    getActiveRows: async tab => {
      if (tab === 'config') { if (sheet.failConfig) throw new Error('429'); return rowsOf(sheet.config); }
      if (sheet.failUploads) throw new Error('429'); return rowsOf(sheet.uploads);
    },
    getActiveWorksheet: async () => ({
      getRows: async () => [...sheet.config].map(([k]) => ({ get: h => (h === 'Status' ? k : ''), set: (h, v) => sheet.config.set(k, v), save: async () => { sheet.writes++; } })),
      addRow: async row => { sheet.config.set(row.Status, row['Masterlist File']); sheet.writes++; },
    }),
    invalidateActiveRows: () => {},
  };
  if (name === './tenancy-core') return { getMyContextCore: async () => ({ activeTenant: tenant }) };
  return originalLoad.call(this, name, ...args);
};

const P = require('../lib/pricingConfig.ts');
const { upgradeCrownDeliveryRules, isCrownTenant } = require('../lib/crownDeliveryRules.ts');
const C = require('../lib/calculations.ts');
const L = require('../lib/liverMoney.ts');
const store = require('../lib/google-sheets/pricingStore.ts');
const { ConfigReadError } = require('../lib/google-sheets/config-store.ts');

const CROWN_SAVED = JSON.stringify({ makingCharges: { 'Gold Normal': 25, 'Special Price': 30 }, shippingFees: { dubai: 25, 'abu dhabi': 35, rak: 35, fujairah: 35, western: 35 }, shippingFeeInternational: 450 });
const crown = upgradeCrownDeliveryRules(CROWN_SAVED, tenant);
const useCrown = (extra = {}) => P.applyPricingConfig(JSON.stringify({ ...JSON.parse(crown), ...extra }));
const row = (id, extra = {}) => ({ id, minerName: 'Test customer', clientRate: 409, grams: 1.23, currency: 'AED',
  locationOfMiner: 'INTERNATIONAL', modeOfPayment: 'Bank Transfer AED', dateOfLive: '2026-10-12', status: 'For International Shipment', ...extra });
const local = (id, extra = {}) => row(id, { locationOfMiner: 'LOCAL', modeOfPayment: 'COD', regions: 'Dubai', status: 'For COD', ...extra });
let checks = 0;
const check = (name, fn) => { fn(); checks++; };

// ── Rounding ────────────────────────────────────────────────────────────────
check('half-up rounding', () => {
  assert.equal(C.roundPrice(514.49), 514);
  assert.equal(C.roundPrice(514.5), 515);
  assert.equal(C.roundPrice(2.3 * 445), 1024);      // 1023.4999999 in floating point
  assert.equal(C.roundPrice(1.005 * 1000), 1005);
  assert.equal(C.roundPrice(0.5), 1);
});

// ── Crown upgrade: keeps MC, fees, tenant scope ─────────────────────────────
check('crown upgrade', () => {
  useCrown();
  const p = P.getPricing();
  assert.deepEqual(p.makingCharges, { 'Gold Normal': 25, 'Special Price': 30 });
  assert.equal(p.tabbySurchargePct, 15);
  assert.equal(p.newRulesFrom, '2026-10-10');
  assert.equal(p.leftoverShipping, 'charge');
  assert.equal(p.crownTenantId, 'crown-ab12');
  assert.equal(upgradeCrownDeliveryRules(crown, tenant), null, 'runs once');
  assert.equal(upgradeCrownDeliveryRules(CROWN_SAVED, { tenantId: 'silver-zone-x1y2', displayName: 'Silver Zone' }), null);
  assert.equal(upgradeCrownDeliveryRules(CROWN_SAVED, { tenantId: 'ar-universal-trading-9k2j', displayName: 'AR Universal Trading' }), null);
  assert.equal(upgradeCrownDeliveryRules('{not json', tenant), null, 'malformed is never upgraded');
  assert.equal(isCrownTenant({ tenantId: 'crown-ab12', displayName: 'Crown Jewellery' }), true, 'rename keeps the id match');
  // v0.3.55 already saved version 1 with Tabby switched off: respected.
  const v1 = JSON.stringify({ ...JSON.parse(CROWN_SAVED), tabbySurchargePct: 0, shippingPerShipment: false, crownDeliveryRulesVersion: 1 });
  const v2 = JSON.parse(upgradeCrownDeliveryRules(v1, tenant));
  assert.equal(v2.tabbySurchargePct, 0);
  assert.equal(v2.shippingPerShipment, false);
  assert.equal(v2.newRulesFrom, '2026-10-10');
});

check('shipping fees by region', () => {
  useCrown();
  const fee = regions => C.calcShippingFee(local(1, { regions }));
  assert.equal(fee('Western Region'), 45);
  assert.equal(fee('Abu Dhabi - Western'), 45);
  assert.equal(fee('Al Dhafra'), 45);
  assert.equal(fee('Abu Dhabi'), 30);
  assert.equal(fee('RAK'), 30);
  assert.equal(fee('Fujairah'), 30);
  assert.equal(fee('Dubai'), 30);
  assert.equal(fee('Somewhere new'), 30);
  assert.equal(C.calcShippingFee(row(1)), 450);
});

// ── Tabby ───────────────────────────────────────────────────────────────────
check('tabby', () => {
  useCrown();
  const tabby = row(1, { modeOfPayment: 'Tabby' });
  assert.equal(C.calcItemPriceAED(tabby), 579);                    // 1.23 × 409 × 1.15 = 578.53
  assert.equal(C.calcItemPrice(tabby), 579);
  assert.equal(C.calcItemPriceAED(tabby) + C.calcItemPriceAED({ ...tabby, id: 2 }), 1158);
  assert.equal(C.calcItemPriceAED(row(1, { modeOfPayment: 'Tamara' })), 503);
  // Bought before the start date: old price, even if the rate already had 15% in it.
  assert.equal(C.calcItemPriceAED({ ...tabby, dateOfLive: '2026-10-05' }), 503);
  assert.equal(C.calcItemPriceAED({ ...tabby, dateOfLive: '2026-10-05', clientRate: 470 }), 578);
  // Missing / unreadable live date: old rules, never a surprise increase.
  assert.equal(C.calcItemPriceAED({ ...tabby, dateOfLive: '' }), 503);
  assert.equal(C.calcItemPriceAED({ ...tabby, dateOfLive: 'not a date' }), 503);
  // After the start date the increase is added once; a rate marked "Tabby Included" gets none.
  assert.equal(C.calcItemPriceAED({ ...tabby, clientRate: 470, tabbyIncluded: 'Yes' }), 578);
  assert.equal(C.calcItemPriceAED({ ...tabby, dateOfLive: '2026-10-10' }), 579, 'start day itself is new');
  // Shipping is never increased by Tabby.
  assert.equal(C.calcShippingFee(tabby), 450);
  P.setPricing({ ...P.DEFAULT_PRICING });
  assert.equal(C.calcItemPriceAED(tabby), 503, 'other tenants: off');
});

check('invoice print agrees', () => {
  useCrown();
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Invoice = require('../components/InvoicePrintContent.tsx').default;
  const tabby = row(1, { modeOfPayment: 'Tabby', locationOfMiner: 'LOCAL', regions: 'Dubai' });
  const html = renderToStaticMarkup(React.createElement(Invoice, { records: [tabby, { ...tabby, id: 2 }], currency: 'AED' }));
  assert.match(html, /1,158/);
  assert.match(html, /579/);
});

// ── Shipping: start date keeps the old calculation ──────────────────────────
check('old parcels keep one fee', () => {
  useCrown();
  const twoOld = [row(1, { dateOfLive: '2026-09-20', status: 'Delivered', dispatchDate: '2026-09-27T08:00:00Z' }),
    row(2, { dateOfLive: '2026-10-01', status: 'Delivered', dispatchDate: '2026-10-03T08:00:00Z' })];
  assert.equal(C.groupShippingFee(twoOld), 450, 'two old international parcels');
  const oneParcelTwoDays = [row(1, { dateOfLive: '2026-10-05', status: 'Dispatched', dispatchDate: '2026-10-06T08:00:00Z' }),
    row(2, { dateOfLive: '2026-10-05', status: 'Dispatched', dispatchDate: '2026-10-07T05:00:00Z' })];
  assert.equal(C.groupShippingFee(oneParcelTwoDays), 450, 'old parcel marked on two days');
  const undated = [row(1, { dateOfLive: '', status: 'Delivered' }), row(2, { dateOfLive: '??', status: 'Delivered' })];
  assert.equal(C.groupShippingFee(undated), 450, 'missing dates stay old');
  // Old waiting order + new order sent together: one fee.
  const mixed = [row(1, { dateOfLive: '2026-10-08', status: 'Dispatched', dispatchDate: '2026-10-12T08:00:00Z', shipmentId: 'p1' }),
    row(2, { dateOfLive: '2026-10-11', status: 'Dispatched', dispatchDate: '2026-10-12T08:00:00Z', shipmentId: 'p1' })];
  assert.equal(C.groupShippingFee(mixed), 450, 'old + new in one parcel');
  // An invoice ledger over old items is unchanged.
  assert.deepEqual(C.calcInvoiceLedger([[twoOld[0]], [twoOld[1]]]), [{ balance: 953 }, { balance: 503 }]);
});

check('new parcels: one fee each', () => {
  useCrown();
  const sent = [row(1, { dateOfLive: '2026-10-11', status: 'Delivered', dispatchDate: '2026-10-14T08:00:00Z', shipmentId: 'a' }),
    row(2, { dateOfLive: '2026-10-12', status: 'Delivered', dispatchDate: '2026-10-14T08:00:00Z', shipmentId: 'a' }),
    row(3, { dateOfLive: '2026-10-13', status: 'Delivered', dispatchDate: '2026-10-14T08:00:00Z', shipmentId: 'a' })];
  assert.equal(C.groupShippingFee(sent), 450, 'several live days sent together');
  const next = row(4, { dateOfLive: '2026-10-15' });
  assert.equal(C.groupShippingFee([...sent, next]), 900, 'bought after dispatch: new fee');
  // Same-day masterlist import saved after the parcel left: new fee.
  const imported = row(5, { dateOfLive: '2026-10-14', auditTrail: '2026-10-14T10:00:00Z | x | Imported from masterlist' });
  assert.equal(C.groupShippingFee([...sent, imported]), 900);
  // Leftover (bought before, sent later on its own): charged with leftover = charge...
  const leftover = row(6, { dateOfLive: '2026-10-12', status: 'Dispatched', dispatchDate: '2026-10-18T08:00:00Z', shipmentId: 'b' });
  assert.equal(C.groupShippingFee([...sent, leftover]), 900);
  // ...free with leftover = free.
  useCrown({ leftoverShipping: 'free' });
  const waitingLeftover = row(7, { dateOfLive: '2026-10-12' });
  assert.equal(C.groupShippingFee([...sent, waitingLeftover]), 450);
  assert.equal(C.shipmentIdentityFor(waitingLeftover, [...sent, waitingLeftover], '2026-10-18T08:00:00Z'), 'a');
  useCrown();
  assert.equal(C.shipmentIdentityFor(waitingLeftover, [...sent, waitingLeftover], '2026-10-18T08:00:00Z'), 'shipment:2026-10-18T08:00:00Z');
});

check('free / promo SF scoped to its parcel', () => {
  useCrown();
  const a = [row(1, { dateOfLive: '2026-10-11', status: 'Delivered', dispatchDate: '2026-10-12T08:00:00Z', shipmentId: 'a', freeSf: 'TRUE' })];
  const b = [row(2, { dateOfLive: '2026-10-13' })];
  assert.equal(C.groupShippingFee([...a, ...b]), 450);
});

// ── Shipment identity across workflows ──────────────────────────────────────
check('one-by-one and bulk dispatch agree', () => {
  useCrown();
  const waiting = [row(1, { dateOfLive: '2026-10-11' }), row(2, { dateOfLive: '2026-10-12' }), row(3, { dateOfLive: '2026-10-13' })];
  // Bulk: one `now` for every item.
  const now = '2026-10-14T08:00:00Z';
  const bulk = waiting.map(r => ({ ...r, status: 'Dispatched', dispatchDate: now, shipmentId: C.shipmentIdentityFor(r, waiting, now) }));
  assert.equal(new Set(bulk.map(r => r.shipmentId)).size, 1);
  assert.equal(C.groupShippingFee(bulk), 450);
  // One by one, minutes apart.
  let all = [...waiting];
  ['2026-10-14T08:00:00Z', '2026-10-14T08:03:00Z', '2026-10-14T09:30:00Z'].forEach((t, i) => {
    const id = C.shipmentIdentityFor(all[i], all, t);
    all = all.map((r, j) => j === i ? { ...r, status: 'Dispatched', dispatchDate: t, shipmentId: id } : r);
  });
  assert.equal(new Set(all.map(r => r.shipmentId)).size, 1);
  assert.equal(C.groupShippingFee(all), 450);
  // Item added by hand after the parcel left, then sent the same day: new parcel.
  const late = row(9, { dateOfLive: '2026-10-14', auditTrail: '2026-10-14T11:00:00Z | x | Created' });
  assert.equal(C.shipmentIdentityFor(late, [...all, late], '2026-10-14T12:00:00Z'), 'shipment:2026-10-14T12:00:00Z');
});

check('two liver reports for one parcel', () => {
  useCrown();
  const cod = [local(1, { dateOfLive: '2026-10-11' }), local(2, { dateOfLive: '2026-10-12' })];
  const t1 = '2026-10-14T08:00:00Z', t2 = '2026-10-14T13:00:00Z';
  const first = { ...cod[0], status: 'Delivered', deliveredDate: t1, shipmentId: C.shipmentIdentityFor(cod[0], cod, t1) };
  const after1 = [first, cod[1]];
  const second = { ...cod[1], status: 'Delivered', deliveredDate: t2, shipmentId: C.shipmentIdentityFor(cod[1], after1, t2) };
  assert.equal(first.shipmentId, second.shipmentId);
  assert.equal(C.groupShippingFee([first, second]), 30);
});

check('COD collect, balance, credit and shared livers agree', () => {
  useCrown();
  const sent = local(1, { dateOfLive: '2026-10-11', status: 'Delivered', deliveredDate: '2026-10-12T08:00:00Z', shipmentId: 'a', amountReceived: '533' });
  const open = local(2, { dateOfLive: '2026-10-13' });
  assert.equal(C.calcGroupBalance([sent]), 0);
  assert.equal(C.calcGroupBalance([sent, open]), 533, 'new parcel: item + 30');
  assert.equal(L.customerCollectAED([sent, open]), 533);
  assert.equal(L.collectForAED([open], [sent, open]), 533);
  assert.deepEqual(C.calcInvoiceLedger([[sent], [open]]), [{ balance: 0 }, { balance: 533 }]);
  // Store credit from the first invoice carries into the next.
  const over = { ...sent, amountReceived: '600' };
  assert.deepEqual(C.calcInvoiceLedger([[over], [open]]), [{ balance: -67 }, { balance: 466 }]);
  // Shared customer (two livers): one carrier per open parcel, rules passed explicitly.
  const rules = C.shipRulesFor(P.getPricing(), 4 * 3600000);
  const carriers = L.sharedShippingCarriers([sent, open], new Set([C.customerKey(open)]), rules);
  assert.deepEqual([...carriers.keys()], [2]);
  // Before the start date everything is one old group: the old answer.
  const oldSent = { ...sent, dateOfLive: '2026-10-01' }, oldOpen = { ...open, dateOfLive: '2026-10-02' };
  assert.equal(C.calcGroupBalance([oldSent, oldOpen]), 503);
});

check('tenants without the feature keep one fee per customer', () => {
  P.setPricing({ ...P.DEFAULT_PRICING });
  const r = [row(1, { status: 'Delivered', dispatchDate: '2026-10-12T08:00:00Z' }), row(2, { dateOfLive: '2026-10-20' })];
  assert.equal(C.groupShippingFee(r), 299);
});

// ── Pricing reads / saves (server store with a fake sheet) ──────────────────
(async () => {
  sheet.config.set('__PRICING_CONFIG__', CROWN_SAVED);
  const first = await store.loadStoredPricing({ persistUpgrade: true });
  assert.equal(JSON.parse(first.config).crownDeliveryRulesVersion, 2);
  assert.equal(JSON.parse(sheet.config.get('__PRICING_CONFIG__')).makingCharges['Gold Normal'], 25, 'upgrade saved, MC kept');
  checks++;

  // Rename after the upgrade: nothing changes.
  tenant = { ...tenant, displayName: 'Crown Gold' };
  const writes = sheet.writes;
  assert.equal((await store.loadStoredPricing({ persistUpgrade: true })).config, sheet.config.get('__PRICING_CONFIG__'));
  assert.equal(sheet.writes, writes);
  checks++;

  // Failed read: throws (never "nothing saved"), no upgrade, no fallback to legacy uploads.
  sheet.failConfig = true;
  sheet.uploads.set('__PRICING_CONFIG__', '{"makingCharges":{"Gold Normal":16}}');
  await assert.rejects(store.loadStoredPricing({ persistUpgrade: true }), ConfigReadError);
  // ...and a save is refused, so defaults can't overwrite Crown's MC.
  await assert.rejects(store.savePricingChecked(JSON.stringify(P.DEFAULT_PRICING), store.pricingVersion(sheet.config.get('__PRICING_CONFIG__'))));
  assert.equal(JSON.parse(sheet.config.get('__PRICING_CONFIG__')).makingCharges['Gold Normal'], 25);
  sheet.failConfig = false;
  checks++;

  // Stale or never-loaded editor: refused. Loaded copy: saved.
  const current = sheet.config.get('__PRICING_CONFIG__');
  await assert.rejects(store.savePricingChecked(JSON.stringify(P.DEFAULT_PRICING), undefined));
  await assert.rejects(store.savePricingChecked(JSON.stringify(P.DEFAULT_PRICING), store.pricingVersion('{}')));
  await assert.rejects(store.savePricingChecked('not json', store.pricingVersion(current)));
  const v = await store.savePricingChecked(JSON.stringify({ ...JSON.parse(current), tabbySurchargePct: 0 }), store.pricingVersion(current));
  assert.equal(v, store.pricingVersion(sheet.config.get('__PRICING_CONFIG__')));
  checks++;

  // First-time setup: sheet read fine, nothing saved yet.
  sheet.config.clear(); sheet.uploads.clear();
  tenant = { tenantId: 'silver-zone-x1y2', displayName: 'Silver Zone' };
  const empty = await store.loadStoredPricing({ persistUpgrade: true });
  assert.equal(empty.config, '');
  await store.savePricingChecked('{"usdToAed":3.67}', store.pricingVersion(''));
  checks++;

  // Legacy Uploads value used only when the config tab read worked and lacks the marker.
  sheet.config.clear(); sheet.uploads.set('__PRICING_CONFIG__', '{"usdToAed":3.6}');
  assert.equal((await store.loadStoredPricing({ persistUpgrade: false })).config, '{"usdToAed":3.6}');
  checks++;

  // Browser side: a successful empty read resets to defaults (no leak from the
  // previous tenant); a malformed value keeps what was loaded.
  useCrown();
  assert.equal(P.applyPricingConfig('{broken'), false);
  assert.equal(P.getPricing().tabbySurchargePct, 15);
  assert.equal(P.applyPricingConfig(''), true);
  assert.equal(P.getPricing().tabbySurchargePct, 0);
  checks++;

  console.log(`Delivery pricing checks passed (${checks}).`);
})().catch(err => { console.error(err); process.exit(1); });
