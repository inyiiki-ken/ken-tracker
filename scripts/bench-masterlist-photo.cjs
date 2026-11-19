// Scores the photo reader against hand-checked screenshots.
// Setup: npm install --prefix .ocr-test --no-save --package-lock=false @napi-rs/canvas
// Fixtures: .ocr-test/fixtures/*.jpeg|png plus truth.txt (kept out of git: real customer names).
// Run: node scripts/bench-masterlist-photo.cjs [fixtureDir] [--verbose]
// Reads photos locally; uploads nothing and writes no business records.
const fs = require('fs'), path = require('path'), ts = require('typescript'), Module = require('module');
const root = path.resolve(__dirname, '..');
const dir = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(root, '.ocr-test/fixtures');
const verbose = process.argv.includes('--verbose');
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
// OCR_DEBUG=AMB01,BESH10 prints the raw OCR words of rows containing those texts (needs the debug hook).
if (process.env.OCR_DEBUG) {
  const keys = process.env.OCR_DEBUG.split(',');
  globalThis.__OCR_DEBUG = (lines, h, cols) => {
    const fmt = (l) => l.words.map((w) => `${w.text}@${Math.round(w.x0)}-${Math.round(w.x1)}`).join(' ');
    console.log('  COLS', cols.map(Math.round).join(' '));
    console.log('  HEAD', fmt(lines[h]));
    for (const l of lines.slice(h + 1)) if (keys.includes('ALL') || keys.some((k) => l.words.map((w) => w.text).join(' ').includes(k))) console.log('   ', fmt(l));
  };
}
const realT = require('tesseract.js');
const canvas = require('../.ocr-test/node_modules/@napi-rs/canvas');
const workers = [];
global.document = { createElement: () => canvas.createCanvas(1, 1) };
global.createImageBitmap = async (file) => canvas.loadImage(Buffer.from(await file.arrayBuffer()));
global.ImageData = canvas.ImageData;
global.navigator = { hardwareConcurrency: require('os').cpus().length };
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {}, removeItem() {} }, configurable: true });
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === './tenancy' || name === '@/lib/tenancy') return { getMyContext: async () => ({ activeTenant: { tenantId: 'crown-ab12', displayName: 'Crown' } }) };
  if (name === 'tesseract.js') return {
    createWorker: async (lang, oem, opts = {}) => {
      const w = await realT.createWorker(lang, oem, { langPath: path.join(root, 'public/ocr'), gzip: true, cacheMethod: 'none' });
      workers.push(w);
      return { setParameters: (...a) => w.setParameters(...a), recognize: (c, ...a) => w.recognize(c.toBuffer('image/png'), ...a), terminate: () => w.terminate() };
    },
  };
  return load.call(this, name, ...args);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...a) { return resolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, ...a); };
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, f);

function readTruth() {
  const sheets = [];
  for (const line of fs.readFileSync(path.join(dir, 'truth.txt'), 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.startsWith('@')) { const [file, rate, date, liver] = line.slice(1).split('|'); sheets.push({ file, rate: +rate, date, liver, rows: [] }); continue; }
    const [code, name, desc, grams, rate, mc, amount] = line.split('|');
    const s = sheets[sheets.length - 1];
    s.rows.push({ code, name, desc, grams: +grams, rate: rate ? +rate : s.rate, mc: +mc, amount: +amount });
  }
  return sheets;
}

const norm = (t) => String(t ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
const FIELDS = ['row', 'name', 'desc', 'grams', 'rate', 'mc', 'price'];

(async () => {
  const { DEFAULT_MASTERLIST_MAPPING } = require('../lib/masterlistMapping.ts');
  const m = { ...DEFAULT_MASTERLIST_MAPPING, priceMode: 'rate_plus_mc', dataStartRow: 6, rateCell: 'F4', liverCell: 'A1', columns: { ...DEFAULT_MASTERLIST_MAPPING.columns, mc: 'Q', goldRate: 'R' } };
  const { parseMasterlistImage } = require('../lib/masterlistOcr.ts');
  const total = Object.fromEntries(FIELDS.map((f) => [f, [0, 0]]));
  let headerOk = 0, headers = 0;
  const t0 = Date.now();
  const truth = readTruth();
  for (const s of truth.filter((x) => !only || x.file.startsWith(only))) {
    // Earlier orders = the other sheets' items (as the app passes the customer's records).
    // OCR_HISTORY=file.json adds real item names (a JSON array) as earlier orders.
    const realNames = process.env.OCR_HISTORY ? JSON.parse(fs.readFileSync(process.env.OCR_HISTORY, 'utf8')).map((d) => ({ itemDescription: d })) : [];
    const history = [...realNames, ...truth.filter((o) => o !== s).flatMap((o) => o.rows.filter((r) => r.desc !== '*').map((r) => ({ liverName: o.liver, itemDescription: r.desc, minerName: r.name, mc: r.mc, goldRate: o.rate, dateOfLive: o.date, orderId: r.code })))];
    const data = fs.readFileSync(path.join(dir, s.file));
    const t1 = Date.now();
    let res;
    try { res = await parseMasterlistImage({ arrayBuffer: async () => data, name: s.file, type: 'image/jpeg' }, m, history, true); }
    catch (e) { res = { rows: [], liveDate: '', liverName: '', error: e.message }; }
    const errs = [];
    headers += 2;
    const ymd = (d) => { const t = new Date(/^d{4}-d{2}-d{2}$/.test(d) ? d + "T12:00" : d); return isNaN(t) ? "" : t.toDateString(); };
    if (ymd(res.liveDate) && ymd(res.liveDate) === ymd(s.date)) headerOk++; else errs.push(`date "${res.liveDate}"`);
    if (norm(res.liverName) === norm(s.liver)) headerOk++; else errs.push(`liver "${res.liverName}"`);
    const per = Object.fromEntries(FIELDS.map((f) => [f, [0, 0]]));
    for (const t of s.rows) {
      const r = res.rows.find((x) => norm(x.orderId) === t.code);
      const score = (f, ok, got) => { per[f][1]++; if (ok) per[f][0]++; else errs.push(`${t.code} ${f}: got "${got}" want "${f === 'name' ? t.name : f === 'desc' ? t.desc : t[f === 'price' ? 'amount' : f]}"`); };
      score('row', !!r, 'missing');
      if (!r) { for (const f of FIELDS.slice(1)) { per[f][1]++; } continue; }
      if (t.name !== '*') score('name', norm(r.minerName) === norm(t.name), r.minerName);
      if (t.desc !== '*') score('desc', norm(r.itemDescription) === norm(t.desc), r.itemDescription);
      score('grams', Math.abs(Number(r.grams) - t.grams) < 0.005, r.grams);
      score('rate', Math.abs(Number(r.goldRate) - t.rate) < 0.005, r.goldRate);
      score('mc', Math.abs((Number(r.mc) || 0) - t.mc) < 0.005, r.mc);
      const price = Number(r.grams) * (Number(r.goldRate) + (Number(r.mc) || 0));
      score('price', Math.abs(price - t.amount) <= 0.02, price.toFixed(2));
    }
    const extra = res.rows.filter((x) => !s.rows.some((t) => t.code === norm(x.orderId))).map((x) => x.orderId);
    if (extra.length) errs.push(`extra rows: ${extra.join(', ')}`);
    for (const f of FIELDS) { total[f][0] += per[f][0]; total[f][1] += per[f][1]; }
    const pct = (f) => `${f} ${per[f][0]}/${per[f][1]}`;
    console.log(`${s.file.padEnd(18)} ${((Date.now() - t1) / 1000).toFixed(1)}s  ${FIELDS.map(pct).join('  ')}${res.error ? '  ERROR ' + res.error : ''}`);
    if (verbose) errs.forEach((e) => console.log('    ' + e));
  }
  const all = FIELDS.reduce((a, f) => [a[0] + total[f][0], a[1] + total[f][1]], [0, 0]);
  console.log(`\nTOTAL ${FIELDS.map((f) => `${f} ${(100 * total[f][0] / total[f][1]).toFixed(1)}%`).join('  ')}  header ${headerOk}/${headers}`);
  console.log(`Fields correct: ${all[0]}/${all[1]} (${(100 * all[0] / all[1]).toFixed(1)}%)  in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { for (const w of workers) await w.terminate().catch(() => {}); });
