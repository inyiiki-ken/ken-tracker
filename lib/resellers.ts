/**
 * Reseller invoicing: a reseller (e.g. ARIAN) sends photos of the items she
 * sold, each tagged with HER customer's name. The invoice goes to the
 * reseller, so every item is billed to her and the end customer's name moves
 * into the description ("18K GOLD HOOP EARRINGS (SP) - INDAY MICHELLE").
 *
 * Each reseller has her own rate per gram for each type, and the rate can
 * change daily (Arian on 2026-09-30: 18K 409, SP 414, EF 439 AED). Rates are
 * stored per reseller per day in the customer's sheet ("__RESELLER_CONFIG__")
 * so every PC sees the same numbers; a day with no rate entered falls back to
 * the reseller's most recent earlier day.
 */

import type { DatabaseRowType } from "@/types";

export type ResellerKarat = "18K" | "SP" | "EF";
export const RESELLER_KARATS: ResellerKarat[] = ["18K", "SP", "EF"];

/** Category written on the record for each type (same names Admin uses). */
export const KARAT_CATEGORY: Record<ResellerKarat, string> = {
  "18K": "Gold Normal",
  SP: "Special Price",
  EF: "Special Price EF",
};

export type ResellerRates = Record<ResellerKarat, number>;

export interface ResellerConfig {
  /** Keyed by reseller name in upper case. */
  resellers: Record<string, { rates: Record<string, Partial<ResellerRates>> }>;
}

export interface ResellerItem {
  key: number;
  /** Item as written on the tag, without the customer's name. */
  item: string;
  /** The reseller's own customer (goes into the description). */
  customer: string;
  grams: string;
  karat: ResellerKarat;
  /** Anything the reader was unsure about, shown next to the row. */
  note?: string;
  /** Set when the item is an existing Admin row being moved to the reseller. */
  record?: DatabaseRowType;
}

let itemSeq = 1;
export function newItem(patch: Partial<ResellerItem> = {}): ResellerItem {
  return { key: itemSeq++, item: "", customer: "", grams: "", karat: "18K", ...patch };
}

export function resellerKey(name: string): string {
  return String(name ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

export function parseResellerConfig(json: string): ResellerConfig {
  try {
    const p = JSON.parse(json || "{}");
    if (p && typeof p === "object" && p.resellers && typeof p.resellers === "object") return { resellers: p.resellers };
  } catch { /* malformed → empty */ }
  return { resellers: {} };
}

export function knownResellers(cfg: ResellerConfig): string[] {
  return Object.keys(cfg.resellers).sort();
}

/**
 * Rates for a reseller on a day (YYYY-MM-DD). Falls back to her latest earlier
 * day; `from` says which day the rates came from (null when none are saved).
 */
export function ratesFor(cfg: ResellerConfig, name: string, date: string): { rates: Partial<ResellerRates>; from: string | null } {
  const byDate = cfg.resellers[resellerKey(name)]?.rates ?? {};
  if (byDate[date]) return { rates: byDate[date], from: date };
  const earlier = Object.keys(byDate).filter((d) => d < date).sort();
  const from = earlier[earlier.length - 1] ?? null;
  return { rates: from ? byDate[from] : {}, from };
}

export function withRates(cfg: ResellerConfig, name: string, date: string, rates: Partial<ResellerRates>): ResellerConfig {
  const key = resellerKey(name);
  const prev = cfg.resellers[key]?.rates ?? {};
  return { resellers: { ...cfg.resellers, [key]: { rates: { ...prev, [date]: rates } } } };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Amount for one item: grams × the reseller's rate for its type. */
export function itemAmount(it: ResellerItem, rates: Partial<ResellerRates>): number {
  const g = parseFloat(it.grams) || 0;
  return round2(g * (rates[it.karat] || 0));
}

function cleanText(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Description the invoice shows, in the same shape as the manual invoices:
 * "18K GOLD HOOP EARRINGS (SP) - INDAY MICHELLE".
 */
export function buildDescription(it: ResellerItem): string {
  // "PLAIN LOOP SP" / "HOOP (SP)": the type is added once at the end below.
  let item = cleanText(it.item).replace(/\((SP|EF)\)/g, "").replace(/\s+(SP|EF)\s*$/, "").replace(/\s+/g, " ").trim();
  if (item && !/\b(18K|21K|22K|24K|GOLD|SILVER)\b/.test(item)) item = `18K GOLD ${item}`;
  if (it.karat !== "18K") item = `${item} (${it.karat})`;
  const cust = cleanText(it.customer);
  if (!cust || item.includes(cust)) return item;
  return `${item} - ${cust}`;
}

/** "SP", "(sp)", "special price EF"… → a type, or null. */
export function karatOf(s: string): ResellerKarat | null {
  const t = String(s ?? "").toUpperCase();
  if (/\bEF\b/.test(t)) return "EF";
  if (/\bSP\b|SPECIAL/.test(t)) return "SP";
  if (/\b18\s*K\b|\bGOLD NORMAL\b/.test(t)) return "18K";
  return null;
}

/** An existing Admin row as a reseller item: its customer becomes the end customer. */
export function itemFromRecord(r: DatabaseRowType): ResellerItem {
  return newItem({
    item: String(r.itemDescription ?? ""),
    customer: String(r.minerName ?? ""),
    grams: r.grams ? String(r.grams) : "",
    karat: karatOf(String(r.category ?? "")) ?? karatOf(String(r.itemDescription ?? "")) ?? "18K",
    record: r,
  });
}

const GRAMS_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(?:g|gm|gms|grams?)?\s*$/i;

/**
 * Reads pasted lines, one item per line. Columns can be split by tabs (copied
 * from Excel), " - ", "|" or ";". A plain number is the weight, SP / EF / 18K
 * is the type, the first text is the item and the second is the customer:
 *
 *   HOOP EARRINGS - INDAY MICHELLE - 1.65 - SP
 *   18K GOLD FIGARO CHAIN	CARBIZE BELLA	11.32
 */
export function parsePastedItems(text: string): ResellerItem[] {
  const out: ResellerItem[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = (line.includes("\t") ? line.split("\t") : line.split(/\s+-\s+|\s*\|\s*|\s*;\s*/))
      .map((p) => p.trim())
      .filter(Boolean);
    let grams = "";
    let karat: ResellerKarat | null = null;
    const texts: string[] = [];
    for (const p of parts) {
      const g = p.match(GRAMS_RE);
      if (g && !grams) { grams = g[1].replace(",", "."); continue; }
      if (/^\(?\s*(18\s*K|SP|EF)\s*\)?$/i.test(p)) { karat = karatOf(p); continue; }
      texts.push(p);
    }
    // "(SP)" written inside the item text.
    if (!karat && texts[0]) karat = /\((SP|EF)\)/i.test(texts[0]) ? karatOf(texts[0]) : null;
    if (!texts.length && !grams) continue;
    out.push(newItem({ item: texts[0] ?? "", customer: texts.slice(1).join(" "), grams, karat: karat ?? "18K" }));
  }
  return out;
}
