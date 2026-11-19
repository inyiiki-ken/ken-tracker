const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, file);
const brand = require.resolve('../components/BrandThemeLoader.tsx');
require.cache[brand] = { id: brand, filename: brand, loaded: true, exports: { useBrand: () => ({ settings: { companyName: 'Test', location: 'Test' }, pageLogos: {} }) } };
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Invoice = require('../components/InvoicePrintContent.tsx').default;
require('../lib/pricingConfig.ts').applyPricingConfig(JSON.stringify({ shippingFeeInternational: 450 }));
const rows = [1295, 426, 552, 777, 821, 945].map((amount, i) => ({
  id: i + 1, minerName: 'Test', itemDescription: 'Item', dateOfLive: '2026-10-15',
  category: 'Per Pc', grams: 0, clientRate: amount, currency: 'AED',
  modeOfPayment: 'Bank Transfer AED', locationOfMiner: 'International',
  shipmentPaymentAED: 811.5,
}));
const render = records => renderToStaticMarkup(React.createElement(Invoice, { records, currency: 'AED' })).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
let html = render(rows);
assert.match(html, /TOTAL PAID\s*- AED 4,869/);
assert.doesNotMatch(html, /4,872/);
assert.match(html, /BALANCE DUE\s*AED 397/);
html = render(rows.map((r, i) => ({ ...r, shipmentPaymentAED: i ? 0 : 4869.23 })));
assert.match(html, /TOTAL PAID\s*- AED 4,869.23/);
assert.match(html, /BALANCE DUE\s*AED 396.77/);
const { splitCode, codeKey } = require('../lib/orderCode.ts');
for (const prefix of ['AMB', '3RD', 'RO', 'BELLA']) {
  assert.equal(splitCode(`${prefix}01`).prefix, prefix);
  assert.equal(codeKey(`${prefix}-01`), codeKey(`${prefix}1`));
}
assert.equal(splitCode('123456789'), null);
console.log('Invoice payment precision and all-liver order code checks passed.');
