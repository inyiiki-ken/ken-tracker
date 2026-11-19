const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } });
let tenant = { tenantId: 'crown-ab12', displayName: 'Crown' };
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === './tenancy' || name === '@/lib/tenancy') return { getMyContext: async () => ({ activeTenant: tenant }) };
  return load.call(this, name, ...args);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { DEFAULT_MASTERLIST_MAPPING } = require('../lib/masterlistMapping.ts');
const { parseMasterlistFile, parseMasterlistGrid, importCategoryForMc } = require('../lib/masterlistImport.ts');
const { getPricing, setPricing, applyPricingConfig } = require('../lib/pricingConfig.ts');
async function run() {
  const columns = Object.fromEntries(Object.keys(DEFAULT_MASTERLIST_MAPPING.columns).map(k => [k, '']));
  Object.assign(columns, { orderId: 'A', minerName: 'B', itemDescription: 'C', mc: 'D', grams: 'E', clientRate: 'F' });
  const mapping = { ...DEFAULT_MASTERLIST_MAPPING, dataStartRow: 2, columns, priceMode: 'rate_plus_mc',
    mcCategories: { '15-25': 'Special Price', '26-30': 'Gold Normal', '55': 'Gold Normal' } };
  const check = async (values, expected, override = {}) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Code', 'Name', 'Description', 'MC', 'Grams', 'Rate', 'Category'],
      ...values.map(mc => [`ITEM${mc}`, 'BUYER', 'GOLD CHAIN SP', mc, 2, 400, 'Silver Normal']),
    ]), 'Masterlist');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const result = await parseMasterlistFile({ arrayBuffer: async () => bytes }, { ...mapping, ...override });
    assert.deepEqual(result.rows.map(r => r.category), expected);
    assert.deepEqual(result.rows.map(r => Number(r.clientRate)), values.map(mc => 400 + mc));
  };
  await check([15, 20, 25, 26, 30, 55], ['Gold Normal', 'Gold Normal', 'Gold Normal', 'Special Price', 'Special Price', 'Special Price EF']);
  await check([25], ['Gold Normal']); // No other tiers in the file.
  // Nov 14 AMBIE source: a stale header must not override row rates;
  // Janine's unusual MC 23 stays 23, and the gold bar keeps its own rate.
  const nov14 = await parseMasterlistGrid([
    [367],
    ['AMB06', 'BUYER', 'COLLAB BRACELET', 30, 0.62, 357, 239.94],
    ['AMB08', 'BUYER', 'CHAIN', 23, 1.43, 357, 543.40],
    ['AMB13', 'BUYER', 'GOLD BAR', 30, 1, 468, 0],
  ], { ...mapping, rateCell: 'A1', columns: { ...columns, amount: 'G' } });
  assert.deepEqual(nov14.rows.map(r => [r.goldRate, r.mc, r.clientRate, r.category]), [
    ['357', '30', '387', 'Special Price'],
    ['357', '23', '380', 'Gold Normal'],
    ['468', '30', '498', 'Special Price'],
  ]);
  const { reviewImportRow, importReviewKey } = require('../lib/importReview.ts');
  const janine = { ...nov14.rows[1], dateOfLive: '2026-11-14' };
  assert.deepEqual(reviewImportRow(janine).errors, []);
  assert.equal(reviewImportRow(janine).amount, 543);
  assert.equal(reviewImportRow(janine).mismatch, false);
  assert.equal(reviewImportRow({ ...janine, clientRate: '367' }).mismatch, true);
  assert.ok(reviewImportRow({ ...janine, clientRate: '0' }).errors.length);
  assert.ok(reviewImportRow({ ...janine, grams: '-1' }).errors.length);
  assert.ok(reviewImportRow({ ...janine, mc: 'invalid' }).errors.length);
  assert.equal(reviewImportRow({ ...janine, category: 'Per Pc', qty: '3', grams: '0', clientRate: '100' }).amount, 300);
  assert.notEqual(importReviewKey(janine, []), importReviewKey({ ...janine, mc: '25' }, []));
  assert.notEqual(importReviewKey(janine, []), importReviewKey(janine, ['Sheet totals mismatch']));
  const photoGrid = [[], ['ITEM1', 'BUYER', 'CHAIN SP', 25, 2, 400]];
  assert.equal((await parseMasterlistGrid(photoGrid, mapping)).rows[0].category, 'Gold Normal');
  assert.equal(importCategoryForMc(mapping, 25, true), 'Gold Normal');
  // Numeric values transcribed from the Nov 7 AMBIE photo. Keep customer
  // names out of fixtures and use the same legacy MC mapping as this upload.
  const charges = [28, 30, 25, 25, 19, 25, 25, 19, 0, 30, 25, 25, 25, 19, 19, 0];
  const batch = [[], ...charges.map((mc, i) => [
    'AMB' + String(i + 1).padStart(2, '0'), 'BUYER', 'ITEM', mc, 1, 374,
  ])];
  const ambie = await parseMasterlistGrid(batch, { ...mapping, mcCategories: {
    21: 'Gold Normal', 28: 'Special Price', 55: 'Special Price EF',
  } });
  assert.equal(ambie.rows.length, 16);
  charges.forEach((mc, i) => {
    if (mc === 0) return;
    assert.equal(ambie.rows[i].category, mc <= 25 ? 'Gold Normal' : 'Special Price');
    assert.equal(Number(ambie.rows[i].clientRate), 374 + mc);
  });
  const derivedGrid = [[], ['ITEM2', 'BUYER', 'CHAIN SP', '', 2, 400, 850]];
  const derived = await parseMasterlistGrid(derivedGrid, { ...mapping, columns: { ...columns, amount: 'G' } });
  assert.equal(derived.rows[0].category, 'Gold Normal');
  assert.equal(Number(derived.rows[0].clientRate), 425);
  await check([55], ['Special Price EF']);
  await check([25], ['Silver Normal'], { columns: { ...columns, category: 'G' } });
  tenant = { tenantId: 'other-shop', displayName: 'Other shop' };
  await check([15, 25, 26, 30, 55], ['Special Price', 'Special Price', 'Gold Normal', 'Gold Normal', 'Gold Normal']);
  tenant = { tenantId: 'crown-demo', displayName: 'Crown demo' };
  await check([25], ['Gold Normal']);
  tenant = { tenantId: 'crown-jewellery', displayName: 'Another shop' };
  await check([25], ['Special Price']);
  tenant = null;
  await check([25], ['Special Price']);
  tenant = { tenantId: 'other-shop', displayName: 'Other shop' };
  const saved = JSON.stringify({ ...getPricing(), mcCategoryRules: { '15-25': 'Custom normal', '55': 'Custom fixed' } });
  assert.equal(applyPricingConfig(saved), true);
  await check([25, 55], ['Custom normal', 'Custom fixed']);
  assert.deepEqual(getPricing().mcCategoryRules, JSON.parse(saved).mcCategoryRules);
  setPricing({ ...getPricing(), mcCategoryRules: undefined });
  await check([25], ['Special Price']);
  console.log('Masterlist category checks passed.');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
