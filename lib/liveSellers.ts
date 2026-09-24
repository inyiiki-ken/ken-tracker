/**
 * Live Sellers & Stock — shared types and pure calculations (client + server).
 *
 * Flow (agreed with Silver Zone):
 *   1. Live day   — stock is weighed OUT to a seller (e.g. Paps), then weighed BACK.
 *                   The items taken are listed (description, type, grams) and go
 *                   into the seller's container as "On hold".
 *   2. On hold    — the customer may still cancel or change. A hold invoice
 *                   (statement) can be printed at any time.
 *   3. Pullout    — the seller pulls items out of the container: live date +
 *                   amount paid are confirmed → the item is SOLD and invoiced.
 *   ✕ Cancelled   — the item goes back to the shop stock.
 *
 * Stock is tracked by WEIGHT only (trays get mixed, so there is no per-tray
 * or per-item catalogue). Shop stock =
 *     stock added
 *   − grams out with a seller (weighed out, not yet back)
 *   − grams missing after weigh-back (the items now on hold / sold)
 *   − grams of items put on hold directly from the shop (swaps)
 *   + grams of cancelled items (they come back to the shop).
 */

export type LiveItemStatus = "On hold" | "Sold" | "Cancelled";
export type LiveSessionStatus = "Out" | "Returned";

export interface LivePriceType {
  name: string;
  rate: number; // per gram
}

export interface LivePriceList {
  currency: string;
  types: LivePriceType[];
  /** Holding longer than this many days is highlighted. */
  holdWarnDays: number;
  /** A type with no sale for this many days is "not moving". */
  notMovingDays: number;
}

export const DEFAULT_PRICE_LIST: LivePriceList = {
  currency: "AED",
  types: [
    { name: "Branded", rate: 27 },
    { name: "Rhodium", rate: 22 },
    { name: "Non-rhodium", rate: 18 },
    { name: "Bottega hollow", rate: 24 },
    { name: "Moissanite", rate: 35 },
  ],
  holdWarnDays: 7,
  notMovingDays: 30,
};

export function parsePriceList(json: string): LivePriceList {
  if (!json) return DEFAULT_PRICE_LIST;
  try {
    const p = JSON.parse(json) as Partial<LivePriceList>;
    const types = Array.isArray(p.types)
      ? p.types
          .map((t) => ({ name: String(t?.name ?? "").trim(), rate: Number(t?.rate) || 0 }))
          .filter((t) => t.name)
      : DEFAULT_PRICE_LIST.types;
    return {
      currency: String(p.currency || DEFAULT_PRICE_LIST.currency),
      types: types.length ? types : DEFAULT_PRICE_LIST.types,
      holdWarnDays: Number(p.holdWarnDays) > 0 ? Number(p.holdWarnDays) : DEFAULT_PRICE_LIST.holdWarnDays,
      notMovingDays: Number(p.notMovingDays) > 0 ? Number(p.notMovingDays) : DEFAULT_PRICE_LIST.notMovingDays,
    };
  } catch {
    return DEFAULT_PRICE_LIST;
  }
}

export interface LiveSession {
  id: string;
  date: string; // YYYY-MM-DD
  seller: string;
  weightOut: number;
  weightBack: number | null; // null while still out
  status: LiveSessionStatus;
  notes: string;
  /** Each weigh-out movement: first pull, extra pieces, grams given to / received from another seller. */
  outLog: LiveOutEntry[];
}

export interface LiveOutEntry {
  at: string; // ISO timestamp
  grams: number; // + more out to this seller, − given away
  note: string;
}

export function parseOutLog(raw: string): LiveOutEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.map((e) => ({ at: String(e?.at ?? ""), grams: Number(e?.grams) || 0, note: String(e?.note ?? "") }))
      : [];
  } catch {
    return [];
  }
}

export interface LiveItem {
  id: string;
  sessionId: string; // "" = put on hold straight from the shop (e.g. a swap)
  seller: string;
  liveDate: string; // YYYY-MM-DD
  description: string;
  type: string;
  grams: number;
  rate: number;
  amount: number; // grams × rate (rounded), editable
  status: LiveItemStatus;
  pulloutDate: string;
  paidAmount: number;
  invoiceNo: string;
  cancelledDate: string;
  notes: string;
}

export interface LiveStockEntry {
  id: string;
  date: string;
  grams: number; // negative = adjustment down
  pcs: number;
  description: string;
  note: string;
}

export interface LiveData {
  priceList: LivePriceList;
  sessions: LiveSession[];
  items: LiveItem[];
  stock: LiveStockEntry[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Half-up rounding to whole currency units (0-4 down, 5-9 up). */
export function roundAmount(v: number): number {
  return Math.floor(v + 0.5 + 1e-9);
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function rateFor(list: LivePriceList, type: string): number {
  const t = list.types.find((x) => x.name.toLowerCase() === type.toLowerCase());
  return t ? t.rate : 0;
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Whole days between an ISO date and today (0 = today). */
export function daysSince(iso: string, now = new Date()): number {
  if (!iso) return 0;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((today - then) / 86_400_000));
}

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Grams that physically left the shop for a session. */
export function sessionGramsOut(s: LiveSession): number {
  if (s.status === "Out" || s.weightBack === null) return s.weightOut;
  return Math.max(0, s.weightOut - s.weightBack);
}

export interface StockSummary {
  added: number;
  withSellers: number; // weighed out, not yet back
  onHold: number;
  onHoldAmount: number;
  inShop: number;
}

export function computeStock(data: Pick<LiveData, "sessions" | "items" | "stock">): StockSummary {
  const added = data.stock.reduce((s, e) => s + e.grams, 0);
  let withSellers = 0;
  let left = 0;
  for (const s of data.sessions) {
    if (s.status === "Out") withSellers += s.weightOut;
    left += sessionGramsOut(s);
  }
  // Items put on hold directly from the shop (no weigh session) also leave the shop.
  left += data.items.filter((i) => !i.sessionId).reduce((s, i) => s + i.grams, 0);
  const cancelledBack = data.items.filter((i) => i.status === "Cancelled").reduce((s, i) => s + i.grams, 0);
  const hold = data.items.filter((i) => i.status === "On hold");
  return {
    added: round2(added),
    withSellers: round2(withSellers),
    onHold: round2(hold.reduce((s, i) => s + i.grams, 0)),
    onHoldAmount: hold.reduce((s, i) => s + i.amount, 0),
    inShop: round2(added - left + cancelledBack),
  };
}

export interface SellerSummary {
  seller: string;
  holdCount: number;
  holdGrams: number;
  holdAmount: number;
  oldestDays: number;
  soldCount: number; // in period
  soldAmount: number;
  cancelledCount: number; // in period
  out: LiveSession | null; // an open weigh-out
}

export function inPeriod(iso: string, fromISO: string): boolean {
  return !!iso && iso.slice(0, 10) >= fromISO;
}

export function computeSellers(data: LiveData, fromISO: string): SellerSummary[] {
  const map = new Map<string, SellerSummary>();
  const get = (name: string) => {
    const key = name.trim().toUpperCase();
    let s = map.get(key);
    if (!s) {
      s = { seller: key, holdCount: 0, holdGrams: 0, holdAmount: 0, oldestDays: 0, soldCount: 0, soldAmount: 0, cancelledCount: 0, out: null };
      map.set(key, s);
    }
    return s;
  };
  for (const i of data.items) {
    if (!i.seller.trim()) continue;
    const s = get(i.seller);
    if (i.status === "On hold") {
      s.holdCount++;
      s.holdGrams = round2(s.holdGrams + i.grams);
      s.holdAmount += i.amount;
      s.oldestDays = Math.max(s.oldestDays, daysSince(i.liveDate));
    } else if (i.status === "Sold" && inPeriod(i.pulloutDate, fromISO)) {
      s.soldCount++;
      s.soldAmount += i.paidAmount;
    } else if (i.status === "Cancelled" && inPeriod(i.cancelledDate, fromISO)) {
      s.cancelledCount++;
    }
  }
  for (const ses of data.sessions) {
    if (ses.status === "Out" && ses.seller.trim()) get(ses.seller).out = ses;
  }
  return [...map.values()].sort(
    (a, b) => Number(!!b.out) - Number(!!a.out) || b.holdCount - a.holdCount || a.seller.localeCompare(b.seller)
  );
}

export interface TypeMovement {
  type: string;
  soldGrams: number;
  soldAmount: number;
  soldCount: number;
  lastSold: string; // ISO, "" = never
  daysSinceSale: number | null;
  label: "Fast moving" | "Moving" | "Slow" | "Not moving" | "No sales yet";
}

export function computeTypeMovement(data: LiveData, fromISO: string): TypeMovement[] {
  const names = new Set(data.priceList.types.map((t) => t.name));
  for (const i of data.items) if (i.type) names.add(i.type);
  const rows: TypeMovement[] = [...names].map((type) => {
    const sold = data.items.filter((i) => i.status === "Sold" && i.type === type);
    const period = sold.filter((i) => inPeriod(i.pulloutDate, fromISO));
    const last = sold.reduce((m, i) => (i.pulloutDate > m ? i.pulloutDate : m), "");
    return {
      type,
      soldGrams: round2(period.reduce((s, i) => s + i.grams, 0)),
      soldAmount: period.reduce((s, i) => s + i.paidAmount, 0),
      soldCount: period.length,
      lastSold: last,
      daysSinceSale: last ? daysSince(last) : null,
      label: "Moving",
    };
  });
  const max = Math.max(0, ...rows.map((r) => r.soldGrams));
  // How long have they been recording? Until then, "never sold" isn't dead stock yet.
  const firstDate = [...data.sessions.map((s) => s.date), ...data.items.map((i) => i.liveDate), ...data.stock.map((e) => e.date)]
    .filter(Boolean)
    .reduce((m, d) => (!m || d < m ? d : m), "");
  const trackingDays = firstDate ? daysSince(firstDate) : 0;
  for (const r of rows) {
    if (r.daysSinceSale === null) r.label = trackingDays >= data.priceList.notMovingDays ? "Not moving" : "No sales yet";
    else if (r.daysSinceSale >= data.priceList.notMovingDays) r.label = "Not moving";
    else if (r.soldGrams === 0) r.label = "Slow";
    else if (max > 0 && r.soldGrams >= max * 0.5) r.label = "Fast moving";
    else if (max > 0 && r.soldGrams >= max * 0.15) r.label = "Moving";
    else r.label = "Slow";
  }
  return rows.sort((a, b) => b.soldGrams - a.soldGrams);
}

/** Most-sold descriptions (normalised) in the period. */
export function computeTopItems(data: LiveData, fromISO: string, limit = 10): { description: string; count: number; grams: number }[] {
  const map = new Map<string, { description: string; count: number; grams: number }>();
  for (const i of data.items) {
    if (i.status !== "Sold" || !inPeriod(i.pulloutDate, fromISO)) continue;
    const key = i.description.trim().toLowerCase().replace(/\s+/g, " ");
    if (!key) continue;
    const cur = map.get(key) ?? { description: i.description.trim(), count: 0, grams: 0 };
    cur.count++;
    cur.grams = round2(cur.grams + i.grams);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.grams - a.grams).slice(0, limit);
}

export function newLiveId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
