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
import { getRatesForDate } from "./ratesStore";
import type { DatabaseRowType } from "@/types";

export interface PhotoParseResult {
  rows: ParsedMasterlistRow[];
  liverName: string;
  pageName: string;
  liveDate: string;
  globalRate: number;
  /** Codes of rows whose numbers didn't add up and should be checked. */
  flagged: string[];
  /** Per code: what the app corrected on that row ("weight 3.34 → 3.31 g"), shown on the row. */
  rowNotes: Record<string, string>;
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
  let best = "", bestH = 0, bestLine: OcrLine | null = null;
  for (const l of lines) for (const wd of l.words) {
    const t = clean(wd.text).replace(/[^A-Z]/g, "");
    if (t.length >= 3 && !LABELS.test(t) && wd.y1 - wd.y0 > bestH) { bestH = wd.y1 - wd.y0; best = t; bestLine = l; }
  }
  // Keep the other big words on the same line too ("TEAM BESHY", not just "TEAM").
  if (bestLine) {
    const words = bestLine.words
      .filter((wd) => wd.y1 - wd.y0 >= bestH * 0.7)
      .map((wd) => clean(wd.text).replace(/[^A-Z]/g, ""))
      .filter((t) => t.length >= 2 && !LABELS.test(t));
    if (words.includes(best)) return words.join(" ");
  }
  return best;
}

// ── 2. OCR ───────────────────────────────────────────────────────────────────

// The whole-page read uses tesseract.js's own default, one uniform block
// ("6"). It reads these spreadsheet screenshots row by row; the automatic page
// layout ("3") splits the header into separate pieces and the header row is
// then never found (2026-10-08 AMBIE: every photo after the first failed,
// because the closer row reads used to leave the reader on "3").
const PAGE_MODE = "6";

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

async function ocrLines(canvas: HTMLCanvasElement, mode?: string): Promise<{ lines: OcrLine[]; text: string }> {
  const worker = await getWorker();
  if (mode) await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: mode });
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

/**
 * Reads one region of the cleaned image again, enlarged, for a second, closer
 * look (header figures, or a row whose numbers didn't add up). `digits` limits
 * the reading to numbers, which stops 3 / 1 / 7 being read as letters.
 */
async function ocrRegion(src: HTMLCanvasElement, box: { x0: number; y0: number; x1: number; y1: number }, digits: boolean, scale = 2): Promise<OcrLine[]> {
  const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
  const w = Math.min(src.width, Math.ceil(box.x1)) - x0, h = Math.min(src.height, Math.ceil(box.y1)) - y0;
  if (w < 8 || h < 8) return [];
  const pad = 20;
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale) + pad * 2; c.height = Math.round(h * scale) + pad * 2;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, x0, y0, w, h, pad, pad, w * scale, h * scale);
  const worker = await getWorker();
  if (digits) await worker.setParameters({ tessedit_char_whitelist: "0123456789.,- ", tessedit_pageseg_mode: "6" });
  try {
    const { lines } = await ocrLines(c);
    return lines.map((l) => ({ ...l, words: l.words.map((wd) => ({ ...wd, x0: x0 + (wd.x0 - pad) / scale, x1: x0 + (wd.x1 - pad) / scale, y0: y0 + (wd.y0 - pad) / scale, y1: y0 + (wd.y1 - pad) / scale })) }));
  } finally {
    if (digits) await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: PAGE_MODE });
  }
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

let greyCache: { src: ImageData; canvas: HTMLCanvasElement } | null = null;
/** The photo in plain grey, same size as the cleaned image. */
function greyOf(orig: ImageData): HTMLCanvasElement {
  if (greyCache?.src === orig) return greyCache.canvas;
  const c = document.createElement("canvas");
  c.width = orig.width; c.height = orig.height;
  const out = new ImageData(orig.width, orig.height);
  for (let p = 0; p < orig.data.length; p += 4) {
    // Darkest channel: black text stays black on white, green, yellow or red.
    const v = Math.min(orig.data[p], orig.data[p + 1], orig.data[p + 2]);
    out.data[p] = out.data[p + 1] = out.data[p + 2] = v;
    out.data[p + 3] = 255;
  }
  c.getContext("2d")!.putImageData(out, 0, 0);
  greyCache = { src: orig, canvas: c };
  return c;
}

interface HeaderFigures {
  rate: number; totalGrams: number; balance: number;
  /** Every figure after RATE / TOTAL GRAMS: 18K first, then e.g. the 21KT / GOLD BAR column. */
  rates?: number[]; totals?: number[];
}

/** TOTAL GRAMS / BALANCE / RATE from the header block (first number after each label). */
function readHeaderFigures(lines: OcrLine[]): HeaderFigures {
  const out: HeaderFigures = { rate: 0, totalGrams: 0, balance: 0 };
  const after = (l: OcrLine, i: number) => {
    const w = l.words.slice(i + 1).find((x) => isNumeric(x.text));
    return w ? readNumber(w.text) : 0;
  };
  const allAfter = (l: OcrLine, i: number) => l.words.slice(i + 1).filter((x) => isNumeric(x.text)).map((x) => readNumber(x.text)).filter((v) => v > 0);
  for (const l of lines) {
    const t = l.words.map((w) => clean(w.text));
    const gi = t.findIndex((x) => /^(TOTAL)?GRAMS?$/.test(x));
    if (gi >= 0 && !out.totalGrams) { out.totalGrams = after(l, gi); out.totals = allAfter(l, gi); }
    const bi = t.findIndex((x) => /ALANCE$|^BALAN/.test(x));
    if (bi >= 0 && !out.balance) out.balance = after(l, bi);
    const ri = t.findIndex((x) => /^RATE:?$/.test(x));
    if (ri >= 0 && !out.rate) {
      let v = after(l, ri);
      if (v > 0 && v < 10 && v * 100 >= 15) v = Math.round(v * 100);
      out.rate = v;
      out.rates = allAfter(l, ri).map((x) => (x < 10 && x * 100 >= 15 ? Math.round(x * 100) : x));
    }
  }
  return out;
}

/** Levenshtein distance, for spotting a misread customer name. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/**
 * The outsource's earlier orders (matched by liver name, or by the code
 * prefix, e.g. BELLA01): the gold rate used most recently, the MCs they use
 * and the customer names already on file.
 */
function pastFor(history: DatabaseRowType[], title: string, codes: string[]) {
  const prefix = (codes[0] || "").replace(/\d+$/, "");
  const key = (title || prefix).toUpperCase();
  const mine = key
    ? history.filter((r) => String(r.liverName ?? "").toUpperCase().trim() === key || (prefix.length >= 3 && String(r.orderId ?? "").toUpperCase().startsWith(prefix)))
    : [];
  const dated = mine
    .map((r) => ({ r, t: Date.parse(String(r.dateOfLive ?? "")) }))
    .filter((x) => Number.isFinite(x.t) && Number(x.r.goldRate) > 0)
    .sort((a, b) => b.t - a.t);
  const mcs = new Set<number>();
  mine.forEach((r) => { const v = parseFloat(String(r.mc ?? "")); if (v > 0) mcs.add(v); });
  const names = new Set<string>();
  mine.forEach((r) => { const n = String(r.minerName ?? "").toUpperCase().replace(/\s+/g, " ").trim(); if (n) names.add(n); });
  return { liver: key, rate: dated.length ? Number(dated[0].r.goldRate) : 0, mcs, names };
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

/**
 * `history` is the customer's existing records; the photo is checked against
 * the same outsource's earlier orders (usual gold rate, MC, customer names).
 */
export async function parseMasterlistImage(file: File, mapping?: MasterlistMapping, history: DatabaseRowType[] = []): Promise<PhotoParseResult> {
  const m = mapping ?? getMasterlistMapping();
  const { canvas, colLines, orig } = await prepareImage(file);
  let { lines, text } = await ocrLines(canvas, PAGE_MODE);
  const warnings: string[] = [];

  let headerIdx = findHeader(lines);
  if (headerIdx < 0) {
    // Second try with the automatic page layout before giving up.
    ({ lines, text } = await ocrLines(canvas, "3"));
    headerIdx = findHeader(lines);
    await (await getWorker()).setParameters({ tessedit_pageseg_mode: PAGE_MODE });
  }
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

  // Columns right of GRAMS, for rows with no weight in the grams column (a
  // 24K gold bar weighed in its own GOLD BAR column, with "-" as the amount).
  const cx = (w: OcrWord) => (w.x0 + w.x1) / 2;
  const gc = gramsHead ? cx(gramsHead) : NaN;
  const rateHead = header.words.find((w) => /^RATE/.test(clean(w.text)) && (!Number.isFinite(gc) || cx(w) > gc));
  const amountHead = header.words.find((w) => /AMOUNT|TOTAL/.test(clean(w.text)));
  const amountRight = amountHead ? (colLines.find((x) => x > cx(amountHead)) ?? amountHead.x1 + (amountHead.x1 - amountHead.x0) * 0.3) : NaN;
  // Header words past AMOUNT (21KT, GOLD BAR, PULLOUT…) say which karat a side column holds.
  const sideHeads = Number.isFinite(amountRight) ? header.words.filter((w) => cx(w) > amountRight) : [];
  // Not plain "BAR": a BAR PENDANT / BAR NECKLACE is ordinary 18K jewellery.
  const GOLD_BAR = /GOLD\s*-?\s*BARS?\b/;

  /** A row with no weight under GRAMS: rate and MC as usual, weight from a side column. */
  type Side = { rate: number; mc: number; weight: number; tog: string; guessed: boolean };
  type Row = { code: string; name: string; desc: string; nums: number[]; y0: number; y1: number; nx: number; side?: Side };
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
    // A code split in two ("BE" + "SH21") leaves its second half in front of the name.
    while (name.length > 1 && /^[A-Z]{0,5}\d{1,4}[A-Z]?$/.test(clean(name[0].text))) name = name.slice(1);
    const nameTxt = join(name), descTxt = join(desc);
    // Code with no customer and no item (BESH41 at the end) = blank row.
    if (!nameTxt && !descTxt) continue;
    const numWords = words.slice(firstNum).filter((w) => isNumeric(w.text) && Number.isFinite(readNumber(w.text)));
    const first = numWords[0];
    const noGrams = !!first && !!gramsHead && !!rateHead && Math.abs(cx(first) - cx(rateHead)) < Math.abs(cx(first) - gc);
    // No weight and no item: an empty template row with only the rate filled in.
    if (noGrams && !descTxt) continue;
    let side: Side | undefined;
    if (noGrams || GOLD_BAR.test(descTxt)) {
      const left = Number.isFinite(amountRight) ? numWords.filter((w) => cx(w) < amountRight) : numWords.slice(0, 2);
      const right = Number.isFinite(amountRight) ? numWords.filter((w) => cx(w) >= amountRight) : numWords.slice(2);
      // With grams present (a bar sheet laid out normally) the rate is the 2nd number.
      const lv = left.map((w) => readNumber(w.text));
      const [rate, mc] = noGrams ? [lv[0], lv[1]] : [lv[1], lv[2]];
      const wWord = right[0];
      // A bar weight is often a whole number ("1", "100"): no decimal point inserted.
      const weight = wWord ? (/[.,]/.test(wWord.text) ? readNumber(wWord.text) : parseFloat(wWord.text.replace(/[^0-9]/g, ""))) : (!noGrams ? lv[0] : 0);
      let head = "";
      if (wWord && sideHeads.length) head = clean(sideHeads.reduce((a, b) => (Math.abs(cx(b) - cx(wWord)) < Math.abs(cx(a) - cx(wWord)) ? b : a)).text);
      const tog = GOLD_BAR.test(descTxt) || /GOLD|BAR/.test(head) ? "24K" : (head.match(/^(\d{2})K/)?.[0] ?? "");
      const guessed = !(weight > 0);
      side = { rate: rate > 0 && rate < 10 && rate * 100 >= 15 ? Math.round(rate * 100) : rate || 0, mc: mc || 0, weight: guessed ? 1 : weight, tog, guessed };
    }
    raw.push({ code: words[0].text, name: nameTxt, desc: descTxt, nums, y0: l.y0, y1: l.y1, nx: words[firstNum]?.x0 ?? numBorder, side });
  }
  if (!raw.length) throw new Error("Found the header but no item rows. Try a clearer screenshot.");

  const codes = fixCodes(raw.map((r) => r.code));
  const flagged: number[] = [];

  // A gold/silver rate shown without decimals ("390") gets a decimal point
  // inserted by readNumber (3.90); toNums below undoes it.
  // MC takes only a few values per sheet (e.g. 25 and 30). A value seen on one
  // row only, within 2 of a common one, is a misread ("26" for 25).
  const mcCount = new Map<number, number>();
  raw.forEach((r) => !r.side && r.nums.length >= 4 && r.nums[2] > 0 && mcCount.set(r.nums[2], (mcCount.get(r.nums[2]) || 0) + 1));
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
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.6, b * 0.002);
  /** mcRaw = the MC as read, before snapping it to a common one. */
  type Nums = { grams: number; rate: number; mc: number; amount: number; mcRaw?: number };
  // Numbers in sheet order: grams, rate, MC, amount (MC may be absent).
  const toNums = (nums: number[]): Nums => {
    const n = [...nums];
    if (n[1] > 0 && n[1] < 10 && n[1] * 100 >= 15) n[1] = Math.round(n[1] * 100);
    return n.length === 3 ? { grams: n[0], rate: n[1], mc: 0, amount: n[2] } : { grams: n[0], rate: n[1], mc: snapMc(n[2] || 0), mcRaw: n[2] || 0, amount: n[3] ?? 0 };
  };
  // Side-column rows (gold bars) have their own rate: kept out of the 18K checks.
  const rows0 = raw.map((r) => (r.side ? { grams: r.side.weight, rate: r.side.rate, mc: r.side.mc, amount: 0 } : toNums(r.nums)));
  const mainOf = (rows: Nums[]) => rows.filter((_, i) => !raw[i].side);
  /**
   * How one row reads at a given gold rate: as is, with one misread digit in
   * the grams (3.34 for 3.31), or with one misread digit in the amount
   * (672.36 for 572.36). Anything else doesn't add up.
   */
  const checkMc = (r: Nums, rate: number, mc: number): { grams: number; amount: number; mc: number; exact: boolean } | null => {
    const per = rate + mc;
    if (!(per > 0 && r.amount > 0 && r.grams > 0)) return null;
    if (near(r.grams * per, r.amount)) return { grams: r.grams, amount: r.amount, mc, exact: true };
    // Amount first: grams × rate matching the amount to the cent except one
    // digit is firmer than grams worked back from the amount, which only lands
    // within rounding (BESH33 2.82 g / 1163.38 read for 1153.38 was "fixed" to 2.84 g).
    const a2 = round2(r.grams * per);
    if (oneDigitApart(r.amount, a2)) return { grams: r.grams, amount: a2, mc, exact: false };
    const g2 = round2(r.amount / per);
    if (near(g2 * per, r.amount) && oneDigitApart(r.grams, g2)) return { grams: g2, amount: r.amount, mc, exact: false };
    return null;
  };
  // The snapped MC first; the MC as read when only that adds up (a real one-off
  // MC 25 among many 28s is not a misread: 2026-10-03 BESH14).
  const check = (r: Nums, rate: number) => {
    const a = checkMc(r, rate, r.mc);
    if (a?.exact || r.mcRaw === undefined || r.mcRaw === r.mc) return a;
    const b = checkMc(r, rate, r.mcRaw);
    // Neither adds up as read: trust the MC as read over the snapped guess.
    return b?.exact ? b : b ?? a;
  };

  // ── What the rate should be, from everything the app knows ──
  // The header block (TOTAL GRAMS / BALANCE / RATE), read a second time on its
  // own and enlarged, which reads far better than the whole-page pass.
  let head: HeaderFigures = { rate: 0, totalGrams: 0, balance: 0 };
  try {
    head = readHeaderFigures(await ocrRegion(canvas, { x0: descW ? descW.x1 : canvas.width * 0.3, y0: 0, x1: canvas.width, y1: header.y0 }, false, 1.5));
  } catch { /* header pass is a bonus */ }
  if (!head.rate) head.rate = readHeaderRate(lines.slice(0, headerIdx));
  // This outsource's earlier orders: the rates, MCs and customer names it used.
  const photoDate = findDate(text.toUpperCase());
  const titleGuess = findTitle(lines, headerIdx);
  const past = pastFor(history, titleGuess, codes);
  // Today's gold rate saved in the app (Rates), if any.
  let dailyGold = 0;
  try { dailyGold = photoDate ? getRatesForDate(photoDate).goldRate || 0 : 0; } catch { /* no rates saved */ }
  const expected = [dailyGold, past.rate].filter((v) => v > 0);
  // A gold rate miles away from every rate we know (183 when gold is ~380)
  // is a misread, whatever the photo says.
  const plausible = (v: number) => !expected.length || expected.some((e) => Math.abs(v - e) <= e * 0.2);

  // The gold rate is the same on every row and is printed in the header. Any
  // of those can be misread (2026-10-01: BELLA's 383.25 read as 183.25 on one
  // row and then used for every row), so try each reading, plus the rate the
  // amounts imply (amount ÷ grams − MC), and keep the one that makes the most
  // rows add up. Header readings break ties; impossible rates lose.
  const chooseRate = (rows: Nums[]) => {
    const candidates = new Map<number, number>();
    const add = (v: number, w = 1) => { if (v > 0) candidates.set(round2(v), (candidates.get(round2(v)) || 0) + w); };
    if (head.rate) add(head.rate, 1.5);
    rows.forEach((r) => add(r.rate));
    const implied = rows.filter((r) => r.grams > 0 && r.amount > 0).map((r) => round2(r.amount / r.grams - r.mc));
    implied.forEach((v, i) => { if (implied.some((u, j) => j !== i && Math.abs(u - v) <= 0.05)) add(v, 0.5); });
    let best = 0, bestScore = -Infinity;
    for (const [v, reads] of candidates) {
      const score = rows.reduce((n, r) => n + (check(r, v) ? 1 : 0), 0) * 10 + reads - (plausible(v) ? 0 : 1000);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return best;
  };
  let rateMode = chooseRate(mainOf(rows0));

  // ── Second, closer read of any row that doesn't add up as read ──
  const rows1 = [...rows0];
  const reread: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].side || check(rows1[i], rateMode)?.exact) continue;
    const r = raw[i];
    const pad = (r.y1 - r.y0) * 0.35;
    const box = { x0: r.nx - 6, y0: r.y0 - pad, x1: canvas.width, y1: r.y1 + pad };
    const merged = { ...rows1[i] };
    let good: Nums | undefined;
    // Cleaned image first, then the original colours (a 5 can lose its top
    // stroke in the clean-up and read as 6).
    for (const src of [canvas, greyOf(orig)]) {
      let again: number[] = [];
      try {
        const ls = await ocrRegion(src, box, true, 3);
        again = ls.flatMap((l) => l.words).filter((w) => isNumeric(w.text)).map((w) => readNumber(w.text)).filter(Number.isFinite);
      } catch { continue; }
      if (again.length < 3) continue;
      const n2 = toNums(again);
      // Take each number from the second read only where it makes the row add up.
      const tries: Nums[] = [{ ...merged, grams: n2.grams }, { ...merged, amount: n2.amount }, { ...merged, grams: n2.grams, amount: n2.amount }];
      good = tries.find((t) => t.grams > 0 && check(t, rateMode)?.exact);
      if (good) break;
    }
    if (good) {
      const before = rows1[i];
      if (round2(good.grams) !== round2(before.grams)) reread.push(`${codes[i]} weight ${before.grams} → ${good.grams} g`);
      if (round2(good.amount) !== round2(before.amount)) reread.push(`${codes[i]} amount ${before.amount} → ${round2(good.amount)}`);
      rows1[i] = { ...before, grams: good.grams, amount: round2(good.amount) };
    }
  }
  if (reread.length) rateMode = chooseRate(mainOf(rows1));

  const misreadRates = rows1.map((r, i) => (!raw[i].side && r.rate > 0 && Math.abs(r.rate - rateMode) > 0.01 ? `${codes[i]} ${r.rate}` : "")).filter(Boolean);
  if (head.rate && Math.abs(head.rate - rateMode) > 0.01) misreadRates.unshift(`header ${head.rate}`);

  const fixed = rows1.map((r, i) => {
    const sd = raw[i].side;
    if (sd) {
      return { code: codes[i], name: raw[i].name, desc: raw[i].desc, grams: sd.weight, rate: sd.rate, mc: sd.mc, amount: round2(sd.weight * (sd.rate + sd.mc)), side: sd };
    }
    let { grams, amount } = r;
    const rate = rateMode || r.rate;
    let mc = r.mc;
    // Still off: correct a single misread digit (and list it); anything else
    // stays as read and is flagged. Replacing grams with amount ÷ rate
    // wholesale once priced 3.69 g as 3.93 g when the amount was misread.
    const c = check({ ...r, rate }, rate);
    if (c) {
      if (c.grams !== grams) corrected.push(`${codes[i]} weight ${grams} → ${c.grams} g`);
      if (c.amount !== amount) corrected.push(`${codes[i]} amount ${amount} → ${c.amount}`);
      grams = c.grams; amount = c.amount; mc = c.mc;
    } else if (rate + mc > 0 && amount > 0) flagged.push(i);
    return { code: codes[i], name: raw[i].name, desc: raw[i].desc, grams, rate, mc, amount, side: undefined as Side | undefined };
  });

  // ── Header TOTAL GRAMS: the rows must add up to it ──
  const headTotal = head.totalGrams || head.balance;
  // TOTAL GRAMS is the 18K column; gold bars are totalled in their own column.
  const sumGrams = () => round2(fixed.reduce((s, r) => s + (r.side ? 0 : r.grams || 0), 0));
  if (headTotal > 0 && Math.abs(sumGrams() - headTotal) > 0.011 && flagged.length === 1) {
    // One row is still off: the header total says what its weight must be.
    const i = flagged[0], r = fixed[i];
    const g = round2(headTotal - (sumGrams() - r.grams));
    // The MC may be misread too (25 read as 28): the weight and amount then say what it is.
    const mcBack = g > 0 ? r.amount / g - r.rate : 0;
    const mcFix = Math.abs(mcBack - Math.round(mcBack)) <= 0.02 && Math.round(mcBack) > 0 && Math.round(mcBack) < 100 ? Math.round(mcBack) : 0;
    if (g > 0 && near(g * (r.rate + r.mc), r.amount)) {
      corrected.push(`${r.code} weight ${r.grams} → ${g} g (from TOTAL GRAMS ${headTotal})`);
      r.grams = g;
      flagged.splice(0, 1);
    } else if (mcFix && mcFix !== r.mc && near(g * (r.rate + mcFix), r.amount)) {
      corrected.push(`${r.code} weight ${r.grams} → ${g} g and MC ${r.mc} → ${mcFix} (from TOTAL GRAMS ${headTotal})`);
      r.grams = g;
      r.mc = mcFix;
      flagged.splice(0, 1);
    }
  }
  const totalNote = headTotal > 0 && Math.abs(sumGrams() - headTotal) > 0.011
    ? `The rows add up to ${sumGrams()} g but the header says ${headTotal} g. A weight is misread or a row is missing.`
    : "";

  // ── Format: realistic weights ──
  const oddWeights = fixed.filter((r) => !(r.grams >= 0.1 && r.grams <= 200)).map((r) => `${r.code} ${r.grams} g`);

  // ── Codes: no repeats ──
  const seen = new Map<string, number>();
  codes.forEach((c) => seen.set(c, (seen.get(c) || 0) + 1));
  const dupCodes = [...seen.entries()].filter(([, n]) => n > 1).map(([c]) => c);

  // ── MC this outsource doesn't normally use ──
  const oddMc = past.mcs.size >= 1
    ? [...new Set(fixed.filter((r) => !r.side && r.mc > 0 && !past.mcs.has(r.mc)).map((r) => r.mc))]
    : [];

  // ── Customer names close to (but not the same as) earlier orders ──
  const nameHints: string[] = [];
  for (const r of fixed) {
    if (!r.name || past.names.has(r.name)) continue;
    const match = [...past.names].find((n) => Math.abs(n.length - r.name.length) <= 2 && editDistance(n, r.name) <= 2);
    if (match) nameHints.push(`${r.code} "${r.name}" looks like "${match}" from earlier orders`);
  }

  // ── Gold bar / side-column rows ──
  const sideRows = fixed.filter((r) => r.side);
  const sideNotes: string[] = [];
  if (sideRows.length) {
    sideNotes.push(`${sideRows.map((r) => r.code).join(", ")}: ${sideRows.some((r) => r.side!.tog === "24K") ? "gold bar" : "side column"} item${sideRows.length === 1 ? "" : "s"}, priced at ${[...new Set(sideRows.map((r) => r.rate))].join(" / ")} + MC × weight (not the ${rateMode} rate).`);
    const guessed = sideRows.filter((r) => r.side!.guessed).map((r) => r.code);
    if (guessed.length) sideNotes.push(`Couldn't read the weight of ${guessed.join(", ")}, so 1 g was used. Check against the photo.`);
    const otherRates = (head.rates ?? []).slice(1);
    const offRate = sideRows.filter((r) => otherRates.length && !otherRates.some((v) => Math.abs(v - r.rate) <= 0.01)).map((r) => `${r.code} ${r.rate}`);
    if (offRate.length) sideNotes.push(`Gold bar rate doesn't match the header (${otherRates.join(" / ")}): ${offRate.join("; ")}. Check against the photo.`);
    const barTotal = (head.totals ?? []).length > 1 ? head.totals![head.totals!.length - 1] : 0;
    const barSum = round2(sideRows.reduce((sum, r) => sum + r.grams, 0));
    if (barTotal > 0 && Math.abs(barTotal - barSum) > 0.011) sideNotes.push(`The gold bar weights add up to ${barSum} g but the header says ${barTotal} g. Check against the photo.`);
  }

  const rateNotes: string[] = [];
  if (misreadRates.length) rateNotes.push(`Gold rate ${rateMode} used for every row (the photo reader read ${misreadRates.join(", ")}, which doesn't match the amounts). Check against the photo.`);
  if (rateMode && dailyGold && Math.abs(dailyGold - rateMode) > 0.01 && !fixed.some((r) => Math.abs(r.rate + r.mc - dailyGold) <= 0.01)) {
    rateNotes.push(`The photo's gold rate ${rateMode} is different from the gold rate saved in Rates for that day (${dailyGold}).`);
  }
  if (rateMode && !plausible(rateMode)) rateNotes.push(`Gold rate ${rateMode} is far from the usual rate (${expected.join(" / ")}). Check against the photo.`);

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
  warnings.push(...rateNotes);
  warnings.push(...sideNotes);
  if (reread.length) warnings.push(`Read again more closely: ${reread.join("; ")}. Check against the photo.`);
  if (corrected.length) warnings.push(`Fixed one misread digit so the row adds up: ${corrected.join("; ")}. Check against the photo.`);
  if (totalNote) warnings.push(totalNote);
  if (dupCodes.length) warnings.push(`${dupCodes.join(", ")} appears more than once. Check the codes against the photo.`);
  if (oddWeights.length) warnings.push(`Weight looks wrong: ${oddWeights.join("; ")}.`);
  if (oddMc.length) warnings.push(`MC ${oddMc.join(", ")} is not what ${past.liver} usually has (${[...past.mcs].join(", ")}). Check against the photo.`);
  if (nameHints.length) warnings.push(`Possible misspelling: ${nameHints.join("; ")}.`);
  if (flagged.length) {
    const detail = flagged.map((i) => {
      const r = fixed[i];
      const g2 = Math.round((r.amount / (r.rate + r.mc)) * 100) / 100;
      return `${r.code} ${r.grams} g (amount reads ${r.amount}, which would be ${g2} g)`;
    });
    warnings.push(`${flagged.length} row(s) don't add up (grams × (rate + MC) ≠ amount), check the weight against the photo: ${detail.join("; ")}.`);
  }

  const rowNotes: Record<string, string> = {};
  for (const n of [...reread, ...corrected]) {
    const [code, ...rest] = n.split(" ");
    rowNotes[code] = rowNotes[code] ? `${rowNotes[code]}; ${rest.join(" ")}` : `Corrected: ${rest.join(" ")}`;
  }
  const liver = parsed.liverName !== "Unknown" ? parsed.liverName : title;
  const togOf = new Map(sideRows.filter((r) => r.side!.tog).map((r) => [r.code, r.side!.tog]));
  const rows = parsed.rows.map((r) => ({
    ...r,
    liverName: r.liverName === "Unknown" ? liver : r.liverName,
    ...(togOf.has(r.orderId) ? { tog: togOf.get(r.orderId)! } : {}),
  }));
  return {
    rows,
    liverName: liver || "Unknown",
    pageName: parsed.pageName || title,
    liveDate: parsed.liveDate || liveDate,
    globalRate: parsed.globalRate || rateMode,
    flagged: flagged.map((i) => fixed[i]?.code).filter(Boolean),
    rowNotes,
    warnings,
  };
}

export const isImageFile = (f: File) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp)$/i.test(f.name);
