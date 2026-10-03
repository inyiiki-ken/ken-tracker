"use server";

import { getSpreadsheetById } from "./client";
import { getActiveDoc, getActiveWorksheet, getActiveRows, invalidateActiveRows } from "./tenant-context";
import { readConfig, writeConfig, readConfigByPrefix, deleteConfigMarker, readConfigChunks, writeConfigChunks, clearConfigChunks } from "./config-store";
import { parseSheetId } from "./sheetId";
import { requireSession, requireRole, getSessionRoles, getSessionAccess } from "./authz";
import { isDeveloper } from "./tenancy-core";
import { rowToDatabaseRecord, databaseRecordToRow } from "./row-mapper";
import { activeHeaderSet, ensureOptionalColumns, writeRowsByCells, withSheetWriteLock, getTenantColumnAliases, newRowKey, auditHeader, appendAudit } from "./recordStore";
import { DATABASE_HEADERS, DATABASE_HEADER_ALIASES, OPTIONAL_DATABASE_KEYS, ROLES_HEADERS, UPLOADS_HEADERS } from "./sheet-config";
import type { DatabaseRowType } from "@/types";
import { buildCustomerIdIndex, resolveCustomerIdFor, customerKey } from "@/lib/customerId";
import { codeKey } from "@/lib/orderCode";
import { isLiverOnly, getUserRole } from "@/config/roles";
import { customerKey as rowCustomerKey, parseDateRobust } from "@/lib/calculations";
import { newestPurchaseRawByCustomer } from "@/lib/purchaseDates";
import { boxStatusName, ownBox } from "@/lib/pulloutTargets";
import { customersEverWithOtherLivers, customersWithOtherLivers, sharedShippingCarriers } from "@/lib/liverMoney";


/**
 * Every function below is a direct port of the real src/api/*.ts endpoints
 * from your AR_Tracker export (which used Zite's internal Database/Uploads/
 * Roles tables) -- adapted to hit Google Sheets via google-spreadsheet
 * instead of Zite's backend SDK, but matching the exact same behavior:
 * audit trail formatting, merge-by-customerId (not by name), invoice number
 * format, and where rates config actually gets stored.
 */

// ---------- Connection / header verification ----------

export interface TabHeaderCheck {
  tab: string;
  found: boolean;
  /** Expected headers (from the code mapping) missing in row 1 of the sheet. */
  missing: string[];
  /** Headers present in the sheet that the code mapping doesn't reference. */
  extra: string[];
  sheetHeaders: string[];
}

export interface ConnectionCheckResult {
  ok: boolean;
  title: string;
  sheetCount: number;
  tabs: TabHeaderCheck[];
  error?: string;
}

/**
 * One-shot health check: confirms the service account can reach the sheet and
 * that row-1 headers on the Database/Uploads/Roles tabs match the mapping the
 * app writes by. Because writes are keyed on header TEXT, any drift here means
 * data silently lands in the wrong column -- this surfaces it explicitly.
 */
export async function verifyConnectionAndHeaders(
  params?: { sheetIdOrUrl?: string }
): Promise<ConnectionCheckResult> {
  const expected: Record<string, { title: string; headers: Record<string, string> }> = {
    database: {
      title: "Database",
      headers: Object.fromEntries(Object.entries(DATABASE_HEADERS).filter(([k]) => !OPTIONAL_DATABASE_KEYS.has(k))),
    },
    uploads: { title: "Uploads", headers: UPLOADS_HEADERS },
    roles: { title: "Roles", headers: ROLES_HEADERS },
  };

  const overrideId = params?.sheetIdOrUrl ? parseSheetId(params.sheetIdOrUrl) : "";

  try {
    const doc = overrideId ? await getSpreadsheetById(overrideId) : await getActiveDoc();
    const tabs: TabHeaderCheck[] = [];

    for (const tabKey of Object.keys(expected) as (keyof typeof expected)[]) {
      const expectedHeaders = Object.values(expected[tabKey].headers);
      try {
        // Resolve the tab by title (works for any sheet, not just the env one).
        const ws = doc.sheetsByTitle[expected[tabKey].title];
        if (!ws) throw new Error("tab not found");
        await ws.loadHeaderRow().catch(() => undefined);
        const sheetHeaders = (ws.headerValues ?? []).map((h) => String(h).trim());
        const sheetSet = new Set(sheetHeaders.map((h) => h.toLowerCase()));
        const expectedSet = new Set(expectedHeaders.map((h) => h.toLowerCase()));

        tabs.push({
          tab: tabKey,
          found: true,
          missing: expectedHeaders.filter((h) => !sheetSet.has(h.toLowerCase())),
          extra: sheetHeaders.filter((h) => h && !expectedSet.has(h.toLowerCase())),
          sheetHeaders,
        });
      } catch {
        tabs.push({ tab: tabKey, found: false, missing: expectedHeaders, extra: [], sheetHeaders: [] });
      }
    }

    const ok = tabs.every((t) => t.found && t.missing.length === 0);
    return { ok, title: doc.title, sheetCount: doc.sheetCount, tabs };
  } catch (err) {
    return {
      ok: false,
      title: "",
      sheetCount: 0,
      tabs: [],
      error: err instanceof Error ? err.message : "Unknown connection error",
    };
  }
}

// ---------- Dynamic dropdown options (DATA'S tab) ----------

export interface DataOptions {
  itemDescriptions: string[];
  currencies: string[];
  categories: string[];
  sources: string[];
  tog: string[];
  livers: string[];
  pages: string[];
}

/** Header text -> DataOptions key. Matched case-insensitively by "contains". */
const DATA_OPTION_COLUMNS: { key: keyof DataOptions; match: string[] }[] = [
  { key: "itemDescriptions", match: ["item description", "description"] },
  { key: "currencies", match: ["currency"] },
  { key: "categories", match: ["category"] },
  { key: "sources", match: ["source"] },
  { key: "tog", match: ["t.o.g", "tog"] },
  { key: "livers", match: ["liver"] },
  { key: "pages", match: ["page"] },
];

/**
 * Reads editable dropdown option lists from the "DATA'S" tab (the same
 * dropdown-source sheet used in the masterlist). Columns are located by their
 * header text, so column order can change freely. Returns empty arrays if the
 * tab is absent -- callers fall back to their built-in defaults.
 */
export async function getDataOptions(): Promise<DataOptions> {
  const empty: DataOptions = {
    itemDescriptions: [], currencies: [], categories: [], sources: [], tog: [], livers: [], pages: [],
  };

  try {
    const doc = await getActiveDoc();
    const candidates = ["DATA'S", "DATA’S", "DATAS", "DATA", "Options", "Dropdowns"];
    let ws = null;
    for (const name of candidates) {
      if (doc.sheetsByTitle[name]) { ws = doc.sheetsByTitle[name]; break; }
    }
    if (!ws) return empty;

    const rows = await ws.getCellsInRange(`A1:Z${ws.rowCount}`) as unknown[][] | undefined;
    // getCellsInRange may be undefined for empty sheets
    const grid: string[][] = (rows ?? []).map((r) => (r ?? []).map((c) => String(c ?? "").trim()));
    if (grid.length < 2) return empty;

    const header = grid[0];
    const colIndex: Partial<Record<keyof DataOptions, number>> = {};
    header.forEach((h, i) => {
      const hl = h.toLowerCase();
      for (const { key, match } of DATA_OPTION_COLUMNS) {
        if (colIndex[key] === undefined && match.some((m) => hl.includes(m))) {
          colIndex[key] = i;
        }
      }
    });

    const out: DataOptions = { ...empty };
    for (const { key } of DATA_OPTION_COLUMNS) {
      const ci = colIndex[key];
      if (ci === undefined) continue;
      const seen = new Set<string>();
      const vals: string[] = [];
      for (let r = 1; r < grid.length; r++) {
        const v = grid[r]?.[ci] ?? "";
        if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); vals.push(v); }
      }
      out[key] = vals;
    }
    return out;
  } catch {
    return empty;
  }
}

// ---------- Records (Database tab) ----------

/**
 * Roles that change records (create/update/bulk/split/merge/invoice number/
 * import). Admin, Dispatch (incl. "Liver came"), Accounts (Add Client) and
 * Live Sellers (live day). Developers always pass. Livers and Bossing only read.
 */
const RECORD_WRITE_ROLES = ["super_admin", "admin", "dispatch", "accounts", "livesellers"];

/** Same comparison the Liver tab uses for the Liver column (case/spaces ignored). */
function liverKey(v: unknown): string {
  return String(v ?? "").toUpperCase().trim().replace(/\s+/g, " ");
}

/** Crown's cost side — never sent to a liver. Prices are worked out from clientRate. */
const LIVER_HIDDEN_FIELDS = ["supplierRate", "profit", "goldRate", "mc"] as const;
/** Customer contact a liver may NOT see (owner decision: FB name and phone yes, address no). */
const LIVER_HIDDEN_CONTACT = ["clientAddress"] as const;

/** Every history line's "who", and any other email in it, that isn't `me` becomes "staff". */
function redactAuditEmails(trail: string, me: string): string {
  const mine = me.toLowerCase().trim();
  const other = (v: string) => v.toLowerCase().trim() !== mine;
  return trail
    .split("\n")
    .map((l) => l
      .replace(/^(\S+ \| )([^|]*?)( \|)/, (all, a: string, who: string, b: string) => (other(who) ? `${a}staff${b}` : all))
      .replace(/[^\s|\[\]()<>,;:]+@[^\s|\[\]()<>,;:]+/g, (e) => (other(e) ? "staff" : e)))
    .join("\n");
}

/**
 * The rows, and when the sheet was read (server clock): the Liver tab compares
 * it with Done requests / Confirmed reports (finishedAfterLoad), so the phone's
 * clock never decides whether her items are still moving.
 */
export async function getRecords(_params?: { tailOnly?: boolean }): Promise<{ records: DatabaseRowType[]; readAt: string }> {
  const access = await getSessionAccess();
  // Signed in but not in the Roles tab: nothing to show (the app says Access denied).
  if (!access.all && access.roles.length === 0) return { records: [], readAt: new Date().toISOString() };
  const sheet = await getActiveWorksheet("database");
  // Stamped before the read: a status written while the rows were being fetched
  // must count as after this snapshot, never before it.
  const readAt = new Date().toISOString();
  const rows = await sheet.getRows();
  const aliases = await getTenantColumnAliases();
  const all = rows.map((r) => rowToDatabaseRecord(r, aliases));
  if (access.all || !isLiverOnly(access.roles)) return { records: all, readAt };

  // A liver only ever gets her own items (her "name" in the Roles tab). No
  // name yet ⇒ nothing; the Liver tab explains what to ask the admin.
  const me = liverKey(access.liverName);
  if (!me) return { records: [], readAt };
  // Her customers may also buy from other livers; reminders count from the
  // customer's newest purchase, so stamp that on her rows before dropping the rest.
  const newest = newestPurchaseRawByCustomer(all);
  // Customers who also have open items from another liver: her rows alone
  // can't give their balance, and the server can't work it out for her (prices
  // need the browser's rates). Ever bought from another liver: no loyalty count.
  const shared = customersWithOtherLivers(all, me);
  // ...except the shipping fee: one open COD item across all their livers carries it.
  const carriers = sharedShippingCarriers(all, shared);
  const everShared = customersEverWithOtherLivers(all, me);
  // Where "Liver came" sends her international / reseller items, named from
  // every row like Dispatch's (her own rows may spell the box differently).
  const statuses = all.map((r) => String(r.status ?? ""));
  const boxNames = { intl: boxStatusName("intl", statuses), reseller: boxStatusName("reseller", statuses) };
  const records = all
    .filter((r) => liverKey(r.liverName) === me)
    .map((r) => {
      const out: DatabaseRowType = { ...r };
      for (const k of LIVER_HIDDEN_FIELDS) delete out[k];
      // Only whether an address is on file, so her "Missing: address" hint still works.
      out.hasClientAddress = !!String(r.clientAddress ?? "").trim();
      for (const k of LIVER_HIDDEN_CONTACT) delete out[k];
      // Change history keeps its dates and text (reminders and stage dates read
      // them) but not other people's emails: "<ISO> | <email> | <change>".
      if (out.auditTrail) out.auditTrail = redactAuditEmails(String(out.auditTrail), access.email);
      const last = newest.get(rowCustomerKey(r));
      if (last) out.customerLastPurchaseAt = last;
      if (shared.has(rowCustomerKey(r))) out.customerHasOtherLivers = true;
      const fee = carriers.get(r.id);
      if (fee) out.sharedShippingFrom = fee;
      if (everShared.has(rowCustomerKey(r))) out.customerBoughtFromOtherLivers = true;
      const box = ownBox(r);
      if (box) out.ownBoxStatus = boxNames[box];
      return out;
    });
  return { records, readAt };
}

/** Matches src/api/createRecord.ts: sets a "created" audit trail entry. */
export async function createRecord(params: {
  fields: Partial<DatabaseRowType>;
  userEmail?: string;
}): Promise<{ success: boolean }> {
  const sessionEmailForAudit = await requireRole(RECORD_WRITE_ROLES);
  const sheet = await getActiveWorksheet("database");
  const timestamp = new Date().toISOString();

  // Authoritative id assignment — same rule the masterlist import uses, so a
  // client added by hand and one imported from a file resolve identically.
  const fieldsWithId = { ...params.fields };
  if (!fieldsWithId.rowKey) fieldsWithId.rowKey = newRowKey();
  if (!fieldsWithId.customerId && fieldsWithId.minerName) {
    // Fresh read: a client added a moment ago (e.g. the same new client typed
    // twice in a row) must get the SAME id, not a second one.
    const index = await loadCustomerIdIndex(await getActiveRows("database", 0));
    fieldsWithId.customerId = resolveCustomerIdFor(String(fieldsWithId.minerName), index);
  }

  const row = {
    ...fieldsWithId,
    auditTrail: `${timestamp} | ${sessionEmailForAudit || params.userEmail || "unknown"} | Created`,
  };
  await sheet.addRow(databaseRecordToRow(row, await activeHeaderSet(sheet), await getTenantColumnAliases()));
  invalidateActiveRows();
  return { success: true };
}

/**
 * Matches src/api/updateRecord.ts exactly: appends a new audit trail line
 * (rather than overwriting), formatted "{ISO timestamp} | {email} | Updated: {field names}".
 */


export async function updateRecord(params: {
  rowId: number;
  fields: Partial<DatabaseRowType>;
  existingRecord?: Partial<DatabaseRowType>;
  userEmail?: string;
}): Promise<{ success: boolean }> {
  const sessionEmailForAudit = await requireRole(RECORD_WRITE_ROLES);
  const sheet = await getActiveWorksheet("database");

  const timestamp = new Date().toISOString();
  const auditEntry = `${timestamp} | ${sessionEmailForAudit || params.userEmail || "unknown"} | Updated: ${Object.keys(params.fields).join(", ")}`;
  // The history line is added to the sheet's current history, not the
  // screen's copy (which may miss lines written since it loaded).
  const { auditTrail: _ignored, ...fields } = params.fields;
  void _ignored;

  await ensureOptionalColumns(sheet, [{ ...fields, auditTrail: auditEntry }]);
  const headers = await activeHeaderSet(sheet);
  const aliases = await getTenantColumnAliases();
  const patchRow = databaseRecordToRow(fields, headers, aliases);
  const written = await writeRowsByCells(sheet, [
    { rowNumber: params.rowId, rowKey: params.existingRecord?.rowKey, patch: patchRow, audit: { header: auditHeader(headers, aliases), lines: [auditEntry] } },
  ]);
  if (written === 0) throw new Error(`No record found at row ${params.rowId}`);
  return { success: true };
}

/** Matches src/api/bulkUpdateRecords.ts: explicit {rowId, fields} pairs, capped at 10. */
export async function bulkUpdateRecords(params: {
  updates: { rowId: number; rowKey?: string; fields: Partial<DatabaseRowType> }[];
}): Promise<{ success: boolean; updatedCount: number }> {
  await requireRole(RECORD_WRITE_ROLES);
  const sheet = await getActiveWorksheet("database");
  await ensureOptionalColumns(sheet, params.updates.map((u) => u.fields));
  const dbHeaders = await activeHeaderSet(sheet);
  const dbAliases = await getTenantColumnAliases();
  // Was capped at 10 with one API write per row; now every row in the batch is
  // committed in a single request.
  const batch = params.updates.slice(0, 300);

  // A change history sent from the screen is merged into the sheet's current
  // one (its new lines added), so lines written since it loaded aren't lost.
  const historyCol = auditHeader(dbHeaders, dbAliases);
  const writes = batch.map((upd) => {
    const { auditTrail, ...fields } = upd.fields;
    return {
      rowNumber: upd.rowId,
      rowKey: upd.rowKey,
      patch: databaseRecordToRow(fields, dbHeaders, dbAliases) as Record<string, unknown>,
      audit: auditTrail === undefined ? undefined : { header: historyCol, lines: String(auditTrail ?? "").split("\n") },
    };
  });

  const count = await writeRowsByCells(sheet, writes);
  return { success: true, updatedCount: count };
}

/** Matches src/api/mergeClients.ts: matches by customerId (NOT minerName), max 10 rows. */
export async function mergeClients(params: {
  duplicateCustomerId: string;
  masterCustomerId: string;
  masterMinerName: string;
}): Promise<{ updatedCount: number; success: boolean; message: string }> {
  await requireRole(RECORD_WRITE_ROLES);
  const sheet = await getActiveWorksheet("database");
  const rows = await sheet.getRows();
  const toUpdate = rows.filter((r) => r.get(DATABASE_HEADERS.customerId) === params.duplicateCustomerId);

  // Previously capped at 10 rows per merge (so a 22-row duplicate silently only
  // half-merged). Now every matching row is rewritten in one batched request.
  const count = await writeRowsByCells(
    sheet,
    toUpdate.map((r) => ({
      rowNumber: r.rowNumber,
      patch: {
        [DATABASE_HEADERS.minerName]: params.masterMinerName,
        [DATABASE_HEADERS.customerId]: params.masterCustomerId,
      } as Record<string, unknown>,
    }))
  );
  invalidateActiveRows();

  return {
    updatedCount: count,
    success: true,
    message: `Merged ${count} records under "${params.masterMinerName}"`,
  };
}

/**
 * Matches src/api/splitItem.ts exactly: throws if remaining <= 0, copies
 * EVERY field from existingRecord (except id) onto the new row -- flat fees
 * are NOT stripped, contrary to what SplitItemDialog's UI note implies;
 * the real backend just duplicates everything and overrides grams/status.
 */
export async function splitItem(params: {
  rowId: number;
  splitGrams: number;
  newStatus: string;
  existingRecord: Record<string, unknown>;
  userEmail?: string;
}): Promise<{ success: boolean; remainingGrams: number; splitGrams: number }> {
  await requireRole(RECORD_WRITE_ROLES);
  const origGrams = Number(params.existingRecord.grams) || 0;
  const remaining = origGrams - params.splitGrams;
  if (remaining <= 0) {
    throw new Error("Split grams must be less than total grams");
  }

  const sheet = await getActiveWorksheet("database");

  // Resolve by Row Key, not position. Splitting wrote the remaining grams to
  // whatever row happened to sit at `rowId` — if anyone had inserted, deleted
  // or sorted rows in the sheet since this screen loaded, that silently
  // rewrote a DIFFERENT customer's item. Goes through the locked batch writer
  // so it can't interleave with a concurrent bulk update either.
  await writeRowsByCells(sheet, [
    {
      rowNumber: params.rowId,
      rowKey: String(params.existingRecord.rowKey ?? "") || undefined,
      patch: { [DATABASE_HEADERS.grams]: String(remaining) },
    },
  ]);

  const newRow: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(params.existingRecord)) {
    if (val !== undefined && val !== null && key !== "id") newRow[key] = val;
  }
  newRow.grams = params.splitGrams;
  newRow.status = params.newStatus;
  // The copy loop above clones every field, which included the parent's Row Key
  // — leaving two rows sharing one key. Row-key lookup would then resolve BOTH
  // items to whichever appeared last, so every later edit to either one hit the
  // wrong record. The split-off item is a new record and needs its own key.
  newRow.rowKey = newRowKey();
  newRow.auditTrail = `${new Date().toISOString()} | ${params.userEmail ?? "unknown"} | Split from row ${params.rowId}`;

  await sheet.addRow(databaseRecordToRow(newRow as Partial<DatabaseRowType>, await activeHeaderSet(sheet), await getTenantColumnAliases()));

  return { success: true, remainingGrams: remaining, splitGrams: params.splitGrams };
}

/**
 * Matches src/api/generateInvoiceNumber.ts exactly: format is
 * "{6-char prefix}-{dateOfLive digits}-{rowId}", and it writes the result
 * directly to the row's invoice field as a side effect.
 */
export async function generateInvoiceNumber(params: {
  prefix: string; // must be exactly 6 characters, matching the real schema
  recordId: number;
  dateOfLive: string;
  minerName: string;
  rowKey?: string;
}): Promise<{ invoiceNumber: string }> {
  await requireRole(RECORD_WRITE_ROLES);
  const datePart = params.dateOfLive.replace(/[^0-9]/g, "").slice(0, 8) || "00000000";
  const invoiceNumber = `${params.prefix}-${datePart}-${params.recordId}`;

  const sheet = await getActiveWorksheet("database");
  // Row Key, not position — stamping an invoice number onto the wrong row is
  // both hard to spot and hard to undo once it reaches the customer.
  await writeRowsByCells(sheet, [
    {
      rowNumber: params.recordId,
      rowKey: params.rowKey || undefined,
      patch: { [DATABASE_HEADERS.invoiceNumber]: invoiceNumber },
    },
  ]);

  return { invoiceNumber };
}

/**
 * Matches src/api/importRows.ts: bulk-creates records from parsed masterlist
 * rows, max 8 per call, coercing the same numeric fields, defaulting status
 * to "Pending".
 */
const IMPORT_NUMERIC_FIELDS = new Set(["grams", "mc", "goldRate", "supplierRate", "clientRate", "profit", "qty"]);

/** name-key -> existing customerId, from the rows already in the sheet. */
async function loadCustomerIdIndex(freshRows?: Awaited<ReturnType<typeof getActiveRows>>): Promise<Map<string, string>> {
  // NOTE: deliberately NOT wrapped in a silent catch. If this fails we would
  // mint brand-new ids for customers who already exist, silently recreating the
  // duplicate-id mess. Callers must surface the failure instead.
  const existing = freshRows ?? await getActiveRows("database", 60_000);
  return buildCustomerIdIndex(
    existing.map((r) => ({
      minerName: String(r.get(DATABASE_HEADERS.minerName) ?? ""),
      customerId: String(r.get(DATABASE_HEADERS.customerId) ?? ""),
    }))
  );
}

/** "September 24, 2026" / "9/24/2026" / "2026-09-24" → "2026-09-24" (for duplicate checks). */
function dateKey(v: unknown): string {
  const s = String(v ?? "").trim().replace(/^[a-z]+day,?\s+/i, "");
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // The shared parser first, so day-first "24/08/2026" (older rows) and the
  // cleaned "2026-08-24" (new import) give the same key.
  const d = parseDateRobust(s) ?? new Date(s);
  if (Number.isNaN(d.getTime())) return s.toUpperCase();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, " ").trim();
function itemKey(liver: unknown, date: unknown, code: unknown, desc: unknown): string {
  return [norm(liver), dateKey(date), norm(code), norm(desc)].join("|");
}

export async function importRows(params: {
  rows: Record<string, string>[];
  userEmail?: string;
  /** Batch id shared across all chunks of one upload, so it can be undone. */
  importId?: string;
  /** Import rows even if the same item (liver + date + code + description) is already in the sheet. */
  allowDuplicates?: boolean;
  /** Masterlist upload: link rows to items already added by hand (Add Client) instead of adding copies. */
  matchManual?: boolean;
}): Promise<{ success: boolean; createdCount: number; errors: string[]; duplicates: number; alreadyImported: number; matchedManual: number }> {
  const sessionEmail = await requireRole(RECORD_WRITE_ROLES);
  const sheet = await getActiveWorksheet("database");
  const dbHeaders = await activeHeaderSet(sheet);
  const dbAliases = await getTenantColumnAliases();
  const errors: string[] = [];
  const timestamp = new Date().toISOString();
  const idTag = params.importId ? ` | import:${params.importId}` : "";
  // Prefer the signed-in user from the session so the audit trail is never "unknown".
  const who = sessionEmail || params.userEmail || "unknown";

  // Existing clients -> their customer id, so repeat buyers keep ONE id (which is
  // what makes lifetime history work). Cached read: chunked uploads reuse it.
  let customerIdIndex: Map<string, string>;
  // Fresh read (not the 60 s cache): the duplicate check and customer ids must
  // see rows added a moment ago by another batch or another PC.
  let existingRows: Awaited<ReturnType<typeof getActiveRows>>;
  try {
    existingRows = await getActiveRows("database", 0);
    customerIdIndex = await loadCustomerIdIndex(existingRows);
  } catch (err) {
    const why = err instanceof Error ? err.message : "unknown error";
    throw new Error(
      `Import stopped: couldn't read existing customers, so repeat buyers would get duplicate IDs. Nothing was imported. (${why})`
    );
  }

  const toAdd: Record<string, unknown>[] = [];
  const existingKeys = new Set<string>();
  const existingRowKeys = new Set<string>();
  for (const r of existingRows) {
    existingKeys.add(itemKey(r.get(DATABASE_HEADERS.liverName), r.get(DATABASE_HEADERS.dateOfLive), r.get(DATABASE_HEADERS.orderId), r.get(DATABASE_HEADERS.itemDescription)));
    const rk = String(r.get(DATABASE_HEADERS.rowKey) ?? "").trim();
    if (rk) existingRowKeys.add(rk);
  }
  let duplicates = 0;
  let alreadyImported = 0;

  // Items added by hand (Add Client) before the masterlist arrived. The same
  // piece shows up again in the upload, usually with a different liver name
  // and description, so the liver+date+code+description check above misses
  // it. Match on the same client on the same day with the same code (AMB5 =
  // AMB05) or, when the code differs/was left blank, the same grams. A match
  // fills the hand-added record's blank fields instead of adding a copy.
  const manualByDayClient = new Map<string, DatabaseRowType[]>();
  for (const r of existingRows) {
    const rec = rowToDatabaseRecord(r, dbAliases);
    if (/Imported from masterlist/i.test(String(rec.auditTrail ?? ""))) continue;
    const k = `${dateKey(rec.dateOfLive)}|${customerKey(rec.minerName ?? "")}`;
    if (!customerKey(rec.minerName ?? "") || !dateKey(rec.dateOfLive)) continue;
    manualByDayClient.set(k, [...(manualByDayClient.get(k) ?? []), rec]);
  }
  const claimed = new Set<number>();
  const MATCH_FILL_FIELDS = [
    "orderId", "page", "liverName", "source", "category", "tog", "mc", "goldRate",
    "clientRate", "grams", "qty", "currency", "clientAddress", "clientNumber", "liverAdminRemarks",
  ] as const;
  const matchWrites: { rowNumber: number; rowKey?: string; patch: Record<string, unknown> }[] = [];
  const findManual = (raw: Record<string, string>): DatabaseRowType | undefined => {
    const list = manualByDayClient.get(`${dateKey(raw.dateOfLive)}|${customerKey(raw.minerName ?? "")}`);
    if (!list) return undefined;
    const open = list.filter((m) => !claimed.has(m.id));
    const code = codeKey(raw.orderId);
    const byCode = code ? open.find((m) => codeKey(m.orderId) === code) : undefined;
    if (byCode) return byCode;
    const g = Number(raw.grams) || 0;
    // Grams only for a hand-added item not already paired with a masterlist row.
    return g > 0
      ? open.find((m) => !/Matched to masterlist/i.test(String(m.auditTrail ?? "")) && Math.abs((Number(m.grams) || 0) - g) < 0.01)
      : undefined;
  };
  let matchedManual = 0;

  for (const rawRow of params.rows.slice(0, 300)) {
    // Retry of a batch that already went in (same Row Key) → skip silently.
    if (rawRow.rowKey && existingRowKeys.has(String(rawRow.rowKey))) { alreadyImported++; continue; }
    const k = itemKey(rawRow.liverName, rawRow.dateOfLive, rawRow.orderId, rawRow.itemDescription);
    if (!params.allowDuplicates && existingKeys.has(k)) { duplicates++; continue; }
    existingKeys.add(k); // also stops the same item twice inside one upload
    const manual = params.matchManual && !params.allowDuplicates ? findManual(rawRow) : undefined;
    if (manual) {
      claimed.add(manual.id);
      const fill: Record<string, unknown> = {};
      for (const f of MATCH_FILL_FIELDS) {
        const have = (manual as unknown as Record<string, unknown>)[f];
        const blank = have === undefined || have === null || String(have).trim() === "" || (IMPORT_NUMERIC_FIELDS.has(f) && !Number(have));
        const val = rawRow[f];
        if (!blank || !val || String(val).trim() === "") continue;
        fill[f] = IMPORT_NUMERIC_FIELDS.has(f) && Number.isFinite(Number(val)) ? Number(val) : val;
      }
      fill.auditTrail = appendAudit(manual.auditTrail, `${timestamp} | ${who} | Matched to masterlist${rawRow.orderId ? ` ${rawRow.orderId}` : ""}${idTag}`);
      matchWrites.push({
        rowNumber: manual.id,
        rowKey: manual.rowKey || undefined,
        patch: databaseRecordToRow(fill as Partial<DatabaseRowType>, dbHeaders, dbAliases) as Record<string, unknown>,
      });
      matchedManual++;
      continue;
    }
    try {
      const row: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(rawRow)) {
        if (!val || String(val).trim() === "") continue;
        if (IMPORT_NUMERIC_FIELDS.has(key)) {
          const num = Number(val);
          if (Number.isFinite(num)) row[key] = num;
        } else {
          row[key] = val;
        }
      }

      // Sensible defaults for a freshly uploaded masterlist.
      if (!row.status) row.status = "Waiting for Details";
      if (!row.modeOfSale) row.modeOfSale = "Live";

      // Assign / reuse the customer id.
      if (!row.customerId && row.minerName) {
        row.customerId = resolveCustomerIdFor(String(row.minerName), customerIdIndex);
      }

      if (!row.rowKey) row.rowKey = newRowKey();
      row.auditTrail = `${timestamp} | ${who} | Imported from masterlist${idTag}`;
      toAdd.push(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`Row ${toAdd.length + 1}: ${msg}`);
    }
  }

  let created = 0;
  if (toAdd.length > 0) {
    // One append request for the whole batch instead of one per row.
    const mapped = toAdd.map((r) => databaseRecordToRow(r as Partial<DatabaseRowType>, dbHeaders, dbAliases));
    await sheet.addRows(mapped as never);
    created = mapped.length;
    invalidateActiveRows();
  }
  if (matchWrites.length > 0) {
    await writeRowsByCells(sheet, matchWrites);
    invalidateActiveRows();
  }

  return { success: errors.length === 0, createdCount: created, errors, duplicates, alreadyImported, matchedManual };
}

// ---------- Database column check / fix (per customer sheet) ----------

/**
 * Database columns the app writes that the ACTIVE customer's sheet doesn't have
 * yet (an accepted alternate name, e.g. "Address" for "Client Address", counts
 * as present). Values for a missing column are silently dropped on import, so
 * the upload preview warns about these and offers fixDatabaseColumns().
 */
export async function checkDatabaseColumns(): Promise<{ missing: string[]; error?: string }> {
  await requireSession();
  try {
    const sheet = await getActiveWorksheet("database");
    await sheet.loadHeaderRow();
    const have = new Set((sheet.headerValues ?? []).map((h) => String(h ?? "").trim()));
    const extra = await getTenantColumnAliases();
    const missing: string[] = [];
    for (const [key, header] of Object.entries(DATABASE_HEADERS)) {
      if (OPTIONAL_DATABASE_KEYS.has(key)) continue;
      if (have.has(header)) continue;
      const alts = [...(DATABASE_HEADER_ALIASES[key] ?? []), ...(extra[key] ?? [])];
      if (alts.some((a) => have.has(a))) continue;
      missing.push(header);
    }
    return { missing };
  } catch (err) {
    return { missing: [], error: err instanceof Error ? err.message : "Could not read the Database tab" };
  }
}

/**
 * Adds the missing columns to the END of the active customer's Database header
 * row. Never renames, moves or deletes existing columns or data. Only touches
 * the customer currently selected.
 */
export async function fixDatabaseColumns(): Promise<{ success: boolean; added: string[]; error?: string }> {
  await requireRole(["admin", "super_admin"]);
  const { missing, error } = await checkDatabaseColumns();
  if (error) return { success: false, added: [], error };
  if (missing.length === 0) return { success: true, added: [] };
  try {
    const sheet = await getActiveWorksheet("database");
    await sheet.loadHeaderRow();
    const current = [...(sheet.headerValues ?? [])].map((h) => String(h ?? ""));
    while (current.length && !current[current.length - 1].trim()) current.pop();
    const next = [...current, ...missing];
    if (sheet.columnCount < next.length) {
      await sheet.resize({ rowCount: sheet.rowCount, columnCount: next.length });
    }
    await sheet.setHeaderRow(next);
    invalidateActiveRows();
    return { success: true, added: missing };
  } catch (err) {
    return { success: false, added: [], error: err instanceof Error ? err.message : "Could not update the sheet" };
  }
}

/**
 * One-time migration: give every existing row a Row Key so edits stop depending
 * on the row's POSITION in the sheet. Safe to run repeatedly — rows that already
 * have a key are skipped.
 */
export async function backfillRowKeys(): Promise<{ success: boolean; updated: number; total: number; error?: string }> {
  await requireRole(["admin", "super_admin"]);
  const sheet = await getActiveWorksheet("database");
  const headers = await activeHeaderSet(sheet);
  if (headers && !headers.has(DATABASE_HEADERS.rowKey)) {
    return {
      success: false, updated: 0, total: 0,
      error: `Add a "${DATABASE_HEADERS.rowKey}" column to the Database tab first, then run this again.`,
    };
  }

  const rows = await sheet.getRows();
  const missing = rows.filter((r) => !String(r.get(DATABASE_HEADERS.rowKey) ?? "").trim());
  if (missing.length === 0) return { success: true, updated: 0, total: rows.length };

  const CHUNK = 200;
  let updated = 0;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const slice = missing.slice(i, i + CHUNK);
    updated += await writeRowsByCells(
      sheet,
      slice.map((r) => ({
        rowNumber: r.rowNumber,
        patch: { [DATABASE_HEADERS.rowKey]: newRowKey() } as Record<string, unknown>,
      }))
    );
  }
  invalidateActiveRows();
  return { success: true, updated, total: rows.length };
}

// ---------- Uploads ----------

export async function getUploads() {
  await requireRole(["admin", "super_admin"]);
  const rows = await getActiveRows("uploads");
  return rows.map((r) => ({
    staffUploader: r.get(UPLOADS_HEADERS.staffUploader) ?? "",
    masterlistFile: r.get(UPLOADS_HEADERS.masterlistFile) ?? "",
    status: r.get(UPLOADS_HEADERS.status) ?? "",
  }));
}

export async function createUpload(params: {
  masterlistFile: string;
  status?: string;
  userEmail?: string;
}): Promise<{ success: boolean }> {
  await requireRole(["admin", "super_admin"]);
  const sheet = await getActiveWorksheet("uploads");
  await sheet.addRow({
    [UPLOADS_HEADERS.staffUploader]: params.userEmail ?? "unknown",
    [UPLOADS_HEADERS.masterlistFile]: params.masterlistFile,
    [UPLOADS_HEADERS.status]: params.status ?? "Uploaded",
  });
  invalidateActiveRows();
  return { success: true };
}

// ---------- Undoable imports ----------
// Each masterlist upload tags its rows with "import:<id>" in the Audit Trail.
// We remember the most recent import so it can be reverted in one click.

/** Import ids look like "1696000000000-ab12cd" (UploadMasterlistFAB). */
const IMPORT_ID_RE = /^[\w-]{6,}$/;

/** True when an Audit Trail carries exactly this import's tag (not one that merely starts with it). */
function hasImportTag(audit: string, importId: string): boolean {
  const tag = `import:${importId}`;
  return audit.split(/[|\s]+/).some((part) => part.trim() === tag);
}

export interface LastImportInfo {
  importId: string;
  fileName: string;
  count: number;
  at: string;
  by: string;
}

/** Remember the most recent import (called right after a successful upload). */
export async function recordLastImport(info: LastImportInfo): Promise<{ success: boolean }> {
  // Admins only: Undo deletes whatever this record points at.
  await requireRole(["admin", "super_admin"]);
  if (!IMPORT_ID_RE.test(String(info?.importId ?? ""))) throw new Error("Invalid import id.");
  await writeConfig("__LAST_IMPORT__", JSON.stringify(info));
  return { success: true };
}

/** The most recent import that can still be undone (null if none / already undone). */
export async function getLastImport(): Promise<LastImportInfo | null> {
  await requireRole(["admin", "super_admin"]);
  const raw = await readConfig("__LAST_IMPORT__");
  if (!raw) return null;
  try {
    const info = JSON.parse(raw) as LastImportInfo;
    return info?.importId ? info : null;
  } catch {
    return null;
  }
}

/**
 * Delete every Database row tagged with the given import id (or the last import
 * if none supplied). Reverses a masterlist upload. Deletes bottom-up so row
 * numbers don't shift mid-loop.
 */
export async function undoLastImport(
  params?: { importId?: string }
): Promise<{ success: boolean; deleted: number; fileName: string; error?: string }> {
  await requireRole(["admin", "super_admin"]);

  const last = await getLastImport();
  const importId = params?.importId || last?.importId;
  if (!importId) return { success: false, deleted: 0, fileName: "", error: "No import to undo." };
  if (!IMPORT_ID_RE.test(importId)) return { success: false, deleted: 0, fileName: "", error: "That import can't be undone." };

  const sheet = await getActiveWorksheet("database");
  const rows = await sheet.getRows();
  const auditHeader = DATABASE_HEADERS.auditTrail;

  const targets = rows
    .filter((r) => hasImportTag(String(r.get(auditHeader) ?? ""), importId))
    .sort((a, b) => b.rowNumber - a.rowNumber);

  // Delete all rows in ONE request (bottom-up ranges), instead of one API call
  // per row — 100+ single deletes hit Google's write limit and stopped halfway.
  const ranges: { start: number; end: number }[] = [];
  for (const r of targets) { // already sorted bottom → top
    const idx = r.rowNumber - 1;
    const last = ranges[ranges.length - 1];
    if (last && last.start === idx + 1) last.start = idx;
    else ranges.push({ start: idx, end: idx + 1 });
  }
  let deleted = 0;
  let error: string | undefined;
  if (ranges.length) {
    try {
      await withSheetWriteLock(async () => {
        const doc = await getActiveDoc();
        await (doc as unknown as { sheetsApi: { post: (u: string, b: unknown) => Promise<unknown> } }).sheetsApi.post(":batchUpdate", {
          requests: ranges.map((rg) => ({
            deleteDimension: { range: { sheetId: sheet.sheetId, dimension: "ROWS", startIndex: rg.start, endIndex: rg.end } },
          })),
        });
        await doc.loadInfo();
      });
      deleted = targets.length;
    } catch (err) {
      error = err instanceof Error ? err.message : "delete failed";
    }
  }

  // Clear the "last import" marker only when everything is gone, so a failed
  // undo can simply be pressed again.
  if (!error && (!params?.importId || params.importId === last?.importId)) {
    try { await deleteConfigMarker("__LAST_IMPORT__"); } catch { /* ignore */ }
  }
  invalidateActiveRows();

  if (error) return { success: false, deleted: 0, fileName: last?.fileName ?? "", error: `Undo failed, nothing was deleted: ${error}. Try again.` };
  return { success: true, deleted, fileName: last?.fileName ?? "" };
}

// ---------- Rates config sync ----------
// Matches src/api/getRatesConfig.ts / saveRatesConfig.ts EXACTLY: this is
// NOT a separate "Settings" tab (correcting my earlier guess) -- it's a
// special row on the Uploads sheet itself, marked status === "__RATES_CONFIG__",
// with the JSON blob stored in the masterlistFile column.

/** Crown's cost rates and gold rate — never sent to a liver (her browser only needs the sell side). */
const LIVER_HIDDEN_RATES = ["silverCostRate", "silverBrandedCostRate", "goldRate"] as const;

function withoutCostRates(json: string): string {
  if (!json) return json;
  try {
    const config = JSON.parse(json);
    const strip = (r: unknown) => {
      if (r && typeof r === "object") for (const k of LIVER_HIDDEN_RATES) delete (r as Record<string, unknown>)[k];
    };
    strip(config?.sticky);
    for (const entry of Object.values(config?.dates ?? {})) strip((entry as { rates?: unknown })?.rates);
    return JSON.stringify(config);
  } catch {
    return "";
  }
}

export async function getRatesConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  const config = await readConfig("__RATES_CONFIG__");
  const access = await getSessionAccess();
  // Signed in but not in the Roles tab: nothing (same as getRecords).
  if (!access.all && access.roles.length === 0) return { config: "" };
  if (access.all || !isLiverOnly(access.roles)) return { config };
  return { config: withoutCostRates(config) };
}

export async function saveRatesConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__RATES_CONFIG__", params.config);
  return { success: true };
}

// ---------- Reward inventory (Purchasing tab) ----------
// Same pattern as rates config: a marker row on Uploads, status ===
// "__REWARD_INVENTORY__", JSON blob in masterlistFile.

export interface RewardInventoryItem {
  id: string;
  rewardItem: string;
  costPrice: number;
  currentStock: number;
  totalDistributed: number;
  alertThreshold: number;
  lastRestockQty: number;
  assignedMilestone?: string;
}

export interface RewardHistoryEntry {
  id: string;
  clientName: string;
  customerId: string;
  milestone: string;
  rewardItem: string;
  stockAfter: number;
  approvedBy: string;
  approvedDate: string;
}

/** Shape returned by getRewardInventory (consumed by PurchasingTab). */
export interface GetRewardInventoryOutputType {
  items: RewardInventoryItem[];
  history: RewardHistoryEntry[];
}

export async function getRewardInventory(
  _params?: Record<string, never>
): Promise<GetRewardInventoryOutputType> {
  // Customers' reward history: same roles as getPurchases.
  await requireRole(["purchasing", "admin", "super_admin"]);
  const raw = await readConfig("__REWARD_INVENTORY__");
  if (!raw) return { items: [], history: [] };
  try {
    const parsed = JSON.parse(raw);
    return { items: parsed.items ?? [], history: parsed.history ?? [] };
  } catch {
    return { items: [], history: [] };
  }
}

export async function updateRewardInventory(params: {
  items: RewardInventoryItem[];
  newHistoryEntry?: RewardHistoryEntry;
}): Promise<{ success: boolean }> {
  // Was the only write action in the file with no guard at all — every sibling
  // config writer requires super_admin. Server actions are callable endpoints,
  // so "no UI calls it" is not a guard.
  await requireRole(["admin", "super_admin"]);
  let history: RewardHistoryEntry[] = [];
  const raw = await readConfig("__REWARD_INVENTORY__");
  if (raw) {
    try { history = JSON.parse(raw).history ?? []; } catch { /* ignore */ }
  }
  if (params.newHistoryEntry) history.push(params.newHistoryEntry);
  await writeConfig("__REWARD_INVENTORY__", JSON.stringify({ items: params.items, history }));
  return { success: true };
}

// ---------- Brand / design settings ----------
// Same marker-row pattern as rates config and reward inventory. Text/color/
// font settings and the two logos are stored in SEPARATE rows -- a single
// combined blob risks hitting Google Sheets' ~50,000 character cell limit
// once two images are involved, and we don't want a large logo upload to
// block saving an unrelated color change.

export async function getBrandSettings(): Promise<{ config: string }> {
  return { config: await readConfig("__BRAND_SETTINGS__") };
}

export async function saveBrandSettings(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__BRAND_SETTINGS__", params.config);
  return { success: true };
}

const LOGO_MARKERS = {
  header: "__BRAND_LOGO_HEADER__",
  invoice: "__BRAND_LOGO_INVOICE__",
} as const;

export async function getBrandLogo(kind: "header" | "invoice"): Promise<{ dataUrl: string | null }> {
  return { dataUrl: (await readConfig(LOGO_MARKERS[kind])) || null };
}

// Returns { success:false, error } instead of throwing: in production builds
// Next.js hides thrown messages ("An error occurred in the Server Components
// render…"), so the user never saw WHY a logo failed.
export async function saveBrandLogo(params: { kind: "header" | "invoice"; dataUrl: string }): Promise<{ success: boolean; error?: string }> {
  await requireRole(["super_admin"]);
  if (params.dataUrl.length > 45000) {
    return { success: false, error: "Image is too large even after compression. Try a smaller or simpler image." };
  }
  try {
    await writeConfig(LOGO_MARKERS[params.kind], params.dataUrl);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Couldn't save the logo to the sheet." };
  }
  return { success: true };
}

// ---------- Per-page brand logos (Uploads markers) ----------
// One marker row per page/brand: status = "__PGLOGO__::<page name>", logo in
// masterlistFile. Shown on invoices for that page's items.

const PGLOGO_PREFIX = "__PGLOGO__::";

export interface PageLogo { page: string; dataUrl: string; }

export async function getPageLogos(_params?: Record<string, never>): Promise<PageLogo[]> {
  const items = await readConfigByPrefix(PGLOGO_PREFIX);
  return items
    .map((x) => ({ page: x.marker.slice(PGLOGO_PREFIX.length), dataUrl: x.value }))
    .filter((p) => p.page && p.dataUrl);
}

export async function savePageLogo(params: { page: string; dataUrl: string }): Promise<{ success: boolean; error?: string }> {
  await requireRole(["super_admin"]);
  if (params.dataUrl.length > 45000) {
    return { success: false, error: "Image is too large even after compression. Try a smaller or simpler image." };
  }
  const page = params.page.trim();
  if (!page) return { success: false, error: "Page name is required." };
  try {
    await writeConfig(PGLOGO_PREFIX + page, params.dataUrl);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Couldn't save the logo to the sheet." };
  }
  return { success: true };
}

export async function deletePageLogo(params: { page: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await deleteConfigMarker(PGLOGO_PREFIX + params.page.trim());
  return { success: true };
}

// ---------- Pricing config (Uploads marker) ----------
// Same marker-row pattern as rates config: per-tenant pricing numbers
// (USD→AED, making-charge tiers, per-pc rates) stored as a JSON blob.

/** Supplier-cost inputs in the pricing config — never sent to a liver. */
const LIVER_HIDDEN_PRICING = ["makingCharges", "perPcRates", "perPcFallback", "b1t1Multiplier"] as const;

export async function getPricingConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  const config = await readConfig("__PRICING_CONFIG__");
  const access = await getSessionAccess();
  if (!access.all && access.roles.length === 0) return { config: "" };
  if (access.all || !isLiverOnly(access.roles) || !config) return { config };
  // A liver keeps USD→AED, card surcharge and shipping fees for her Collect / Balance amounts.
  try {
    const parsed = JSON.parse(config) as Record<string, unknown>;
    for (const k of LIVER_HIDDEN_PRICING) delete parsed[k];
    return { config: JSON.stringify(parsed) };
  } catch {
    return { config: "" };
  }
}

export async function savePricingConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__PRICING_CONFIG__", params.config);
  return { success: true };
}

// ---------- Reseller rates (Uploads marker) ----------
// Per-reseller daily rates per type (18K / SP / EF), see lib/resellers.ts.

export async function getResellerConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__RESELLER_CONFIG__") };
}

export async function saveResellerConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["admin", "super_admin"]);
  await writeConfig("__RESELLER_CONFIG__", params.config);
  return { success: true };
}

// ---------- Tab config (Uploads marker) ----------
// Per-tenant tab visibility / labels / order, stored as a JSON blob.

export async function getTabConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__TAB_CONFIG__") };
}

export async function saveTabConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__TAB_CONFIG__", params.config);
  return { success: true };
}

// ---------- App config (per-tenant behavior knobs, Uploads marker) ----------

export async function getAppConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__APP_CONFIG__") };
}

export async function saveAppConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__APP_CONFIG__", params.config);
  return { success: true };
}

// Per-tenant editable dropdown option lists (Mode of Payment, Category, …).
export async function getOptionsConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__OPTIONS_CONFIG__") };
}

export async function saveOptionsConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__OPTIONS_CONFIG__", params.config);
  return { success: true };
}

// Per-tenant developer-defined toggles.
export async function getCustomToggles(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__CUSTOM_TOGGLES__") };
}

export async function saveCustomToggles(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__CUSTOM_TOGGLES__", params.config);
  return { success: true };
}

// Per-tenant masterlist import column mapping (which column each field is in).
export async function getMasterlistMapping(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__MASTERLIST_MAPPING__") };
}

export async function saveMasterlistMapping(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__MASTERLIST_MAPPING__", params.config);
  return { success: true };
}

// ---------- Terminology / label config (Uploads marker) ----------

export async function getLabelConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__LABEL_CONFIG__") };
}

export async function saveLabelConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__LABEL_CONFIG__", params.config);
  return { success: true };
}

// ---------- Per-tenant masterlist template (chunked Uploads markers) ----------
// The customer's own styled .xlsx template, base64-encoded and split across
// rows (status "__MLTPL__::<index>") so any file size fits the 50k cell cap.

const MLTPL_PREFIX = "__MLTPL__::";
const MLTPL_CHUNK = 40000;

export async function getMasterlistTemplate(_params?: Record<string, never>): Promise<{ dataUrl: string }> {
  return { dataUrl: await readConfigChunks(MLTPL_PREFIX) };
}

export async function saveMasterlistTemplate(params: { dataUrl: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfigChunks(MLTPL_PREFIX, params.dataUrl || "", MLTPL_CHUNK);
  return { success: true };
}

export async function clearMasterlistTemplate(_params?: Record<string, never>): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await clearConfigChunks(MLTPL_PREFIX);
  return { success: true };
}

// ---------- Business/industry config (Uploads marker) ----------

export async function getBusinessConfig(_params?: Record<string, never>): Promise<{ config: string }> {
  return { config: await readConfig("__BUSINESS_CONFIG__") };
}

export async function saveBusinessConfig(params: { config: string }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  await writeConfig("__BUSINESS_CONFIG__", params.config);
  return { success: true };
}

// ---------- Purchasing (dedicated "Purchasing" tab, auto-created) ----------

export interface PurchaseOrder {
  id: number; // spreadsheet row number
  date: string;
  supplier: string;
  reference: string;
  item: string;
  category: string;
  qty: number;
  unitCost: number;
  currency: string;
  totalCost: number;
  amountPaid: number;
  balance: number;
  status: string;
  notes: string;
}

const PURCHASE_HEADERS = {
  date: "Date",
  supplier: "Supplier",
  reference: "Reference",
  item: "Item",
  category: "Category",
  qty: "Qty",
  unitCost: "Unit Cost",
  currency: "Currency",
  totalCost: "Total Cost",
  amountPaid: "Amount Paid",
  balance: "Balance",
  status: "Status",
  notes: "Notes",
} as const;

/** Get the Purchasing tab, creating it (with headers) on first use so customers
 * don't have to add it manually. */
async function getPurchasingSheet() {
  const doc = await getActiveDoc();
  let ws = doc.sheetsByTitle["Purchasing"];
  if (!ws) {
    ws = await doc.addSheet({ title: "Purchasing", headerValues: Object.values(PURCHASE_HEADERS) });
  } else {
    await ws.loadHeaderRow().catch(() => undefined);
  }
  return ws;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export async function getPurchases(_params?: Record<string, never>): Promise<PurchaseOrder[]> {
  await requireRole(["purchasing", "admin", "super_admin"]);
  const ws = await getPurchasingSheet();
  const rows = await ws.getRows();
  return rows.map((r) => {
    const qty = num(r.get(PURCHASE_HEADERS.qty));
    const unitCost = num(r.get(PURCHASE_HEADERS.unitCost));
    const totalCost = num(r.get(PURCHASE_HEADERS.totalCost)) || qty * unitCost;
    const amountPaid = num(r.get(PURCHASE_HEADERS.amountPaid));
    return {
      id: r.rowNumber,
      date: String(r.get(PURCHASE_HEADERS.date) ?? ""),
      supplier: String(r.get(PURCHASE_HEADERS.supplier) ?? ""),
      reference: String(r.get(PURCHASE_HEADERS.reference) ?? ""),
      item: String(r.get(PURCHASE_HEADERS.item) ?? ""),
      category: String(r.get(PURCHASE_HEADERS.category) ?? ""),
      qty,
      unitCost,
      currency: String(r.get(PURCHASE_HEADERS.currency) ?? ""),
      totalCost,
      amountPaid,
      balance: num(r.get(PURCHASE_HEADERS.balance)) || totalCost - amountPaid,
      status: String(r.get(PURCHASE_HEADERS.status) ?? ""),
      notes: String(r.get(PURCHASE_HEADERS.notes) ?? ""),
    };
  });
}

type PurchaseInput = Partial<Omit<PurchaseOrder, "id" | "totalCost" | "balance">>;

function buildPurchaseRow(fields: PurchaseInput): Record<string, string> {
  const qty = num(fields.qty);
  const unitCost = num(fields.unitCost);
  const totalCost = qty * unitCost;
  const amountPaid = num(fields.amountPaid);
  return {
    [PURCHASE_HEADERS.date]: String(fields.date ?? ""),
    [PURCHASE_HEADERS.supplier]: String(fields.supplier ?? ""),
    [PURCHASE_HEADERS.reference]: String(fields.reference ?? ""),
    [PURCHASE_HEADERS.item]: String(fields.item ?? ""),
    [PURCHASE_HEADERS.category]: String(fields.category ?? ""),
    [PURCHASE_HEADERS.qty]: String(qty),
    [PURCHASE_HEADERS.unitCost]: String(unitCost),
    [PURCHASE_HEADERS.currency]: String(fields.currency ?? ""),
    [PURCHASE_HEADERS.totalCost]: String(totalCost),
    [PURCHASE_HEADERS.amountPaid]: String(amountPaid),
    [PURCHASE_HEADERS.balance]: String(totalCost - amountPaid),
    [PURCHASE_HEADERS.status]: String(fields.status ?? "Ordered"),
    [PURCHASE_HEADERS.notes]: String(fields.notes ?? ""),
  };
}

export async function createPurchase(params: { fields: PurchaseInput }): Promise<{ success: boolean }> {
  await requireRole(["purchasing", "admin", "super_admin"]);
  const ws = await getPurchasingSheet();
  await ws.addRow(buildPurchaseRow(params.fields));
  return { success: true };
}

export async function updatePurchase(params: { rowId: number; fields: PurchaseInput }): Promise<{ success: boolean }> {
  await requireRole(["purchasing", "admin", "super_admin"]);
  const ws = await getPurchasingSheet();
  const rows = await ws.getRows();
  const target = rows.find((r) => r.rowNumber === params.rowId);
  if (!target) throw new Error(`No purchase found at row ${params.rowId}`);
  const patch = buildPurchaseRow(params.fields);
  for (const [k, v] of Object.entries(patch)) target.set(k, v);
  await target.save();
  return { success: true };
}

export async function deletePurchase(params: { rowId: number }): Promise<{ success: boolean }> {
  await requireRole(["purchasing", "admin", "super_admin"]);
  const ws = await getPurchasingSheet();
  const rows = await ws.getRows();
  const target = rows.find((r) => r.rowNumber === params.rowId);
  if (target) await target.delete();
  return { success: true };
}

// ---------- Roles ----------

export async function getRoles(_params?: Record<string, never>): Promise<Record<string, string>[]> {
  const email = await requireSession();
  const sheet = await getActiveWorksheet("roles");
  const rows = await sheet.getRows();
  const all = rows.map((r) => ({
    email: r.get(ROLES_HEADERS.email) ?? "",
    role: r.get(ROLES_HEADERS.role) ?? "",
    name: r.get(ROLES_HEADERS.name) ?? "",
  }));
  // Everyone needs their own row (roles, liver name). Only those who can
  // "Preview as" someone (super_admin, developer) get the whole staff list.
  if (email === null || isDeveloper(email) || getUserRole(email, all).includes("super_admin")) return all;
  const me = email.toLowerCase().trim();
  return all.filter((r) => String(r.email).toLowerCase().trim() === me);
}


/** The signed-in user's roles for the active customer (developer ⇒ super_admin). */
export async function getMyRoles(_params?: Record<string, never>): Promise<string[]> {
  try { return await getSessionRoles(); } catch { return []; }
}
