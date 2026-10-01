"use server";

import type { GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveDoc, getActiveWorksheet } from "./tenant-context";
import { requireSession, getSessionRoles } from "./authz";
import { getSessionEmail, isDeveloper } from "./tenancy-core";
import { ROLES_HEADERS } from "./sheet-config";
import type {
  PulloutMethod,
  PulloutRequest,
  PulloutRequestInput,
  PulloutRequestStatus,
} from "@/lib/pulloutRequests";

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
} as const;

/** Roles that work requests for every liver (prepare, Ready, Done). */
const STAFF_ROLES = ["super_admin", "admin", "dispatch"];
/** Roles that may also view every liver's tab (and request on their behalf). */
const VIEW_ALL_ROLES = [...STAFF_ROLES, "bossing", "accounts"];

let inflight: Promise<GoogleSpreadsheetWorksheet> | null = null;

async function getTab(): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getActiveDoc();
  const headers = Object.values(H);
  const existing = doc.sheetsByTitle[TAB];
  if (existing) {
    await existing.loadHeaderRow().catch(() => undefined);
    const have = new Set(existing.headerValues ?? []);
    const missing = headers.filter((h) => !have.has(h));
    if (missing.length && existing.headerValues?.length) {
      await existing.setHeaderRow([...existing.headerValues, ...missing]);
    }
    return existing;
  }
  if (inflight) return inflight;
  inflight = doc.addSheet({ title: TAB, headerValues: headers })
    .catch(async (err) => {
      // Created a moment ago from another PC/server: reload the tab list and use it.
      if (/already exists/i.test(String(err?.message ?? err))) {
        await doc.loadInfo();
        const t = doc.sheetsByTitle[TAB];
        if (t) return t;
      }
      throw err;
    })
    .finally(() => { inflight = null; });
  return inflight;
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

function toRequest(r: { get: (h: string) => unknown }): PulloutRequest {
  return {
    id: str(r.get(H.id)),
    liver: str(r.get(H.liver)).toUpperCase(),
    date: isoDate(r.get(H.date)),
    method: method(r.get(H.method)),
    itemKeys: str(r.get(H.items)).split(",").map((k) => k.trim()).filter(Boolean),
    summary: str(r.get(H.summary)),
    note: str(r.get(H.note)),
    status: status(r.get(H.status)),
    requestedBy: str(r.get(H.requestedBy)),
    requestedAt: str(r.get(H.requestedAt)),
    updatedBy: str(r.get(H.updatedBy)),
    updatedAt: str(r.get(H.updatedAt)),
  };
}

/** Who is calling: staff can act for any liver; a liver only for their own name. */
async function caller(): Promise<{ email: string; staff: boolean; viewAll: boolean; liverName: string }> {
  const sessionEmail = await requireSession();
  const email = sessionEmail ?? (await getSessionEmail()) ?? "";
  // DISABLE_SERVER_AUTHZ=true (requireSession returned null) ⇒ no checks.
  if (sessionEmail === null || isDeveloper(email)) return { email, staff: true, viewAll: true, liverName: "" };
  const roles = await getSessionRoles();
  let liverName = "";
  try {
    const rows = await (await getActiveWorksheet("roles")).getRows();
    const me = rows.find((r) => str(r.get(ROLES_HEADERS.email)).toLowerCase() === email.toLowerCase());
    liverName = str(me?.get(ROLES_HEADERS.name)).toUpperCase();
  } catch { /* no Roles tab — no liver name */ }
  return {
    email,
    staff: roles.some((r) => STAFF_ROLES.includes(r)),
    viewAll: roles.some((r) => VIEW_ALL_ROLES.includes(r)),
    liverName,
  };
}

function assertOwnLiver(c: Awaited<ReturnType<typeof caller>>, liver: string) {
  if (c.viewAll) return;
  if (!c.liverName || c.liverName !== liver.toUpperCase().trim()) {
    throw new Error("You can only make pullout requests for your own items.");
  }
}

function newId(): string {
  return `PR-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function cleanInput(input: PulloutRequestInput) {
  const date = isoDate(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick the day you will pull out the items.");
  const keys = input.itemKeys.map((k) => str(k).replace(/,/g, "")).filter(Boolean);
  if (keys.length === 0) throw new Error("Tick at least one item.");
  return {
    liver: str(input.liver).toUpperCase(),
    date,
    method: method(input.method),
    keys,
    summary: str(input.summary),
    note: str(input.note),
  };
}

/** Requests for one liver, or for everyone (staff only) when no liver is given. */
export async function getPulloutRequests(params?: { liver?: string }): Promise<PulloutRequest[]> {
  const c = await caller();
  const liver = str(params?.liver).toUpperCase();
  if (!liver && !c.viewAll) throw new Error("You don't have permission for this action.");
  if (liver) assertOwnLiver(c, liver);
  const rows = await (await getTab()).getRows();
  return rows
    .map(toRequest)
    .filter((q) => q.id && (!liver || q.liver === liver))
    .sort((a, b) => (a.date === b.date ? a.requestedAt.localeCompare(b.requestedAt) : a.date.localeCompare(b.date)));
}

export async function createPulloutRequest(params: { input: PulloutRequestInput }): Promise<PulloutRequest> {
  const c = await caller();
  const v = cleanInput(params.input);
  if (!v.liver) throw new Error("No liver name.");
  assertOwnLiver(c, v.liver);
  const ws = await getTab();
  // An item can be in only one open request at a time.
  const open = (await ws.getRows()).map(toRequest).filter((q) => q.status === "Requested" || q.status === "Ready");
  const taken = new Set(open.flatMap((q) => q.itemKeys));
  if (v.keys.some((k) => taken.has(k))) throw new Error("Some of these items were already requested. Refresh and try again.");
  const now = new Date().toISOString();
  const req: PulloutRequest = {
    id: newId(),
    liver: v.liver,
    date: v.date,
    method: v.method,
    itemKeys: v.keys,
    summary: v.summary,
    note: v.note,
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
  }, { raw: true });
  return req;
}

async function findRow(id: string) {
  const ws = await getTab();
  const row = (await ws.getRows()).find((r) => str(r.get(H.id)) === id);
  if (!row) throw new Error("That request no longer exists. Refresh and try again.");
  return row;
}

/** The liver changes the day / COD-or-Pick-Up / note — only while not yet Ready. */
export async function updatePulloutRequest(params: {
  id: string;
  date?: string;
  method?: PulloutMethod;
  note?: string;
}): Promise<void> {
  const c = await caller();
  const row = await findRow(params.id);
  const q = toRequest(row);
  assertOwnLiver(c, q.liver);
  if (q.status !== "Requested" && !c.staff) throw new Error("Dispatch already prepared this request. Ask Dispatch to change it.");
  if (params.date !== undefined) {
    const d = isoDate(params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Pick the day you will pull out the items.");
    row.set(H.date, d);
  }
  if (params.method !== undefined) row.set(H.method, method(params.method));
  if (params.note !== undefined) row.set(H.note, str(params.note));
  row.set(H.updatedBy, c.email);
  row.set(H.updatedAt, new Date().toISOString());
  await row.save({ raw: true });
}

/**
 * Move a request along. The liver may only withdraw (Cancelled) their own
 * request while it is still Requested; Ready / Done / back to Requested are
 * Dispatch's.
 */
export async function setPulloutRequestStatus(params: { id: string; status: PulloutRequestStatus }): Promise<void> {
  const c = await caller();
  const row = await findRow(params.id);
  const q = toRequest(row);
  if (!c.staff) {
    assertOwnLiver(c, q.liver);
    if (params.status !== "Cancelled" || q.status !== "Requested") {
      throw new Error("Dispatch already prepared this request. Ask Dispatch to change it.");
    }
  }
  row.set(H.status, status(params.status));
  row.set(H.updatedBy, c.email);
  row.set(H.updatedAt, new Date().toISOString());
  await row.save({ raw: true });
}
