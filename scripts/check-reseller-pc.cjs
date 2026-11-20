// Run: node scripts/check-reseller-pc.cjs — Per PC items on the reseller invoice.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), Module = require('node:module');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...a) { return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...a); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
const R = require('../lib/resellers.ts');
const rates = { '18K': 352, SP: 357, EF: 382 };

// Rowena: screw type earrings added by hand under Gold Normal at 195 → Per PC, 195, not 1 g × 352.
const rowena = R.itemFromRecord({ id: 9, minerName: 'ROWENA GALLANO', itemDescription: 'SCREW TYPE EARRINGS', category: 'Gold Normal', grams: 1, clientRate: 195 });
assert.equal(rowena.karat, 'PC');
assert.equal(R.itemAmount(rowena, rates), 195);
assert.equal(R.itemCategory(rowena), 'Per PC');
assert.equal(R.itemRate(rowena, rates), 195);
assert.equal(R.buildDescription(rowena), '18K GOLD SCREW TYPE EARRINGS - ROWENA GALLANO');
// Gram items are unchanged.
const sp = R.newItem({ item: 'CC PENDANT', customer: 'ROSE GRIGGS', grams: '2.06', karat: 'SP' });
assert.equal(R.itemAmount(sp, rates), 735.42);
assert.equal(R.itemRate(sp, rates), 357);
assert.equal(R.itemCategory(sp), 'Special Price');
// Per PC with a typed price; weight doesn't change it.
assert.equal(R.itemAmount(R.newItem({ karat: 'PC', grams: '3.2', price: '250' }), rates), 250);
assert.equal(R.itemAmount(R.newItem({ karat: 'PC', grams: '1' }), rates), 0);
assert.equal(R.karatOf('Per PC'), 'PC');
assert.equal(R.karatOf('Special Price EF'), 'EF');
console.log('Reseller Per PC checks passed.');
