"use server";

import type { GoogleSpreadsheetCell, GoogleSpreadsheetRow, GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveDoc, invalidateActiveRows } from "./tenant-context";
import { getAppTab } from "./appTabs";
import { requireRole, getSessionAccess, liverNameForEmail } from "./authz";
import { getSessionEmail } from "./tenancy-core";
import { databaseRecordToRow } from "./row-mapper";
import { DATABASE_HEADERS } from "./sheet-config";
import { readDatabase, writeRowsByCells, appendAudit, newRowKey, setAndSaveCells } from "./recordStore";
import type { DatabaseRowType } from "@/types";
import {
  PULLOUT_MOVES, isOpenRequest, isRealItemKey, isToPullOut, itemLine, itemSummary, liverKey,
} from "@/lib/pulloutRequests";
import type {
  LiverCameMove,
  LiverCamePlan,
  PulloutMethod,
  PulloutRequest,
  PulloutRequestInput,
  PulloutRequestStatus,
} from "@/lib/pulloutRequests";
import { liverCameStatus } from "@/lib/pulloutTargets";

/**
 * Pullout requests live in an app-owned "Pullout Requests" tab, auto-created in
 * the ACTIVE customer's own sheet on first use. Rows are never removed — a
 * withdrawn request is marked Cancelled.
 */

const TAB = "Pullout Requests";

const H = {
  id: "Request ID",
  liver: "Liver",
  date: "Pullout Date",
  method: "Method",
  items: "Item Keys",
  summary: "Items",
  note: "Note",
  status: "Status",
  requestedBy: "Requested By",
  requestedAt: "Requested At",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
  reply: "Dispatch Reply",
} as const;

/** Roles that work requests for every liver (prepare, Ready, Liver came). */
const STAFF_ROLES = ["super_admin", "admin", "dispatch"];
/** Roles that may also view every liver's tab (and request on their behalf). */
const VIEW_ALL_ROLES = [...STAFF_ROLES, "bossing", "accounts"];

const CHANGED = "This request changed — refresh.";

function getTab(): Promise<GoogleSpreadsheetWorksheet> {
  return getAppTab(TAB, Object.values(H));
}

// Every open My Sales / Dispatch screen polls; a short cache keeps that to one
// read per sheet every few seconds. Any write clears it.
const rowsCache = new Map<string, { at: number; rows: GoogleSpreadsheetRow[] }>();
const ROWS_TTL_MS = 10_000;

async function readRequests(fresh: boolean): Promise<{ ws: GoogleSpreadsheetWorksheet; rows: GoogleSpreadsheetRow[] }> {
  const ws = await getTab();
  const key = (await getActiveDoc()).spreadsheetId;
  const cached = rowsCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < ROWS_TTL_MS) return { ws, rows: cached.rows };
  const rows = await ws.getRows();
  rowsCache.set(key, { at: Date.now(), rows });
  return { ws, rows };
}

function invalidateRequests() {
  rowsCache.clear();
}

/**
 * Serialises read-check-write on the request tab, so two taps at the same
 * moment can't both pass the checks (same item in two requests, an edit and a
 * Dispatch tap undoing each other).
 */
let requestChain: Promise<unknown> = Promise.resolve();
function withRequestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = requestChain.then(fn, fn);
  requestChain = run.catch(() => undefined);
  return run;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
function isoDate(v: unknown): string {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}
function method(v: unknown): PulloutMethod {
  return /cod/i.test(str(v)) ? "COD" : "Pick Up";
}
function status(v: unknown): PulloutRequestStatus {
  const s = str(v);
  return s === "Ready" || s === "Done" || s === "Cancelled" ? s : "Requested";
}
/** Text exactly as typed: a value starting with "=" must not become a formula. */
function literal(v: string): string {
  return v.startsWith("=") ? ` ${v}` : v;
}

function toRequest(r: { get: (h: string) => unknown }): PulloutRequest {
  return {
    id: str(r.get(H.id)),
    liver: str(r.get(H.liver)).toUpperCase(),
    date: isoDate(r.get(H.date)),
    method: method(r.get(H.method)),
    itemKeys: str(r.get(H.items)).split(",").map((k) => k.trim()).filter(Boolean),
    summary: str(r.get(H.summary)),
    note: str(r.get(H.note)),
    dispatchReply: str(r.get(H.reply)),
    status: status(r.get(H.status)),
    requestedBy: str(r.get(H.requestedBy)),
    requestedAt: str(r.get(H.requestedAt)),
    updatedBy: str(r.get(H.updatedBy)),
    updatedAt: str(r.get(H.updatedAt)),
  };
}

type Caller = { email: string; staff: boolean; viewAll: boolean; liverName: string };

/** Who is calling: staff can act for any liver; a liver only for their own name. */
async function caller(): Promise<Caller> {
  // Same cached Roles read as every other action (name included).
  const a = await getSessionAccess();
  // Checks switched off, or a developer ⇒ no checks.
  if (a.all) return { email: a.email || (await getSessionEmail()) || "", staff: true, viewAll: true, liverName: "" };
  // No role (e.g. a Roles row with a misspelt role): nothing, as in getRecords.
  if (a.roles.length === 0) throw new Error("You don't have permission for this action.");
  return {
    email: a.email,
    staff: a.roles.some((r) => STAFF_ROLES.includes(r)),
    viewAll: a.roles.some((r) => VIEW_ALL_ROLES.includes(r)),
    // Only a liver acts as one; a name on a staff row alone doesn't make her one.
    liverName: a.roles.includes("liver") ? liverKey(a.liverName) : "",
  };
}

function assertOwnLiver(c: Caller, liver: string) {
  if (c.viewAll) return;
  if (!c.liverName || c.liverName !== liverKey(liver)) {
    throw new Error("You can only make pullout requests for your own items.");
  }
}

function newId(): string {
  return `PR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

/** Longest note / Dispatch reply kept (a sheet cell holds 50,000 characters). */
const NOTE_MAX = 500, REPLY_MAX = 300;

/**
 * A real calendar day from yesterday (UTC, slack for every timezone) up to
 * about two months ahead.
 */
function checkDay(d: string) {
  const t = new Date(d + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) {
    throw new Error("Pick the day you will pull out the items.");
  }
  const earliest = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  if (d < earliest) throw new Error("Pick today or a later day.");
  const latest = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  if (d > latest) throw new Error("Pick a day within the next two months.");
}

function cleanKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.map((k) => str(k).replace(/,/g, "")).filter(Boolean)));
}

function cleanInput(input: PulloutRequestInput) {
  const date = isoDate(input.date);
  checkDay(date);
  const keys = cleanKeys(input.itemKeys);
  if (keys.length === 0) throw new Error("Tick at least one item.");
  return {
    liver: liverKey(input.liver),
    date,
    method: method(input.method),
    keys,
    note: str(input.note).slice(0, NOTE_MAX),
  };
}

/** The Database rows each Row Key points at. */
function rowsByKey(records: DatabaseRowType[]): Map<string, DatabaseRowType[]> {
  const m = new Map<string, DatabaseRowType[]>();
  for (const r of records) {
    const k = str(r.rowKey);
    if (!k) continue;
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  return m;
}

/**
 * The items behind new request keys, checked against the sheet as it is now:
 * the liver's own, still waiting to be pulled out, and in no other open request.
 * Throws naming the items that fail.
 */
async function checkNewItems(liver: string, keys: string[], open: PulloutRequest[]): Promise<DatabaseRowType[]> {
  const { records } = await readDatabase();
  const byKey = rowsByKey(records);
  const taken = new Map<string, PulloutRequest>();
  for (const q of open) for (const k of q.itemKeys) taken.set(k, q);
  const problems: string[] = [];
  const items: DatabaseRowType[] = [];
  for (const k of keys) {
    if (!isRealItemKey(k)) { problems.push("An item has no ID yet"); continue; }
    const rows = byKey.get(k) ?? [];
    const mine = rows.filter((r) => liverKey(r.liverName) === liver);
    if (mine.length === 0) { problems.push("An item is no longer in your list"); continue; }
    if (rows.length > 1) { problems.push(`Two rows share one ID (${itemLine(mine[0])}) — ask the admin to fix the Row Key`); continue; }
    const r = mine[0];
    if (!isToPullOut(r)) { problems.push(`Already set to ${r.status || "no status"}: ${itemLine(r)}`); continue; }
    const q = taken.get(k);
    if (q) { problems.push(`Already in your request for ${q.date}: ${itemLine(r)}`); continue; }
    items.push(r);
  }
  if (problems.length) {
    const more = problems.length > 3 ? ` · and ${problems.length - 3} more` : "";
    throw new Error(`${problems.slice(0, 3).join(" · ")}${more}. Refresh and try again.`);
  }
  return items;
}

/** Read one request fresh (for a write), refusing when the caller's copy is out of date. */
async function findFresh(id: string, seenUpdatedAt?: string) {
  const { ws, rows } = await readRequests(true);
  const row = rows.find((r) => str(r.get(H.id)) === id);
  if (!row) throw new Error("That request no longer exists. Refresh and try again.");
  const q = toRequest(row);
  if (seenUpdatedAt !== undefined && seenUpdatedAt !== q.updatedAt) throw new Error(CHANGED);
  return { ws, row, q };
}

/**
 * Write only the given cells of one request row (never the whole row), after
 * checking just before writing that nobody changed it since it was read.
 * Call inside withRequestLock.
 */
async function writeRequestCells(
  ws: GoogleSpreadsheetWorksheet,
  row: GoogleSpreadsheetRow,
  q: PulloutRequest,
  patch: Partial<Record<keyof typeof H, string>>,
) {
  const headers = ws.headerValues.map(String);
  const r = row.rowNumber - 1;
  await ws.loadCells({ startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: headers.length });
  const cell = (h: string) => {
    const i = headers.indexOf(h);
    return i < 0 ? null : ws.getCell(r, i);
  };
  const read = (h: string) => {
    const c = cell(h);
    return c ? str(c.formattedValue ?? c.value) : "";
  };
  if (read(H.id) !== q.id || read(H.updatedAt) !== q.updatedAt) throw new Error(CHANGED);
  const edits: [GoogleSpreadsheetCell, unknown][] = [];
  for (const [k, v] of Object.entries(patch)) {
    const c = cell(H[k as keyof typeof H]);
    if (c) edits.push([c, literal(String(v ?? ""))]);
  }
  await setAndSaveCells(ws, edits);
  invalidateRequests();
}

/** Requests for one liver, or for everyone (staff only) when no liver is given. */
export async function getPulloutRequests(params?: { liver?: string }): Promise<PulloutRequest[]> {
  const c = await caller();
  const liver = liverKey(params?.liver);
  if (!liver && !c.viewAll) throw new Error("You don't have permission for this action.");
  if (liver) assertOwnLiver(c, liver);
  const { rows } = await readRequests(false);
  const list = rows
    .map(toRequest)
    .filter((q) => q.id && (!liver || liverKey(q.liver) === liver))
    .sort((a, b) => (a.date === b.date ? a.requestedAt.localeCompare(b.requestedAt) : a.date.localeCompare(b.date)));
  // Dispatch sees "by <email>" when an admin sent it on the liver's behalf.
  if (c.staff) {
    const names = new Map<string, string>();
    for (const q of list) {
      if (!isOpenRequest(q) || !q.requestedBy) continue;
      const by = q.requestedBy.toLowerCase();
      if (!names.has(by)) names.set(by, liverKey(await liverNameForEmail(by)));
      q.onBehalf = names.get(by) !== liverKey(q.liver);
    }
  }
  // A liver doesn't get staff emails: anyone but her shows as "Dispatch".
  if (!c.staff && !c.viewAll) {
    const me = c.email.toLowerCase().trim();
    const redactBy = (v: string) => (v && v.toLowerCase().trim() !== me ? "Dispatch" : v);
    return list.map((q) => ({ ...q, requestedBy: redactBy(q.requestedBy), updatedBy: redactBy(q.updatedBy) }));
  }
  return list;
}

export async function createPulloutRequest(params: { input: PulloutRequestInput }): Promise<PulloutRequest> {
  const c = await caller();
  const v = cleanInput(params.input);
  if (!v.liver) throw new Error("No liver name.");
  assertOwnLiver(c, v.liver);
  return withRequestLock(async () => {
    const { ws, rows } = await readRequests(true);
    // An item can be in only one open request at a time, and must still be hers to pull out.
    const open = rows.map(toRequest).filter(isOpenRequest);
    const items = await checkNewItems(v.liver, v.keys, open);
    const now = new Date().toISOString();
    const req: PulloutRequest = {
      id: newId(),
      liver: v.liver,
      date: v.date,
      method: v.method,
      itemKeys: v.keys,
      // Built from the sheet, not the screen, so the tab reads true on its own.
      summary: itemSummary(items),
      note: v.note,
      dispatchReply: "",
      status: "Requested",
      requestedBy: c.email,
      requestedAt: now,
      updatedBy: c.email,
      updatedAt: now,
    };
    // raw: text is stored exactly as typed (a note starting with "=" must not
    // become a formula).
    await ws.addRow({
      [H.id]: req.id,
      [H.liver]: req.liver,
      [H.date]: req.date,
      [H.method]: req.method,
      [H.items]: req.itemKeys.join(","),
      [H.summary]: req.summary,
      [H.note]: req.note,
      [H.status]: req.status,
      [H.requestedBy]: req.requestedBy,
      [H.requestedAt]: req.requestedAt,
      [H.updatedBy]: req.updatedBy,
      [H.updatedAt]: req.updatedAt,
      [H.reply]: "",
    }, { raw: true });
    invalidateRequests();
    return req;
  });
}

/** The liver adds forgotten items to her request — only while it is still Requested. */
export async function addItemsToPulloutRequest(params: { id: string; itemKeys: string[]; note?: string; seenUpdatedAt?: string }): Promise<void> {
  const c = await caller();
  await withRequestLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    assertOwnLiver(c, q.liver);
    if (q.status !== "Requested") throw new Error("Dispatch already prepared this request. Send the new items separately.");
    const keys = cleanKeys(params.itemKeys).filter((k) => !q.itemKeys.includes(k));
    if (keys.length === 0) throw new Error("Tick at least one item.");
    const { rows } = await readRequests(false);
    const open = rows.map(toRequest).filter(isOpenRequest);
    const items = await checkNewItems(liverKey(q.liver), keys, open);
    await writeRequestCells(ws, row, q, {
      items: [...q.itemKeys, ...keys].join(","),
      summary: [q.summary, itemSummary(items)].filter(Boolean).join("\n"),
      // A note typed with the new items is added below her earlier one.
      ...(str(params.note) ? { note: [q.note, str(params.note)].filter(Boolean).join("\n").slice(0, NOTE_MAX) } : {}),
      updatedBy: c.email,
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Change the day / COD-or-Pick-Up / note (the liver only while Requested;
 * Dispatch while Requested or Ready), or Dispatch's reply (staff only).
 */
export async function updatePulloutRequest(params: {
  id: string;
  date?: string;
  method?: PulloutMethod;
  note?: string;
  reply?: string;
  seenUpdatedAt?: string;
}): Promise<void> {
  const c = await caller();
  await withRequestLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    assertOwnLiver(c, q.liver);
    if (!isOpenRequest(q)) throw new Error(CHANGED);
    if (q.status !== "Requested" && !c.staff) throw new Error("Dispatch already prepared this request. Ask Dispatch to change it.");
    if (params.reply !== undefined && !c.staff) throw new Error("You don't have permission for this action.");
    const patch: Partial<Record<keyof typeof H, string>> = {};
    if (params.date !== undefined) {
      const d = isoDate(params.date);
      if (d !== q.date) { checkDay(d); patch.date = d; }
    }
    if (params.method !== undefined && method(params.method) !== q.method) patch.method = method(params.method);
    const note = str(params.note).slice(0, NOTE_MAX), reply = str(params.reply).slice(0, REPLY_MAX);
    if (params.note !== undefined && note !== q.note) patch.note = note;
    if (params.reply !== undefined && reply !== q.dispatchReply) patch.reply = reply;
    if (Object.keys(patch).length === 0) return;
    patch.updatedBy = c.email;
    patch.updatedAt = new Date().toISOString();
    await writeRequestCells(ws, row, q, patch);
  });
}

/**
 * Move a request along (PULLOUT_MOVES). The liver may only withdraw
 * (Cancelled) her own request while it is still Requested; Ready, back to
 * Requested and cancelling a Ready request are Dispatch's. Done goes through
 * completePulloutRequest ("Liver came").
 */
export async function setPulloutRequestStatus(params: {
  id: string;
  status: PulloutRequestStatus;
  /** Dispatch's reply to the liver, written in the same step (staff only). */
  reply?: string;
  seenUpdatedAt?: string;
}): Promise<void> {
  const c = await caller();
  const to = status(params.status);
  if (to !== params.status) throw new Error(CHANGED);
  if (to === "Done") throw new Error("Use “Liver came” to finish a request.");
  if (params.reply !== undefined && !c.staff) throw new Error("You don't have permission for this action.");
  await withRequestLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    if (!c.staff) {
      assertOwnLiver(c, q.liver);
      if (to !== "Cancelled" || q.status !== "Requested") {
        throw new Error("Dispatch already prepared this request. Ask Dispatch to change it.");
      }
    }
    if (!PULLOUT_MOVES[q.status].includes(to)) throw new Error(CHANGED);
    const patch: Partial<Record<keyof typeof H, string>> = {
      status: to,
      updatedBy: c.email,
      updatedAt: new Date().toISOString(),
    };
    if (params.reply !== undefined) patch.reply = str(params.reply).slice(0, REPLY_MAX);
    await writeRequestCells(ws, row, q, patch);
  });
}

/** The Database row(s) a request key points at ("#<row>" only while that row still has no key). */
function rowsForKey(k: string, byKey: Map<string, DatabaseRowType[]>, records: DatabaseRowType[]): DatabaseRowType[] {
  if (isRealItemKey(k)) return byKey.get(k) ?? [];
  const n = Number(k.slice(1));
  return records.filter((r) => r.id === n && !str(r.rowKey));
}

/** What "Liver came" would do to each item of the request, from the sheet as it is now. */
function planLiverCame(q: PulloutRequest, records: DatabaseRowType[]): LiverCamePlan {
  const byKey = rowsByKey(records);
  const statuses = records.map((r) => str(r.status));
  const plan: LiverCamePlan = { moves: [], skipped: [], missing: 0, total: 0 };
  for (const k of Array.from(new Set(q.itemKeys))) {
    plan.total++;
    const rows = rowsForKey(k, byKey, records);
    const mine = rows.filter((r) => liverKey(r.liverName) === liverKey(q.liver));
    if (mine.length === 0) { plan.missing++; continue; }
    if (rows.length > 1) { plan.skipped.push({ key: k, summary: itemLine(mine[0]), reason: "two rows share this ID" }); continue; }
    const r = mine[0];
    // Only items still waiting to be pulled out: never undo a cancel, a shipment or a delivery.
    if (!isToPullOut(r)) { plan.skipped.push({ key: k, summary: itemLine(r), reason: r.status || "no status" }); continue; }
    plan.moves.push({ key: k, rowId: r.id, summary: itemLine(r), from: str(r.status), to: liverCameStatus(r, q.method, statuses) });
  }
  return plan;
}

/** The sheet column that holds Status (the tenant's alias when it has one). */
function statusHeader(headers: Set<string> | undefined, aliases: Record<string, string[]>): string {
  return Object.keys(databaseRecordToRow({ status: "" }, headers, aliases))[0] ?? DATABASE_HEADERS.status;
}

/**
 * "Liver came": move the request's items that are still waiting to be pulled
 * out (For COD / For Pick Up for local items, their own box for international
 * and reseller items) and mark the request Done, in one step. dryRun returns
 * the plan without writing, for Dispatch's confirm. expectMoves refuses when
 * the items changed since that confirm.
 */
export async function completePulloutRequest(params: {
  id: string;
  dryRun?: boolean;
  expectMoves?: number;
  seenUpdatedAt?: string;
}): Promise<LiverCamePlan> {
  const email = (await requireRole(STAFF_ROLES)) ?? (await getSessionEmail()) ?? "";
  return withRequestLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    if (q.status !== "Ready") throw new Error(CHANGED);
    const db = await readDatabase();
    const plan = planLiverCame(q, db.records);
    if (params.dryRun) return plan;
    if (params.expectMoves !== undefined && params.expectMoves !== plan.moves.length) {
      throw new Error("Some items changed a moment ago. Refresh and try again.");
    }
    const now = new Date().toISOString();
    if (plan.moves.length) {
      const byId = new Map(db.records.map((r) => [r.id, r]));
      const statusCol = statusHeader(db.headers, db.aliases);
      // These are all "waiting to go out" statuses, so no Dispatch / Delivered
      // date is stamped (same as autoStageDates).
      await writeRowsByCells(db.sheet, plan.moves.map((m) => {
        const r = byId.get(m.rowId)!;
        return {
          rowNumber: r.id,
          rowKey: str(r.rowKey) || undefined,
          patch: databaseRecordToRow({
            status: m.to,
            auditTrail: appendAudit(r.auditTrail, `${now} | ${email || "unknown"} | Updated: status (Liver came, ${q.id})`),
          }, db.headers, db.aliases),
          expect: { [statusCol]: str(r.status) },
        };
      }));
      invalidateActiveRows();
    }
    // Stamped after the item writes, so a sheet read that started before them
    // never counts as newer than this Done (finishedAfterLoad).
    await writeRequestCells(ws, row, q, { status: "Done", updatedBy: email, updatedAt: new Date().toISOString() });
    return plan;
  });
}

const UNDO_WINDOW_MS = 15 * 60_000;

/** Undo "Liver came" shortly after: items back to where they were, request back to Ready. */
export async function undoCompletePulloutRequest(params: { id: string; moves: LiverCameMove[] }): Promise<{ restored: number; skipped: number }> {
  const email = (await requireRole(STAFF_ROLES)) ?? (await getSessionEmail()) ?? "";
  return withRequestLock(async () => {
    const { ws, row, q } = await findFresh(params.id);
    if (q.status !== "Done") throw new Error(CHANGED);
    const at = Date.parse(q.updatedAt);
    if (!Number.isFinite(at) || Date.now() - at > UNDO_WINDOW_MS) {
      throw new Error("Too late to undo. Change the items' status by hand.");
    }
    const db = await readDatabase();
    const byKey = rowsByKey(db.records);
    const statusCol = statusHeader(db.headers, db.aliases);
    const now = new Date().toISOString();
    const writes: Parameters<typeof writeRowsByCells>[1] = [];
    let skipped = 0;
    for (const m of params.moves ?? []) {
      const rows = q.itemKeys.includes(m.key) ? rowsForKey(m.key, byKey, db.records) : [];
      const r = rows.length === 1 && liverKey(rows[0].liverName) === liverKey(q.liver) ? rows[0] : null;
      // Only items still where "Liver came" put them, going back to a pullout status.
      if (!r || str(r.status) !== m.to || !isToPullOut({ status: m.from })) { skipped++; continue; }
      writes.push({
        rowNumber: r.id,
        rowKey: str(r.rowKey) || undefined,
        patch: databaseRecordToRow({
          status: m.from,
          auditTrail: appendAudit(r.auditTrail, `${now} | ${email || "unknown"} | Updated: status (Undo Liver came, ${q.id})`),
        }, db.headers, db.aliases),
        expect: { [statusCol]: str(r.status) },
      });
    }
    if (writes.length) {
      await writeRowsByCells(db.sheet, writes);
      invalidateActiveRows();
    }
    await writeRequestCells(ws, row, q, { status: "Ready", updatedBy: email, updatedAt: now });
    return { restored: writes.length, skipped };
  });
}

/**
 * Give the liver's own rows that have no Row Key one (as Fix Row Keys does),
 * so a request never tracks an item by its row number. Only empty keys on
 * rows that still match what her screen shows.
 */
export async function ensurePulloutRowKeys(params: {
  liver: string;
  rows: { rowId: number; minerName?: string; itemDescription?: string }[];
}): Promise<Record<number, string>> {
  const c = await caller();
  const liver = liverKey(params.liver);
  assertOwnLiver(c, liver);
  if (params.rows.length > 200) throw new Error("Tick fewer items at a time.");
  const db = await readDatabase();
  if (db.headers && !db.headers.has(DATABASE_HEADERS.rowKey)) {
    throw new Error(`This sheet has no "${DATABASE_HEADERS.rowKey}" column yet — ask the admin to run Fix Row Keys.`);
  }
  const norm = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, " ");
  const byId = new Map(db.records.map((r) => [r.id, r]));
  const out: Record<number, string> = {};
  const writes: Parameters<typeof writeRowsByCells>[1] = [];
  for (const p of params.rows) {
    const r = byId.get(p.rowId);
    if (!r || liverKey(r.liverName) !== liver || norm(r.minerName) !== norm(p.minerName) || norm(r.itemDescription) !== norm(p.itemDescription)) {
      throw new Error("Your list is out of date. Refresh and try again.");
    }
    if (str(r.rowKey)) { out[p.rowId] = str(r.rowKey); continue; }
    const key = newRowKey();
    out[p.rowId] = key;
    writes.push({
      rowNumber: r.id,
      patch: { [DATABASE_HEADERS.rowKey]: key },
      // Still the same item, still without a key, when the write happens.
      expect: {
        ...databaseRecordToRow({ minerName: r.minerName, itemDescription: r.itemDescription }, db.headers, db.aliases),
        [DATABASE_HEADERS.rowKey]: "",
      },
    });
  }
  if (writes.length) {
    await writeRowsByCells(db.sheet, writes);
    invalidateActiveRows();
  }
  return out;
}
