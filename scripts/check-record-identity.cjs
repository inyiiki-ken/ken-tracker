// Offline regression checks: no credentials, network, or production records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === 'server-only') return {};
  if (name === './tenant-context' || name === './config-store') return {};
  return load.call(this, name, ...args);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { writeRowsByCells } = require('../lib/google-sheets/recordStore.ts');
const { DATABASE_HEADERS } = require('../lib/google-sheets/sheet-config.ts');
function sheet(keys) {
  const cells = [['key', 'status'], ...keys.map(key => [key, 'Pending'])].map(row => row.map(value => ({ value, _isDirty: true })));
  return { headerValues: [DATABASE_HEADERS.rowKey, 'Status'], rowCount: cells.length, saves: 0,
    loadHeaderRow: async () => {}, loadCells: async () => {},
    getCell: (r, c) => cells[r][c], saveCells: async function() { this.saves++; } };
}
(async () => {
  for (const rowNumber of [2, 3, 4]) {
    const s = sheet(['DUP', 'DUP', 'OTHER']);
    await assert.rejects(writeRowsByCells(s, [{ rowNumber, rowKey: 'DUP', patch: { Status: 'Delivered' } }]), /same Row Key/);
    assert.equal(s.saves, 0);
    assert.equal(s.getCell(1, 1).value, 'Pending');
  }
  const moved = sheet(['OTHER', 'KEY']);
  assert.equal(await writeRowsByCells(moved, [{ rowNumber: 2, rowKey: 'KEY', patch: { Status: 'Delivered' } }]), 1);
  assert.equal(moved.getCell(1, 1).value, 'Pending');
  assert.equal(moved.getCell(2, 1).value, 'Delivered');
  const missing = sheet(['OTHER']);
  await assert.rejects(writeRowsByCells(missing, [{ rowNumber: 2, rowKey: 'KEY', patch: { Status: 'Delivered' } }]), /no longer exists/);
  assert.equal(missing.saves, 0);
  console.log('PASS: duplicate identities rejected at either old position; moved identity targeted; missing identity rejected.');
})().catch(error => { console.error(error); process.exitCode = 1; });
