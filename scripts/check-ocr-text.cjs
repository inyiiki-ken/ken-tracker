// Text clean-up rules of the masterlist photo reader (no image needed).
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), ts = require('typescript'), Module = require('module');
const root = path.resolve(__dirname, '..');
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === './tenancy' || name === '@/lib/tenancy') return { getMyContext: async () => ({ activeTenant: { tenantId: 'crown-ab12' } }) };
  return load.call(this, name, ...args);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...a) { return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...a); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true });
const { fixSizes, findDate } = require('../lib/masterlistOcr.ts');

// S read as 5 in front of a chain length or ring size.
assert.equal(fixSizes('CHAIN 518'), 'CHAIN S18');
assert.equal(fixSizes('JADE CHAIN 520'), 'JADE CHAIN S20');
assert.equal(fixSizes('RING 57.5'), 'RING S7.5');
assert.equal(fixSizes('RING 59'), 'RING S9');
// Left alone: leading counts, other numbers, already-correct sizes.
assert.equal(fixSizes('5X PAPERCLIP CHAIN'), '5X PAPERCLIP CHAIN');
assert.equal(fixSizes('2 TONE BARREL PENDANT'), '2 TONE BARREL PENDANT');
assert.equal(fixSizes('CHAIN S18'), 'CHAIN S18');
assert.equal(fixSizes('BANGLE 550'), 'BANGLE 550');

// Dates: both orders, and the weekday corrects a misread year.
assert.equal(findDate('THURSDAY, OCTOBER 8, 2025'), 'October 8, 2026');
assert.equal(findDate('SATURDAY, NOVEMBER 14, 2026'), 'November 14, 2026');
assert.equal(findDate('THURSDAY, 8 OCTOBER 2026'), 'October 8, 2026');
assert.equal(findDate('OCTOBER 8, 2025'), 'October 8, 2025');
assert.equal(findDate('NO DATE HERE'), '');
console.log('OCR text clean-up checks passed (sizes, dates).');
