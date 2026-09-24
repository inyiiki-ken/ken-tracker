"use server";

import type { GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveDoc } from "./tenant-context";
import { readConfig, writeConfig } from "./config-store";
import { requireRole, requireSession } from "./authz";
import { getSessionEmail } from "./tenancy-core";
import {
  parsePriceList,
  parseOutLog,
  newLiveId,
  roundAmount,
  round2,
  todayISO,
  type LiveData,
  type LiveItem,
  type LiveItemStatus,
  type LiveSession,
  type LiveStockEntry,
} from "@/lib/liveSellers";

/**
 * Live Sellers & Stock storage. Three app-owned tabs are auto-created in the
 * ACTIVE customer's own sheet on first use, so enabling the feature for one
 * customer never touches another customer's sheet:
 *   Live_Sessions — each weigh-out / weigh-back
 *   Live_Items    — every item in a seller's container (On hold / Sold / Cancelled)
 *   Live_Stock    — stock added (grams), plus manual adjustments
 * The price list lives in Ken_Config under "__LIVE_PRICELIST__".
 */

const ROLES = ["admin", "super_admin", "livesellers"];
const PRICE_MARKER = "__LIVE_PRICELIST__";

const SESSION_H = {
  id: "Session ID",
  date: "Date",
  seller: "Seller",
  weightOut: "Weight Out (g)",
  weightBack: "Weight Back (g)",
  status: "Status",
  notes: "Notes",
  outLog: "Out Log",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
} as const;

const ITEM_H = {
  id: "Item ID",
  sessionId: "Session ID",
  seller: "Seller",
  liveDate: "Live Date",
  description: "Description",
  type: "Type",
  grams: "Grams",
  rate: "Rate",
  amount: "Amount",
  status: "Status",
  pulloutDate: "Pullout Date",
  paidAmount: "Paid Amount",
  invoiceNo: "Invoice No",
  cancelledDate: "Cancelled Date",
  notes: "Notes",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
} as const;

const STOCK_H = {
  id: "Entry ID",
  date: "Date",
  grams: "Grams",
  pcs: "Pcs",
  description: "Description",
  note: "Note",
  addedBy: "Added By",
} as const;

const TAB = { sessions: "Live_Sessions", items: "Live_Items", stock: "Live_Stock" } as const;

const inflight = new Map<string, Promise<GoogleSpreadsheetWorksheet>>();

async function getTab(key: keyof typeof TAB): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getActiveDoc();
  const title = TAB[key];
  const headers = Object.values(key === "sessions" ? SESSION_H : key === "items" ? ITEM_H : STOCK_H);
  const existing = doc.sheetsByTitle[title];
  if (existing) {
    await existing.loadHeaderRow().catch(() => undefined);
    const have = new Set(existing.headerValues ?? []);
    const missing = headers.filter((h) => !have.has(h));
    if (missing.length && existing.headerValues?.length) {
      await existing.setHeaderRow([...existing.headerValues, ...missing]);
    }
    return existing;
  }
  const ckey = `${doc.spreadsheetId}:${title}`;
  const p = inflight.get(ckey);
  if (p) return p;
  const created = doc.addSheet({ title, headerValues: headers }).finally(() => inflight.delete(ckey));
  inflight.set(ckey, created);
  return created;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
function isoDate(v: unknown): string {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? todayISO(d) : s;
}
function stamp(): string {
  return new Date().toISOString();
}

// ── Read everything in one go ───────────────────────────────────────────────

export async function getLiveData(_params?: Record<string, never>): Promise<LiveData> {
  await requireSession();
  const [sws, iws, kws, priceJson] = await Promise.all([
    getTab("sessions"),
    getTab("items"),
    getTab("stock"),
    readConfig(PRICE_MARKER),
  ]);
  const [srows, irows, krows] = await Promise.all([sws.getRows(), iws.getRows(), kws.getRows()]);

  const sessions: LiveSession[] = srows
    .filter((r) => str(r.get(SESSION_H.id)))
    .map((r) => {
      const back = str(r.get(SESSION_H.weightBack));
      const status = str(r.get(SESSION_H.status)) === "Out" ? "Out" : "Returned";
      return {
        id: str(r.get(SESSION_H.id)),
        date: isoDate(r.get(SESSION_H.date)),
        seller: str(r.get(SESSION_H.seller)).toUpperCase(),
        weightOut: num(r.get(SESSION_H.weightOut)),
        weightBack: status === "Out" || back === "" ? null : num(back),
        status,
        notes: str(r.get(SESSION_H.notes)),
        outLog: parseOutLog(str(r.get(SESSION_H.outLog))),
      };
    });

  const items: LiveItem[] = irows
    .filter((r) => str(r.get(ITEM_H.id)))
    .map((r) => {
      const st = str(r.get(ITEM_H.status));
      const status: LiveItemStatus = st === "Sold" ? "Sold" : st === "Cancelled" ? "Cancelled" : "On hold";
      return {
        id: str(r.get(ITEM_H.id)),
        sessionId: str(r.get(ITEM_H.sessionId)),
        seller: str(r.get(ITEM_H.seller)).toUpperCase(),
        liveDate: isoDate(r.get(ITEM_H.liveDate)),
        description: str(r.get(ITEM_H.description)),
        type: str(r.get(ITEM_H.type)),
        grams: num(r.get(ITEM_H.grams)),
        rate: num(r.get(ITEM_H.rate)),
        amount: num(r.get(ITEM_H.amount)),
        status,
        pulloutDate: isoDate(r.get(ITEM_H.pulloutDate)),
        paidAmount: num(r.get(ITEM_H.paidAmount)),
        invoiceNo: str(r.get(ITEM_H.invoiceNo)),
        cancelledDate: isoDate(r.get(ITEM_H.cancelledDate)),
        notes: str(r.get(ITEM_H.notes)),
      };
    });

  const stock: LiveStockEntry[] = krows
    .filter((r) => str(r.get(STOCK_H.id)) || str(r.get(STOCK_H.grams)))
    .map((r, idx) => ({
      id: str(r.get(STOCK_H.id)) || `ROW-${idx}`,
      date: isoDate(r.get(STOCK_H.date)),
      grams: num(r.get(STOCK_H.grams)),
      pcs: num(r.get(STOCK_H.pcs)),
      description: str(r.get(STOCK_H.description)),
      note: str(r.get(STOCK_H.note)),
    }));

  return { priceList: parsePriceList(priceJson), sessions, items, stock };
}

export async function saveLivePriceList(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["admin", "super_admin"]);
  await writeConfig(PRICE_MARKER, params.config);
  return { success: true };
}

// ── Live day ────────────────────────────────────────────────────────────────

export interface LiveItemInput {
  description: string;
  type: string;
  grams: number;
  rate: number;
  amount?: number;
}

function itemRow(
  it: LiveItemInput,
  base: { sessionId: string; seller: string; liveDate: string },
  who: string
): Record<string, string> {
  const grams = round2(num(it.grams));
  const rate = num(it.rate);
  const amount = it.amount !== undefined && it.amount !== null && String(it.amount) !== "" ? roundAmount(num(it.amount)) : roundAmount(grams * rate);
  return {
    [ITEM_H.id]: newLiveId("LI"),
    [ITEM_H.sessionId]: base.sessionId,
    [ITEM_H.seller]: base.seller,
    [ITEM_H.liveDate]: base.liveDate,
    [ITEM_H.description]: str(it.description),
    [ITEM_H.type]: str(it.type),
    [ITEM_H.grams]: String(grams),
    [ITEM_H.rate]: String(rate),
    [ITEM_H.amount]: String(amount),
    [ITEM_H.status]: "On hold",
    [ITEM_H.updatedBy]: who,
    [ITEM_H.updatedAt]: stamp(),
  };
}

/** Weigh stock OUT to a seller (before the live). */
export async function startLiveSession(params: { date: string; seller: string; weightOut: number; notes?: string }): Promise<{ id: string }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const seller = str(params.seller).toUpperCase();
  if (!seller) throw new Error("Seller is required.");
  if (!(num(params.weightOut) > 0)) throw new Error("Weight out must be more than 0.");
  const ws = await getTab("sessions");
  const id = newLiveId("LS");
  await ws.addRow({
    [SESSION_H.id]: id,
    [SESSION_H.date]: isoDate(params.date) || todayISO(),
    [SESSION_H.seller]: seller,
    [SESSION_H.weightOut]: String(round2(num(params.weightOut))),
    [SESSION_H.weightBack]: "",
    [SESSION_H.status]: "Out",
    [SESSION_H.notes]: str(params.notes),
    [SESSION_H.outLog]: JSON.stringify([{ at: stamp(), grams: round2(num(params.weightOut)), note: "Weighed out" }]),
    [SESSION_H.updatedBy]: who,
    [SESSION_H.updatedAt]: stamp(),
  });
  return { id };
}

/**
 * Weigh BACK and list the items taken. If `sessionId` is empty a new session
 * is recorded in one step (weigh-out and weigh-back entered together).
 */
export async function finishLiveSession(params: {
  sessionId?: string;
  date: string;
  seller: string;
  weightOut: number;
  weightBack: number;
  notes?: string;
  items: LiveItemInput[];
}): Promise<{ id: string; added: number }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const seller = str(params.seller).toUpperCase();
  if (!seller) throw new Error("Seller is required.");
  const out = round2(num(params.weightOut));
  const back = round2(num(params.weightBack));
  if (!(out > 0)) throw new Error("Weight out must be more than 0.");
  if (back < 0) throw new Error("Weight back can't be negative.");
  const date = isoDate(params.date) || todayISO();

  const sws = await getTab("sessions");
  let id = str(params.sessionId);
  if (id) {
    const rows = await sws.getRows();
    const row = rows.find((r) => str(r.get(SESSION_H.id)) === id);
    if (!row) throw new Error("That weigh-out was not found. Refresh and try again.");
    if (str(row.get(SESSION_H.status)) !== "Out") throw new Error("This live was already weighed back.");
    row.set(SESSION_H.date, date);
    row.set(SESSION_H.seller, seller);
    row.set(SESSION_H.weightOut, String(out));
    row.set(SESSION_H.weightBack, String(back));
    row.set(SESSION_H.status, "Returned");
    if (params.notes !== undefined) row.set(SESSION_H.notes, str(params.notes));
    row.set(SESSION_H.updatedBy, who);
    row.set(SESSION_H.updatedAt, stamp());
    await row.save();
  } else {
    id = newLiveId("LS");
    await sws.addRow({
      [SESSION_H.id]: id,
      [SESSION_H.date]: date,
      [SESSION_H.seller]: seller,
      [SESSION_H.weightOut]: String(out),
      [SESSION_H.weightBack]: String(back),
      [SESSION_H.status]: "Returned",
      [SESSION_H.notes]: str(params.notes),
      [SESSION_H.outLog]: JSON.stringify([{ at: stamp(), grams: out, note: "Weighed out" }]),
      [SESSION_H.updatedBy]: who,
      [SESSION_H.updatedAt]: stamp(),
    });
  }

  const valid = (params.items || []).filter((it) => str(it.description) || num(it.grams) > 0);
  if (valid.length) {
    const iws = await getTab("items");
    await iws.addRows(valid.map((it) => itemRow(it, { sessionId: id, seller, liveDate: date }, who)));
  }
  return { id, added: valid.length };
}

/** Delete a weigh-out that was entered by mistake (only while still "Out"). */
export async function deleteLiveSession(params: { sessionId: string }): Promise<{ success: boolean }> {
  await requireRole(ROLES);
  const sws = await getTab("sessions");
  const rows = await sws.getRows();
  const row = rows.find((r) => str(r.get(SESSION_H.id)) === params.sessionId);
  if (!row) return { success: true };
  if (str(row.get(SESSION_H.status)) !== "Out") throw new Error("Only a weigh-out that hasn't come back can be deleted.");
  await row.delete();
  return { success: true };
}

/** Put items on hold for a seller straight from the shop (e.g. a customer swap). */
export async function addLiveItems(params: { seller: string; liveDate: string; items: LiveItemInput[] }): Promise<{ added: number }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const seller = str(params.seller).toUpperCase();
  if (!seller) throw new Error("Seller is required.");
  const valid = (params.items || []).filter((it) => str(it.description) || num(it.grams) > 0);
  if (!valid.length) return { added: 0 };
  const iws = await getTab("items");
  await iws.addRows(valid.map((it) => itemRow(it, { sessionId: "", seller, liveDate: isoDate(params.liveDate) || todayISO() }, who)));
  return { added: valid.length };
}

// ── Container actions ──────────────────────────────────────────────────────

export async function updateLiveItems(params: {
  action: "pullout" | "cancel" | "restore" | "edit";
  ids: string[];
  pulloutDate?: string;
  invoiceNo?: string;
  /** Per-item paid amount (pullout) */
  paid?: Record<string, number>;
  /** Per-item field edits (edit) */
  edits?: Record<string, Partial<Pick<LiveItem, "description" | "type" | "grams" | "rate" | "amount" | "liveDate" | "notes">>>;
}): Promise<{ updated: number }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const ids = new Set(params.ids || []);
  if (!ids.size) return { updated: 0 };
  const iws = await getTab("items");
  const rows = await iws.getRows();
  const targets = rows.filter((r) => ids.has(str(r.get(ITEM_H.id))));
  const today = todayISO();
  for (const r of targets) {
    const id = str(r.get(ITEM_H.id));
    const status = str(r.get(ITEM_H.status)) || "On hold";
    if (params.action === "pullout") {
      if (status !== "On hold") continue;
      const paid = params.paid?.[id];
      const amount = num(r.get(ITEM_H.amount));
      r.set(ITEM_H.status, "Sold");
      r.set(ITEM_H.pulloutDate, isoDate(params.pulloutDate) || today);
      r.set(ITEM_H.paidAmount, String(roundAmount(paid !== undefined ? num(paid) : amount)));
      r.set(ITEM_H.invoiceNo, str(params.invoiceNo));
    } else if (params.action === "cancel") {
      if (status !== "On hold") continue;
      r.set(ITEM_H.status, "Cancelled");
      r.set(ITEM_H.cancelledDate, today);
    } else if (params.action === "restore") {
      r.set(ITEM_H.status, "On hold");
      r.set(ITEM_H.pulloutDate, "");
      r.set(ITEM_H.paidAmount, "");
      r.set(ITEM_H.invoiceNo, "");
      r.set(ITEM_H.cancelledDate, "");
    } else if (params.action === "edit") {
      const e = params.edits?.[id];
      if (!e) continue;
      if (e.description !== undefined) r.set(ITEM_H.description, str(e.description));
      if (e.type !== undefined) r.set(ITEM_H.type, str(e.type));
      if (e.liveDate !== undefined) r.set(ITEM_H.liveDate, isoDate(e.liveDate));
      if (e.notes !== undefined) r.set(ITEM_H.notes, str(e.notes));
      const grams = e.grams !== undefined ? round2(num(e.grams)) : num(r.get(ITEM_H.grams));
      const rate = e.rate !== undefined ? num(e.rate) : num(r.get(ITEM_H.rate));
      r.set(ITEM_H.grams, String(grams));
      r.set(ITEM_H.rate, String(rate));
      r.set(ITEM_H.amount, String(e.amount !== undefined ? roundAmount(num(e.amount)) : roundAmount(grams * rate)));
    }
    r.set(ITEM_H.updatedBy, who);
    r.set(ITEM_H.updatedAt, stamp());
    await r.save();
  }
  return { updated: targets.length };
}

// ── Stock ──────────────────────────────────────────────────────────────────

export async function addLiveStock(params: { date: string; grams: number; pcs?: number; description?: string; note?: string }): Promise<{ success: boolean }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const grams = round2(num(params.grams));
  if (!grams) throw new Error("Enter the grams.");
  const ws = await getTab("stock");
  await ws.addRow({
    [STOCK_H.id]: newLiveId("ST"),
    [STOCK_H.date]: isoDate(params.date) || todayISO(),
    [STOCK_H.grams]: String(grams),
    [STOCK_H.pcs]: params.pcs ? String(num(params.pcs)) : "",
    [STOCK_H.description]: str(params.description),
    [STOCK_H.note]: str(params.note),
    [STOCK_H.addedBy]: who,
  });
  return { success: true };
}

export async function deleteLiveStock(params: { id: string }): Promise<{ success: boolean }> {
  await requireRole(["admin", "super_admin"]);
  const ws = await getTab("stock");
  const rows = await ws.getRows();
  const row = rows.find((r) => str(r.get(STOCK_H.id)) === params.id);
  if (row) await row.delete();
  return { success: true };
}

// ── While the live is running ──────────────────────────────────────────────

type SessionRow = Awaited<ReturnType<GoogleSpreadsheetWorksheet["getRows"]>>[number];

function pushLog(row: SessionRow, grams: number, note: string) {
  const log = parseOutLog(str(row.get(SESSION_H.outLog)));
  if (!log.length) {
    // Older rows had no log: seed it with the original weigh-out.
    const before = num(row.get(SESSION_H.weightOut));
    if (before) log.push({ at: "", grams: before, note: "Weighed out" });
  }
  log.push({ at: stamp(), grams: round2(grams), note });
  row.set(SESSION_H.outLog, JSON.stringify(log.slice(-200)));
}

/** More pieces taken from the room during the live (weighed and added to the seller). */
export async function addToLiveSession(params: { sessionId: string; grams: number; note?: string }): Promise<{ weightOut: number }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const grams = round2(num(params.grams));
  if (!(grams > 0)) throw new Error("Enter the grams taken.");
  const ws = await getTab("sessions");
  const rows = await ws.getRows();
  const row = rows.find((r) => str(r.get(SESSION_H.id)) === params.sessionId);
  if (!row) throw new Error("That weigh-out was not found. Refresh and try again.");
  if (str(row.get(SESSION_H.status)) !== "Out") throw new Error("This live was already weighed back.");
  pushLog(row, grams, str(params.note) || "Added");
  const total = round2(num(row.get(SESSION_H.weightOut)) + grams);
  row.set(SESSION_H.weightOut, String(total));
  row.set(SESSION_H.updatedBy, who);
  row.set(SESSION_H.updatedAt, stamp());
  await row.save();
  return { weightOut: total };
}

/**
 * A seller lends grams that are out with her to another seller. It goes back
 * through the room: it comes off her weigh-out and goes onto the other
 * seller's open weigh-out (one is started if she has none). Shop stock is
 * unchanged.
 */
export async function transferLiveWeight(params: { fromSessionId: string; toSeller: string; grams: number; date?: string; note?: string }): Promise<{ success: boolean }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const grams = round2(num(params.grams));
  const to = str(params.toSeller).toUpperCase();
  if (!(grams > 0)) throw new Error("Enter the grams.");
  if (!to) throw new Error("Choose who receives it.");
  const ws = await getTab("sessions");
  const rows = await ws.getRows();
  const from = rows.find((r) => str(r.get(SESSION_H.id)) === params.fromSessionId);
  if (!from || str(from.get(SESSION_H.status)) !== "Out") throw new Error("That weigh-out is not open any more. Refresh and try again.");
  const fromSeller = str(from.get(SESSION_H.seller)).toUpperCase();
  if (fromSeller === to) throw new Error("Choose a different seller.");
  const fromOut = num(from.get(SESSION_H.weightOut));
  if (grams > fromOut + 0.001) throw new Error(`${fromSeller} only has ${round2(fromOut)} g out.`);
  const note = str(params.note);

  pushLog(from, -grams, `Given to ${to}${note ? ` — ${note}` : ""}`);
  from.set(SESSION_H.weightOut, String(round2(fromOut - grams)));
  from.set(SESSION_H.updatedBy, who);
  from.set(SESSION_H.updatedAt, stamp());
  await from.save();

  const target = rows.find((r) => str(r.get(SESSION_H.status)) === "Out" && str(r.get(SESSION_H.seller)).toUpperCase() === to);
  const logNote = `From ${fromSeller}${note ? ` — ${note}` : ""}`;
  if (target) {
    pushLog(target, grams, logNote);
    target.set(SESSION_H.weightOut, String(round2(num(target.get(SESSION_H.weightOut)) + grams)));
    target.set(SESSION_H.updatedBy, who);
    target.set(SESSION_H.updatedAt, stamp());
    await target.save();
  } else {
    await ws.addRow({
      [SESSION_H.id]: newLiveId("LS"),
      [SESSION_H.date]: isoDate(params.date) || isoDate(from.get(SESSION_H.date)) || todayISO(),
      [SESSION_H.seller]: to,
      [SESSION_H.weightOut]: String(grams),
      [SESSION_H.weightBack]: "",
      [SESSION_H.status]: "Out",
      [SESSION_H.notes]: "",
      [SESSION_H.outLog]: JSON.stringify([{ at: stamp(), grams, note: logNote }]),
      [SESSION_H.updatedBy]: who,
      [SESSION_H.updatedAt]: stamp(),
    });
  }
  return { success: true };
}

/** Move on-hold items from one seller's container to another's (borrowing). */
export async function moveLiveItems(params: { ids: string[]; toSeller: string }): Promise<{ moved: number }> {
  await requireRole(ROLES);
  const who = (await getSessionEmail().catch(() => null)) || "";
  const to = str(params.toSeller).toUpperCase();
  if (!to) throw new Error("Choose who receives the items.");
  const ids = new Set(params.ids || []);
  const ws = await getTab("items");
  const rows = await ws.getRows();
  let moved = 0;
  for (const r of rows) {
    if (!ids.has(str(r.get(ITEM_H.id)))) continue;
    if ((str(r.get(ITEM_H.status)) || "On hold") !== "On hold") continue;
    const from = str(r.get(ITEM_H.seller)).toUpperCase();
    if (from === to) continue;
    const prev = str(r.get(ITEM_H.notes));
    r.set(ITEM_H.seller, to);
    r.set(ITEM_H.notes, [prev, `Moved from ${from} on ${todayISO()}`].filter(Boolean).join(" · "));
    r.set(ITEM_H.updatedBy, who);
    r.set(ITEM_H.updatedAt, stamp());
    await r.save();
    moved++;
  }
  return { moved };
}
