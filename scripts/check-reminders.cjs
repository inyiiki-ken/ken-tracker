// Run: node scripts/check-reminders.cjs
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
const { computeOverdue, isSnoozed, parseSnooze, snoozeValue } = require('../lib/reminders.ts');
const { businessDay } = require('../lib/calculations.ts');

const today = businessDay(new Date().toISOString());
const day = (n) => businessDay(new Date(Date.now() + n * 86_400_000).toISOString());
// Dispatched 5 days ago: past the built-in 2-day courier follow-up.
const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
const item = (id, extra = {}) => ({ id, minerName: 'Customer', status: 'Dispatched', dateOfLive: old.slice(0, 10),
  dispatchDate: old, auditTrail: `${old} | x | Updated: status`, ...extra });
const overdueIds = (rows) => computeOverdue(rows).flatMap((s) => s.items.map((r) => r.id));

assert.deepEqual(overdueIds([item(1)]), [1]);
// Snoozed until tomorrow in the same status: hidden.
assert.deepEqual(overdueIds([item(1, { reminderSnooze: snoozeValue(day(1), 'Dispatched', 'courier says tomorrow') })]), []);
// Snooze through today still hides; it ends after that day.
assert.equal(isSnoozed(item(1, { reminderSnooze: snoozeValue(today, 'Dispatched', 'x') })), true);
assert.deepEqual(overdueIds([item(1, { reminderSnooze: snoozeValue(day(-1), 'Dispatched', 'x') })]), [1]);
// A different status since the snooze: the reminder is back.
assert.equal(isSnoozed(item(1, { status: 'For Pullout', reminderSnooze: snoozeValue(day(2), 'Dispatched', 'x') })), false);
// The note keeps its text but never breaks the stored format.
assert.deepEqual(parseSnooze(snoozeValue('2026-11-21', 'For COD', 'call | back\nlater')), { until: '2026-11-21', status: 'For COD', note: 'call back later' });
assert.equal(parseSnooze(''), null);
console.log('Reminder snooze checks passed.');
