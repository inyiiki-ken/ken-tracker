"use server";

import type { GoogleSpreadsheetRow, GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveDoc, invalidateActiveRows } from "./tenant-context";
import { getAppTab } from "./appTabs";
import { requireRole, getSessionAccess } from "./authz";
import { getSessionEmail } from "./tenancy-core";
import { databaseRecordToRow } from "./row-mapper";
import { DATABASE_HEADERS } from "./sheet-config";
import { readDatabase, writeRowsByCells, appendAudit } from "./recordStore";
import type { DatabaseRowType } from "@/types";
import { autoStageDates, fulfilmentStage } from "@/lib/fulfilment";
import { isRealItemKey, itemLine, itemSummary, liverKey } from "@/lib/pulloutRequests";
import {
  DELIVERED_STATUS, deliveryKindOf, isConfirmStatus, isOpenReport, parseCash,
} from "@/lib/deliveryReports";
import type { DeliveryKind, DeliveryReport, DeliveryReportInput, DeliveryReportStatus } from "@/lib/deliveryReports";

/**
 * Delivery reports live in an app-owned "Delivery Reports" tab, auto-created in
 * the ACTIVE customer's own sheet on first use (like Pullout Requests). Rows
 * are never removed.
 */

const TAB = "Delivery Reports";

const H = {
  id: "Report ID",
  liver: "Liver",
  kind: "Type",
  items: "Item Keys",
  summary: "Items",
  cash: "Cash Collected (AED)",
  note: "Note",
  status: "Status",
  reply: "Dispatch Reply",
  reportedBy: "Reported By",
  reportedAt: "Reported At",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
} as const;

/** Roles that confirm / reject reports (same as pullout requests). */
const STAFF_ROLES = ["super_admin", "admin", "dispatch"];
/** Roles that may view every liver's reports (and report on her behalf). */
const VIEW_ALL_ROLES = [...STAFF_ROLES, "bossing", "accounts"];

const CHANGED = "This report changed — refresh.";
const MAX_CASH = 10_000_000;

function getTab(): Promise<GoogleSpreadsheetWorksheet> {
  return getAppTab(TAB, Object.values(H));
}

// Open screens poll; a short cache keeps that to one read per sheet every few seconds.
const rowsCache = new Map<string, { at: number; rows: GoogleSpreadsheetRow[] }>();
const ROWS_TTL_MS = 10_000;

async function readReports(fresh: boolean): Promise<{ ws: GoogleSpreadsheetWorksheet; rows: GoogleSpreadsheetRow[] }> {
  const ws = await getTab();
  const key = (await getActiveDoc()).spreadsheetId;
  const cached = rowsCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < ROWS_TTL_MS) return { ws, rows: cached.rows };
  const rows = await ws.getRows();
  rowsCache.set(key, { at: Date.now(), rows });
  return { ws, rows };
}

/** Serialises read-check-write on the tab, so two taps can't both pass the checks. */
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
/** Text exactly as typed: a value starting with "=" must not become a formula. */
function literal(v: string): string {
  return v.startsWith("=") ? ` ${v}` : v;
}
function kind(v: unknown): DeliveryKind {
  return /pick/i.test(str(v)) ? "Picked up" : "Delivered";
}
function status(v: unknown): DeliveryReportStatus {
  const s = str(v);
  return s === "Confirmed" || s === "Rejected" || s === "Withdrawn" ? s : "Reported";
}

function toReport(r: { get: (h: string) => unknown }): DeliveryReport {
  const cash = parseCash(r.get(H.cash));
  return {
    id: str(r.get(H.id)),
    liver: str(r.get(H.liver)).toUpperCase(),
    kind: kind(r.get(H.kind)),
    itemKeys: str(r.get(H.items)).split(",").map((k) => k.trim()).filter(Boolean),
    summary: str(r.get(H.summary)),
    cash: cash === null || Number.isNaN(cash) ? null : cash,
    note: str(r.get(H.note)),
    status: status(r.get(H.status)),
    dispatchReply: str(r.get(H.reply)),
    reportedBy: str(r.get(H.reportedBy)),
    reportedAt: str(r.get(H.reportedAt)),
    updatedBy: str(r.get(H.updatedBy)),
    updatedAt: str(r.get(H.updatedAt)),
  };
}

type Caller = { email: string; viewAll: boolean; liverName: string };

async function caller(): Promise<Caller> {
  const a = await getSessionAccess();
  if (a.all) return { email: a.email || (await getSessionEmail()) || "", viewAll: true, liverName: "" };
  return {
    email: a.email,
    viewAll: a.roles.some((r) => VIEW_ALL_ROLES.includes(r)),
    liverName: liverKey(a.liverName),
  };
}

function assertOwnLiver(c: Caller, liver: string) {
  if (c.viewAll) return;
  if (!c.liverName || c.liverName !== liverKey(liver)) {
    throw new Error("You can only report your own items.");
  }
}

function newId(): string {
  return `DR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

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

/** Read one report fresh (for a write), refusing when the caller's copy is out of date. */
async function findFresh(id: string, seenUpdatedAt?: string) {
  const { ws, rows } = await readReports(true);
  const row = rows.find((r) => str(r.get(H.id)) === id);
  if (!row) throw new Error("That report no longer exists. Refresh and try again.");
  const q = toReport(row);
  if (seenUpdatedAt !== undefined && seenUpdatedAt !== q.updatedAt) throw new Error(CHANGED);
  return { ws, row, q };
}

/** Write only the given cells of one report row, checking nobody changed it first. Call inside withLock. */
async function writeReportCells(
  ws: GoogleSpreadsheetWorksheet,
  row: GoogleSpreadsheetRow,
  q: DeliveryReport,
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
  for (const [k, v] of Object.entries(patch)) {
    const c = cell(H[k as keyof typeof H]);
    if (c) c.value = literal(String(v ?? ""));
  }
  await ws.saveUpdatedCells();
  rowsCache.clear();
}

/** Reports for one liver, or for everyone (staff and bosses) when no liver is given. */
export async function getDeliveryReports(params?: { liver?: string }): Promise<DeliveryReport[]> {
  const c = await caller();
  const liver = liverKey(params?.liver);
  if (!liver && !c.viewAll) throw new Error("You don't have permission for this action.");
  if (liver) assertOwnLiver(c, liver);
  const { rows } = await readReports(false);
  return rows
    .map(toReport)
    .filter((q) => q.id && (!liver || liverKey(q.liver) === liver))
    .sort((a, b) => a.reportedAt.localeCompare(b.reportedAt));
}

/**
 * The liver reports her items Delivered (For COD) / Picked up (For Pick Up).
 * Checked against the sheet as it is now: her own items, all of that kind, in
 * no other open report.
 */
export async function createDeliveryReport(params: { input: DeliveryReportInput }): Promise<DeliveryReport> {
  const c = await caller();
  const liver = liverKey(params.input.liver);
  if (!liver) throw new Error("No liver name.");
  assertOwnLiver(c, liver);
  const k = kind(params.input.kind);
  const keys = Array.from(new Set((params.input.itemKeys ?? []).map((x) => str(x).replace(/,/g, "")).filter(Boolean)));
  if (keys.length === 0) throw new Error("Tick at least one item.");
  if (keys.length > 100) throw new Error("Tick fewer items at a time.");
  const cash = k === "Delivered" ? parseCash(params.input.cash) : null;
  if (cash !== null && (Number.isNaN(cash) || cash > MAX_CASH)) throw new Error("Type the cash as a number, e.g. 1250.");
  const note = str(params.input.note).slice(0, 500);

  return withLock(async () => {
    const { ws, rows } = await readReports(true);
    const taken = new Set<string>();
    for (const q of rows.map(toReport)) if (isOpenReport(q)) for (const x of q.itemKeys) taken.add(x);
    const { records } = await readDatabase();
    const byKey = rowsByKey(records);
    const problems: string[] = [];
    const items: DatabaseRowType[] = [];
    for (const key of keys) {
      if (!isRealItemKey(key)) { problems.push("An item has no ID yet"); continue; }
      const found = byKey.get(key) ?? [];
      const mine = found.filter((r) => liverKey(r.liverName) === liver);
      if (mine.length === 0) { problems.push("An item is no longer in your list"); continue; }
      if (found.length > 1) { problems.push(`Two rows share one ID (${itemLine(mine[0])}) — ask the admin to fix the Row Key`); continue; }
      const r = mine[0];
      if (deliveryKindOf(r) !== k) { problems.push(`Now ${r.status || "no status"}: ${itemLine(r)}`); continue; }
      if (taken.has(key)) { problems.push(`Already reported: ${itemLine(r)}`); continue; }
      items.push(r);
    }
    if (problems.length) {
      const more = problems.length > 3 ? ` · and ${problems.length - 3} more` : "";
      throw new Error(`${problems.slice(0, 3).join(" · ")}${more}. Refresh and try again.`);
    }
    const now = new Date().toISOString();
    const q: DeliveryReport = {
      id: newId(),
      liver,
      kind: k,
      itemKeys: keys,
      summary: itemSummary(items),
      cash,
      note,
      status: "Reported",
      dispatchReply: "",
      reportedBy: c.email,
      reportedAt: now,
      updatedBy: c.email,
      updatedAt: now,
    };
    await ws.addRow({
      [H.id]: q.id,
      [H.liver]: q.liver,
      [H.kind]: q.kind,
      [H.items]: q.itemKeys.join(","),
      [H.summary]: q.summary,
      [H.cash]: q.cash === null ? "" : String(q.cash),
      [H.note]: q.note,
      [H.status]: q.status,
      [H.reply]: "",
      [H.reportedBy]: q.reportedBy,
      [H.reportedAt]: q.reportedAt,
      [H.updatedBy]: q.updatedBy,
      [H.updatedAt]: q.updatedAt,
    }, { raw: true }); // raw: a note starting with "=" stays text
    rowsCache.clear();
    return q;
  });
}

/** The liver takes back her report (a wrong tap) while Dispatch hasn't answered it. */
export async function withdrawDeliveryReport(params: { id: string; seenUpdatedAt?: string }): Promise<void> {
  const c = await caller();
  await withLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    assertOwnLiver(c, q.liver);
    if (!isOpenReport(q)) throw new Error("Dispatch already answered this report.");
    await writeReportCells(ws, row, q, { status: "Withdrawn", updatedBy: c.email, updatedAt: new Date().toISOString() });
  });
}

/** Dispatch rejects a report; the liver sees the reason and may report again. */
export async function rejectDeliveryReport(params: { id: string; reason: string; seenUpdatedAt?: string }): Promise<void> {
  const email = (await requireRole(STAFF_ROLES)) ?? (await getSessionEmail()) ?? "";
  const reason = str(params.reason).slice(0, 300);
  if (!reason) throw new Error("Write a reason so the liver knows why.");
  await withLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    if (!isOpenReport(q)) throw new Error(CHANGED);
    await writeReportCells(ws, row, q, { status: "Rejected", reply: reason, updatedBy: email, updatedAt: new Date().toISOString() });
  });
}

/** The sheet column that holds Status (the tenant's alias when it has one). */
function statusHeader(headers: Set<string> | undefined, aliases: Record<string, string[]>): string {
  return Object.keys(databaseRecordToRow({ status: "" }, headers, aliases))[0] ?? DATABASE_HEADERS.status;
}

/**
 * Dispatch confirms a report in one tap: the items that are still For COD /
 * For Pick Up get Delivered (COD) or pickedUpStatus (pick-up; the client sends
 * "Picked Up" when Dispatch's status list has it), the Delivered date is
 * stamped as autoStageDates does, and a change-history line names the report
 * and the cash collected. Payment columns are never touched.
 */
export async function confirmDeliveryReport(params: {
  id: string;
  pickedUpStatus?: string;
  seenUpdatedAt?: string;
}): Promise<{ moved: number; to: string; skipped: { summary: string; reason: string }[] }> {
  const email = (await requireRole(STAFF_ROLES)) ?? (await getSessionEmail()) ?? "";
  const picked = str(params.pickedUpStatus);
  if (picked && !isConfirmStatus(picked)) throw new Error("Pick-up status must be Picked Up or Delivered.");
  return withLock(async () => {
    const { ws, row, q } = await findFresh(params.id, params.seenUpdatedAt);
    if (!isOpenReport(q)) throw new Error(CHANGED);
    const to = q.kind === "Picked up" ? picked || DELIVERED_STATUS : DELIVERED_STATUS;
    const db = await readDatabase();
    const byKey = rowsByKey(db.records);
    const statusCol = statusHeader(db.headers, db.aliases);
    const now = new Date().toISOString();
    const cash = q.cash === null ? "" : `, cash collected AED ${q.cash}${q.itemKeys.length > 1 ? ` for ${q.itemKeys.length} items` : ""}`;
    const skipped: { summary: string; reason: string }[] = [];
    let alreadyDelivered = 0;
    const writes: Parameters<typeof writeRowsByCells>[1] = [];
    for (const key of Array.from(new Set(q.itemKeys))) {
      const found = byKey.get(key) ?? [];
      const mine = found.filter((r) => liverKey(r.liverName) === liverKey(q.liver));
      if (mine.length === 0) { skipped.push({ summary: key, reason: "not found" }); continue; }
      if (found.length > 1) { skipped.push({ summary: itemLine(mine[0]), reason: "two rows share this ID" }); continue; }
      const r = mine[0];
      // Only items still in the box she reported from: never undo a cancel or a courier.
      if (deliveryKindOf(r) !== q.kind) {
        if (fulfilmentStage(r.status) === "delivered") alreadyDelivered++;
        skipped.push({ summary: itemLine(r), reason: r.status || "no status" });
        continue;
      }
      const stamps = autoStageDates(r, to, now);
      const fields = ["status", ...Object.keys(stamps)].join(", ");
      writes.push({
        rowNumber: r.id,
        rowKey: str(r.rowKey) || undefined,
        patch: databaseRecordToRow({
          status: to,
          ...stamps,
          auditTrail: appendAudit(r.auditTrail, `${now} | ${email || "unknown"} | Updated: ${fields} (${q.kind} reported by ${q.liver}, ${q.id}${cash})`),
        }, db.headers, db.aliases),
        expect: { [statusCol]: str(r.status) },
      });
    }
    // Dispatch set them Delivered by hand already: just close the report.
    if (writes.length === 0 && alreadyDelivered === skipped.length) {
      await writeReportCells(ws, row, q, { status: "Confirmed", updatedBy: email, updatedAt: now });
      return { moved: 0, to, skipped };
    }
    if (writes.length === 0) {
      const why = Array.from(new Set(skipped.map((s) => s.reason))).join(", ");
      throw new Error(`None of these items can be set to ${to} (${why}). Reject the report with a reason instead.`);
    }
    await writeRowsByCells(db.sheet, writes);
    invalidateActiveRows();
    await writeReportCells(ws, row, q, { status: "Confirmed", updatedBy: email, updatedAt: now });
    return { moved: writes.length, to, skipped };
  });
}
