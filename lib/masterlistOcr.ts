"use client";

/**
 * MASTERLIST FROM A PHOTO / SCREENSHOT.
 *
 * Livers often send the masterlist as a screenshot instead of the Excel file.
 * This reads the picture with on-device OCR (tesseract.js, bundled in
 * /public/ocr — no internet service, nothing leaves the PC), rebuilds the rows,
 * and then runs them through the SAME per-customer import rules as an Excel
 * upload (rate + MC, round-up, MC -> category, default T.O.G, …) by placing
 * the values into a grid laid out like that customer's saved masterlist setup.
 *
 * Every row is cross-checked with the sheet's own maths
 * (grams × (rate + MC) ≈ amount). Rows that don't add up are flagged so they
 * can be corrected in the preview before importing.
 */

import { getMasterlistMapping, colToIndex, cellToRC, type MasterlistMapping } from "./masterlistMapping";
import { parseMasterlistGrid, type ParsedMasterlistRow } from "./masterlistImport";

export interface PhotoParseResult {
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  liveDate: string;
  globalRate: number;
  /** Codes of rows whose numbers didn't add up and should be checked. */
  flagged: string[];
  warnings: string[];
}

interface OcrWord { text: string; x0: number; x1: number; y0: number; y1: number; }
interface OcrLine { words: OcrWord[]; y0: number; y1: number; }

// ── 1. Image clean-up ────────────────────────────────────────────────────────
// Screenshots mix black text on white, black on green and WHITE text on red.
// Build a black-on-white image, and remove the table grid lines (they merge
// with digits) while remembering where the vertical lines were — those are the
// exact column borders.

async function prepareImage(file: File): Promise<{ canvas: HTMLCanvasElement; colLines: number[]; orig: ImageData }> {
  const bmp = await createImageBitmap(file);
  const S = Math.max(1, Math.min(3, 3600 / Math.max(bmp.width, 1)));
  const W = Math.round(bmp.width * S);
  const H = Math.round(bmp.height * S);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const orig = ctx.getImageData(0, 0, W, H); // untouched colours, for the title pass
  const d = img.data;

  const lum = new Float32Array(W * H);
  const red = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    red[i] = r > 120 && g < 90 && b < 90 ? 1 : 0;
  }
  // Red density around each pixel (integral image), to find white text on red.
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += red[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const k = Math.round(5 * S);
  const density = (x: number, y: number) => {
    const x0 = Math.max(0, x - k), x1 = Math.min(W, x + k + 1);
    const y0 = Math.max(0, y - k), y1 = Math.min(H, y + k + 1);
    const s = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
    return s / ((x1 - x0) * (y1 - y0));
  };

  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!red[i] && lum[i] < 110) ink[i] = 1;
      else if (lum[i] > 170 && density(x, y) > 0.35) ink[i] = 1;
    }
  }

  // Grid lines: long horizontal / vertical runs of ink.
  const kill = new Uint8Array(W * H);
  const hMin = Math.round(40 * S);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!ink[y * W + x]) { x++; continue; }
      let e = x;
      while (e < W && ink[y * W + e]) e++;
      if (e - x >= hMin) for (let t = x; t < e; t++) kill[y * W + t] = 1;
      x = e;
    }
  }
  const vMin = Math.round(16 * S);
  const vCount = new Uint32Array(W);
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!ink[y * W + x]) { y++; continue; }
      let e = y;
      while (e < H && ink[e * W + x]) e++;
      if (e - y >= vMin) {
        for (let t = y; t < e; t++) kill[t * W + x] = 1;
        vCount[x] += e - y;
      }
      y = e;
    }
  }
  // Column borders = x positions with lots of vertical line pixels (clustered).
  const colLines: number[] = [];
  const minCount = H * 0.25;
  for (let x = 0; x < W; x++) {
    if (vCount[x] < minCount) continue;
    let e = x;
    while (e + 1 < W && vCount[e + 1] >= minCount) e++;
    colLines.push((x + e) / 2);
    x = e;
  }

  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const v = ink[i] && !kill[i] ? 0 : 255;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, colLines, orig };
}

/**
 * Second pass just for the big title (the liver, e.g. "AMBIE"): white letters
 * on a solid red block are too thick for the main clean-up, so crop that block
 * and keep only the white pixels.
 */
async function readTitle(orig: ImageData, box: { x0: number; y0: number; x1: number; y1: number }): Promise<string> {
  const w = Math.max(1, Math.round(box.x1 - box.x0)), h = Math.max(1, Math.round(box.y1 - box.y0));
  if (w < 20 || h < 20) return "";
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + Math.round(box.y0)) * orig.width + (x + Math.round(box.x0))) * 4;
      const o = (y * w + x) * 4;
      const mn = Math.min(orig.data[si], orig.data[si + 1], orig.data[si + 2]);
      const v = mn > 200 ? 0 : 255;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const { lines } = await ocrLines(canvas);
  let best = "", bestH = 0;
  for (const l of lines) for (const wd of l.words) {
    const t = clean(wd.text).replace(/[^A-Z]/g, "");
    if (t.length >= 3 && !LABELS.test(t) && wd.y1 - wd.y0 > bestH) { bestH = wd.y1 - wd.y0; best = t; }
  }
  return best;
}

// ── 2. OCR ───────────────────────────────────────────────────────────────────

let workerPromise: Promise<any> | null = null;
async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/",
        langPath: "/ocr",
        gzip: true,
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

async function ocrLines(canvas: HTMLCanvasElement): Promise<{ lines: OcrLine[]; text: string }> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines: OcrLine[] = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const words: OcrWord[] = (l.words || [])
          .map((w: any) => ({ text: String(w.text || "").trim(), x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 }))
          .filter((w: OcrWord) => w.text);
        if (words.length) lines.push({ words, y0: l.bbox.y0, y1: l.bbox.y1 });
      }
    }
  }
  lines.sort((a, b) => a.y0 - b.y0);
  return { lines, text: String(data.text || "") };
}

// ── 3. Reading the table ─────────────────────────────────────────────────────

const clean = (t: string) => t.toUpperCase().replace(/[^A-Z0-9./,:-]/g, "");
const isNumeric = (t: string) => /^[~'"(|]*[0-9OoSl.,]*[0-9][0-9OoSl.,]*[)|'".,]*$/.test(t) && /\d/.test(t);

/** "400.50" -> 400.5, "40050" -> 400.5 (dot lost), "1905.18" -> 1905.18. */
function readNumber(t: string): number {
  let s = t.replace(/[Oo]/g, "0").replace(/[Sl]/g, (c) => (c === "S" ? "5" : "1")).replace(/[^0-9.]/g, "");
  if (!s) return NaN;
  const dots = s.split(".");
  if (dots.length > 2) s = dots.slice(0, -1).join("") + "." + dots[dots.length - 1];
  if (!s.includes(".") && s.length >= 3) s = s.slice(0, -2) + "." + s.slice(-2); // 2-decimal sheet
  return parseFloat(s);
}

function findHeader(lines: OcrLine[]): number {
  const keys = ["CODE", "CUSTOMER", "NAME", "ITEM", "DESCRIPTION", "GRAMS", "RATE", "AMOUNT"];
  let best = -1, bestScore = 2;
  lines.forEach((l, i) => {
    const txt = clean(l.words.map((w) => w.text).join(" "));
    const score = keys.filter((k) => txt.includes(k)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

/** The "RATE 383.25" figure in the header block above the table, or 0. */
function readHeaderRate(lines: OcrLine[]): number {
  for (const l of lines) {
    const i = l.words.findIndex((w) => /^RATE:?$/.test(clean(w.text)));
    if (i < 0) continue;
    const w = l.words.slice(i + 1).find((x) => isNumeric(x.text));
    if (!w) continue;
    let v = readNumber(w.text);
    if (v > 0 && v < 10 && v * 100 >= 15) v = Math.round(v * 100);
    if (v > 0) return v;
  }
  return 0;
}

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
function findDate(text: string): string {
  const m = text.match(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2})\s*,?\s*(20\d{2})/i);
  if (!m) return "";
  const month = MONTHS.find((x) => x.startsWith(m[1].toUpperCase())) || m[1];
  return `${month.charAt(0)}${month.slice(1).toLowerCase()} ${parseInt(m[2], 10)}, ${m[3]}`;
}

const LABELS = /^(TOTAL|GRAMS?|PULL?OU?T|BALANCE|RATE|GOLD|BAR|SILVER|\d+K\w*|MASTERLIST)$/;
function findTitle(lines: OcrLine[], headerIdx: number): string {
  // The liver/title is the tallest text above the header.
  let best = "", bestH = 0;
  for (const l of lines.slice(0, Math.max(0, headerIdx))) {
    const words = l.words.filter((w) => /^[A-Z]{3,}$/.test(clean(w.text)) && !LABELS.test(clean(w.text)));
    for (const w of words) {
      const h = w.y1 - w.y0;
      if (h > bestH) { bestH = h; best = clean(w.text); }
    }
  }
  return best;
}

/** Codes are sequential (AMB01, AMB02…); OCR confuses 0/O, 5/S, 9/3. */
function fixCodes(codes: string[]): string[] {
  const parsed = codes.map((c) => {
    const u = clean(c).replace(/[^A-Z0-9]/g, "");
    const m = u.match(/^([A-Z]{2,5}?)([0-9OSIL]{1,4})[A-Z]?$/);
    if (!m) return { prefix: u.replace(/[0-9]/g, ""), num: NaN, raw: u };
    const num = parseInt(m[2].replace(/O/g, "0").replace(/S/g, "5").replace(/[IL]/g, "1"), 10);
    return { prefix: m[1], num, raw: u };
  });
  const prefixCount = new Map<string, number>();
  parsed.forEach((p) => p.prefix && prefixCount.set(p.prefix, (prefixCount.get(p.prefix) || 0) + 1));
  const prefix = [...prefixCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const width = Math.max(2, ...parsed.map((p) => (Number.isFinite(p.num) ? String(p.num).length : 0)));
  // Runs start at 01: a first code read as 00 ("BELLAOY") is 01.
  const start = Number.isFinite(parsed[0]?.num) ? Math.max(1, parsed[0].num) : 1;
  // Keep every number that reads in order, so a row the OCR missed shows up as
  // a gap (AMB13 → AMB15) instead of every later code shifting down by one.
  // Only an unreadable or out-of-order number is replaced by previous + 1.
  let prev = start - 1;
  return parsed.map((p, i) => {
    const nextNum = parsed.slice(i + 1).find((q) => Number.isFinite(q.num))?.num;
    const fits = Number.isFinite(p.num) && p.num > prev && p.num - prev <= 5 && (nextNum === undefined || p.num < nextNum || nextNum <= prev);
    const n = fits ? p.num : prev + 1;
    prev = n;
    return prefix && Number.isFinite(n) ? prefix + String(n).padStart(width, "0") : p.raw;
  });
}

/** Codes missing from a numbered run, e.g. ["AMB14"] for AMB01…AMB13, AMB15…AMB17. */
export function missingCodes(codes: string[]): string[] {
  const nums = codes.map((c) => c.match(/^([A-Z]+)(\d+)$/)).filter((m): m is RegExpMatchArray => !!m);
  if (nums.length < 2) return [];
  const prefix = nums[0][1];
  const width = nums[0][2].length;
  const have = new Set(nums.filter((m) => m[1] === prefix).map((m) => parseInt(m[2], 10)));
  const lo = Math.min(...have), hi = Math.max(...have);
  const out: string[] = [];
  for (let n = lo; n <= hi; n++) if (!have.has(n)) out.push(prefix + String(n).padStart(width, "0"));
  return out;
}

export async function parseMasterlistImage(file: File, mapping?: MasterlistMapping): Promise<PhotoParseResult> {
  const m = mapping ?? getMasterlistMapping();
  const { canvas, colLines, orig } = await prepareImage(file);
  const { lines, text } = await ocrLines(canvas);
  const warnings: string[] = [];

  const headerIdx = findHeader(lines);
  if (headerIdx < 0) throw new Error("Couldn't find the header row (CODE / CUSTOMER NAME / …) in the picture. Try a clearer, uncropped screenshot.");
  const header = lines[headerIdx];

  // Name / description border: the grid line between the two header words, or
  // (no grid) the midpoint between them.
  const hx = (re: RegExp) => header.words.find((w) => re.test(clean(w.text)));
  const nameW = hx(/CUSTOMER|NAME|CLIENT/);
  const descW = hx(/ITEM|DESCRIPTION/);
  let nameDescBorder = NaN;
  if (nameW && descW) {
    const nc = (nameW.x0 + nameW.x1) / 2, dc = (descW.x0 + descW.x1) / 2;
    const between = colLines.filter((x) => x > nc && x < dc);
    nameDescBorder = between.length ? between[0] : (nameW.x1 + descW.x0) / 2;
  }

  // Numbers start at the WT/GRAMS column. Splitting by position (not at the
  // first number) keeps descriptions that start or end with a digit, such as
  // "2 TONE DIACUT LOOP", whole; the old split cut them off and the row was
  // then dropped for having no description.
  const gramsHead = header.words.find((w) => /GRAM|WT/.test(clean(w.text)));
  let numBorder = NaN;
  if (gramsHead) {
    const gc = (gramsHead.x0 + gramsHead.x1) / 2;
    const left = colLines.filter((x) => x < gc && x > (descW ? descW.x1 : 0));
    numBorder = left.length ? left[left.length - 1] : gramsHead.x0 - (gramsHead.x1 - gramsHead.x0) * 0.5;
  }

  type Row = { code: string; name: string; desc: string; nums: number[] };
  const raw: Row[] = [];
  for (const l of lines.slice(headerIdx + 1)) {
    const words = l.words.filter((w) => !/^[|~_\-—'"()]+$/.test(w.text));
    if (words.length < 3) continue;
    let firstNum = Number.isFinite(numBorder)
      ? words.findIndex((w, i) => i > 0 && (w.x0 + w.x1) / 2 >= numBorder)
      : -1;
    if (firstNum < 0) {
      // No grams column found: the numbers are the run of numeric words at the end.
      firstNum = words.length;
      while (firstNum > 1 && isNumeric(words[firstNum - 1].text)) firstNum--;
    }
    if (firstNum < 2) continue;
    const textWords = words.slice(1, firstNum);
    const nums = words.slice(firstNum).filter((w) => isNumeric(w.text)).map((w) => readNumber(w.text)).filter(Number.isFinite);
    if (nums.length < 2) continue;
    let name: OcrWord[] = [], desc: OcrWord[] = [];
    if (Number.isFinite(nameDescBorder)) {
      textWords.forEach((w) => ((w.x0 + w.x1) / 2 < nameDescBorder ? name : desc).push(w));
    } else {
      // No header positions: split at the widest gap.
      let gi = 0, gap = -1;
      for (let i = 1; i < textWords.length; i++) {
        const g = textWords[i].x0 - textWords[i - 1].x1;
        if (g > gap) { gap = g; gi = i; }
      }
      name = textWords.slice(0, gi); desc = textWords.slice(gi);
    }
    const join = (ws: OcrWord[]) => ws.map((w) => w.text.replace(/[^A-Za-z0-9&'.\-/ ]/g, "")).join(" ").replace(/\s+/g, " ").trim().toUpperCase();
    raw.push({ code: words[0].text, name: join(name), desc: join(desc), nums });
  }
  if (!raw.length) throw new Error("Found the header but no item rows. Try a clearer screenshot.");

  const codes = fixCodes(raw.map((r) => r.code));
  const flagged: number[] = [];

  // A gold/silver rate shown without decimals ("390") gets a decimal point
  // inserted by readNumber (3.90). No rate is that small — undo it.
  for (const r of raw) {
    if (r.nums[1] > 0 && r.nums[1] < 10 && r.nums[1] * 100 >= 15) r.nums[1] = Math.round(r.nums[1] * 100);
  }
  // MC takes only a few values per sheet (e.g. 25 and 30). A value seen on one
  // row only, within 2 of a common one, is a misread ("26" for 25).
  const mcCount = new Map<number, number>();
  raw.forEach((r) => r.nums.length >= 4 && r.nums[2] > 0 && mcCount.set(r.nums[2], (mcCount.get(r.nums[2]) || 0) + 1));
  const commonMcs = [...mcCount.entries()].filter(([, c]) => c >= 2).map(([v]) => v);
  const snapMc = (mc: number) => {
    if (!mc || (mcCount.get(mc) || 0) >= 2 || !commonMcs.length) return mc;
    const near = commonMcs.reduce((a, b) => (Math.abs(b - mc) < Math.abs(a - mc) ? b : a));
    return Math.abs(near - mc) <= 2 ? near : mc;
  };
  const corrected: string[] = [];
  const oneDigitApart = (a: number, b: number) => {
    const x = a.toFixed(2), y = b.toFixed(2);
    return x.length === y.length && [...x].filter((c, k) => c !== y[k]).length === 1;
  };
  // Numbers in sheet order: grams, rate, MC, amount (MC may be absent).
  const rows0 = raw.map((r) => {
    const [grams, rate, mc, amount] = r.nums;
    return r.nums.length === 3 ? { grams, rate, mc: 0, amount: r.nums[2] } : { grams, rate, mc: snapMc(mc || 0), amount: amount ?? 0 };
  });
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.6, b * 0.002);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  /**
   * How one row reads at a given gold rate: as is, with one misread digit in
   * the grams (3.34 for 3.31), or with one misread digit in the amount
   * (672.36 for 572.36). Anything else doesn't add up.
   */
  const check = (r: (typeof rows0)[number], rate: number) => {
    const per = rate + r.mc;
    if (!(per > 0 && r.amount > 0 && r.grams > 0)) return null;
    if (near(r.grams * per, r.amount)) return { grams: r.grams, amount: r.amount };
    const g2 = round2(r.amount / per);
    if (near(g2 * per, r.amount) && oneDigitApart(r.grams, g2)) return { grams: g2, amount: r.amount };
    const a2 = round2(r.grams * per);
    if (oneDigitApart(r.amount, a2)) return { grams: r.grams, amount: a2 };
    return null;
  };
  // The gold rate is the same on every row and is also printed in the header
  // ("RATE 383.25"). Any of those can be misread (2026-10-01: BELLA's 383.25
  // read as 183.25 on one row, and that wrong value was used for every row), so
  // try each reading, plus the rate the amounts imply (amount ÷ grams − MC), and
  // keep the one that makes the most rows add up.
  const headerRate = readHeaderRate(lines.slice(0, headerIdx));
  const candidates = new Map<number, number>(); // rate → how strongly it was read
  const addCand = (v: number, w = 1) => { if (v > 0) candidates.set(round2(v), (candidates.get(round2(v)) || 0) + w); };
  if (headerRate) addCand(headerRate, 1.5);
  rows0.forEach((r) => addCand(r.rate));
  const implied = rows0.filter((r) => r.grams > 0 && r.amount > 0).map((r) => round2(r.amount / r.grams - r.mc));
  implied.forEach((v, i) => { if (implied.some((u, j) => j !== i && Math.abs(u - v) <= 0.05)) addCand(v, 0.5); });
  let rateMode = 0, bestScore = -1;
  for (const [v, reads] of candidates) {
    const score = rows0.reduce((n, r) => n + (check(r, v) ? 1 : 0), 0) * 10 + reads;
    if (score > bestScore) { bestScore = score; rateMode = v; }
  }
  const misreadRates = rows0.map((r, i) => (r.rate > 0 && Math.abs(r.rate - rateMode) > 0.01 ? `${codes[i]} ${r.rate}` : "")).filter(Boolean);
  if (headerRate && Math.abs(headerRate - rateMode) > 0.01) misreadRates.unshift(`header ${headerRate}`);
  const rateNote = misreadRates.length
    ? `Gold rate ${rateMode} used for every row (the photo reader read ${misreadRates.join(", ")}, which doesn't match the amounts). Check against the photo.`
    : "";

  const fixed = rows0.map((r, i) => {
    let { grams, amount } = r;
    const rate = rateMode || r.rate;
    const mc = r.mc;
    // Grams and amount disagree: one of them was misread, and either can be.
    // Only a single misread digit is corrected (and listed); anything else is
    // kept as read and flagged. Replacing grams with amount ÷ rate wholesale
    // silently priced 3.69 g as 3.93 g when the amount was misread.
    const c = check({ ...r, rate }, rate);
    if (c) {
      if (c.grams !== grams) corrected.push(`${codes[i]} weight ${grams} → ${c.grams} g`);
      if (c.amount !== amount) corrected.push(`${codes[i]} amount ${amount} → ${c.amount}`);
      grams = c.grams; amount = c.amount;
    } else if (rate + mc > 0 && amount > 0) flagged.push(i);
    return { code: codes[i], name: raw[i].name, desc: raw[i].desc, grams, rate, mc, amount };
  });

  const liveDate = findDate(text.toUpperCase());
  if (!liveDate) warnings.push("Couldn't read the date — set it below.");
  // Title block = top-left, above the date line, left of the grams column.
  const dateLine = lines.slice(0, headerIdx).find((l) => findDate(l.words.map((w) => w.text).join(" ").toUpperCase()));
  const gramsW = header.words.find((w) => /GRAM|WT/.test(clean(w.text)));
  let title = "";
  try {
    title = await readTitle(orig, {
      x0: 0,
      y0: 0,
      x1: gramsW ? gramsW.x0 : orig.width / 2,
      y1: dateLine ? dateLine.y0 : header.y0,
    });
  } catch { /* fall back below */ }
  if (!title) title = findTitle(lines, headerIdx);

  // Lay the values out exactly like this customer's saved masterlist setup and
  // reuse the normal importer so every customer rule applies the same way.
  const start = Math.max(1, m.dataStartRow) - 1;
  const grid: string[][] = [];
  const put = (r: number, c: number, v: string) => {
    if (r < 0 || c < 0) return;
    while (grid.length <= r) grid.push([]);
    const row = grid[r];
    while (row.length <= c) row.push("");
    row[c] = v;
  };
  const putCell = (ref: string, v: string) => { const rc = cellToRC(ref); if (rc) put(rc.row, rc.col, v); };
  if (m.liveDateCell) putCell(m.liveDateCell, liveDate);
  if (m.pageCell && title) putCell(m.pageCell, title);
  if (m.liverCell && title) putCell(m.liverCell, title);
  if (m.rateCell && rateMode) putCell(m.rateCell, String(rateMode));
  const col = (k: keyof MasterlistMapping["columns"]) => colToIndex(m.columns[k]);
  fixed.forEach((r, i) => {
    const y = start + i;
    put(y, col("orderId"), r.code);
    put(y, col("minerName"), r.name);
    put(y, col("itemDescription"), r.desc);
    put(y, col("grams"), String(r.grams));
    put(y, col("clientRate"), String(r.rate));
    if (col("goldRate") >= 0) put(y, col("goldRate"), String(r.rate));
    if (col("mc") >= 0) put(y, col("mc"), String(r.mc));
    put(y, col("amount"), String(r.amount));
  });

  const parsed = parseMasterlistGrid(grid, m);
  if (!title) warnings.push("Couldn't read the liver name — set it below.");
  // Never lose a row silently: say which rows were read but not imported, and
  // which codes in the numbered run never showed up.
  for (const sk of parsed.skipped) warnings.push(`Not imported: ${sk.replace(/^row \d+ \((.+?)\)/, "$1")}. Add it by hand.`);
  const gaps = missingCodes(codes);
  if (gaps.length) warnings.push(`${gaps.join(", ")} ${gaps.length === 1 ? "is" : "are"} missing from the photo reading. Add ${gaps.length === 1 ? "it" : "them"} by hand.`);
  if (rateNote) warnings.push(rateNote);
  if (corrected.length) warnings.push(`Fixed one misread digit so the row adds up: ${corrected.join("; ")}. Check against the photo.`);
  if (flagged.length) {
    const detail = flagged.map((i) => {
      const r = fixed[i];
      const g2 = Math.round((r.amount / (r.rate + r.mc)) * 100) / 100;
      return `${r.code} ${r.grams} g (amount reads ${r.amount}, which would be ${g2} g)`;
    });
    warnings.push(`${flagged.length} row(s) don't add up (grams × (rate + MC) ≠ amount), check the weight against the photo: ${detail.join("; ")}.`);
  }

  const liver = parsed.liverName !== "Unknown" ? parsed.liverName : title;
  const rows = parsed.rows.map((r) => ({ ...r, liverName: r.liverName === "Unknown" ? liver : r.liverName }));
  return {
    rows,
    liverName: liver || "Unknown",
    pageName: parsed.pageName || title,
    liveDate: parsed.liveDate || liveDate,
    globalRate: parsed.globalRate || rateMode,
    flagged: flagged.map((i) => fixed[i]?.code).filter(Boolean),
    warnings,
  };
}

export const isImageFile = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp)$/i.test(f.name);
