const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const XLSX = require('xlsx');
const root = path.resolve(__dirname, '..');
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
const { parseMasterlistFile } = require('../lib/masterlistImport.ts');
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
  console.log('Masterlist category checks passed.');
}
run().catch(err => { console.error(err); process.exitCode = 1; });
