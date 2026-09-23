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
  const start = Number.isFinite(parsed[0]?.num) ? parsed[0].num : 1;
  const sequential = parsed.filter((p, i) => p.num === start + i).length >= parsed.length * 0.6;
  return parsed.map((p, i) => {
    const n = sequential ? start + i : p.num;
    return prefix && Number.isFinite(n) ? prefix + String(n).padStart(width, "0") : p.raw;
  });
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

  type Row = { code: string; name: string; desc: string; nums: number[] };
  const raw: Row[] = [];
  for (const l of lines.slice(headerIdx + 1)) {
    const words = l.words.filter((w) => !/^[|~_\-—'"()]+$/.test(w.text));
    if (words.length < 3) continue;
    const firstNum = words.findIndex((w, i) => i > 0 && isNumeric(w.text));
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

  // Numbers in sheet order: grams, rate, MC, amount (MC may be absent).
  const rateMode = (() => {
    const counts = new Map<number, number>();
    raw.forEach((r) => r.nums[1] > 0 && counts.set(r.nums[1], (counts.get(r.nums[1]) || 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  })();
  const fixed = raw.map((r, i) => {
    let [grams, rate, mc, amount] = r.nums;
    if (r.nums.length === 3) { amount = r.nums[2]; mc = 0; }
    // The rate is the same on every row of one sheet — trust the common value.
    if (rateMode && Math.abs(rate - rateMode) > 0.01) rate = rateMode;
    const per = rate + (mc || 0);
    const ok = (g: number) => per > 0 && amount > 0 && Math.abs(g * per - amount) <= Math.max(0.6, amount * 0.002);
    if (!ok(grams) && per > 0 && amount > 0) {
      const g2 = Math.round((amount / per) * 100) / 100;
      if (ok(g2)) grams = g2; else flagged.push(i);
    }
    return { code: codes[i], name: r.name, desc: r.desc, grams, rate, mc: mc || 0, amount };
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
  if (flagged.length) warnings.push(`${flagged.length} row(s) don't add up (grams × (rate + MC) ≠ amount) — check the highlighted rows.`);

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
