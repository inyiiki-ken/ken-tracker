import "server-only";
import type { GoogleSpreadsheetCell, GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveWorksheet, invalidateActiveRows } from "./tenant-context";
import { readConfig } from "./config-store";
import { rowToDatabaseRecord, databaseRecordToRow } from "./row-mapper";
import { DATABASE_HEADERS, OPTIONAL_DATABASE_KEYS } from "./sheet-config";
import type { DatabaseRowType } from "@/types";
import { trimAudit } from "@/lib/auditTrim";

/**
 * Database-tab helpers shared by the record actions (actions.ts) and the
 * pullout requests ("Liver came"), so both go through the same write lock,
 * Row Key targeting and column aliases.
 */

/** Google caps a cell at 50,000 characters. The audit trail is append-only, so
 * without trimming a heavily-edited row eventually fails to save. Keep the most
 * recent entries only. */
const AUDIT_MAX_ENTRIES = 20;

/** Fresh position-independent row identity. */
export function newRowKey(): string {
  return `R-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}
export function appendAudit(existing: string | undefined, entry: string): string {
  const lines = String(existing ?? "").split("\n").filter(Boolean);
  lines.push(entry);
  return trimAudit(lines, AUDIT_MAX_ENTRIES).join("\n");
}

/** Lines to add to a row's change history (the sheet column `header`), see writeRowsByCells. */
export type AuditMerge = { header: string; lines: string[] };

/**
 * The cell's lines, then the new ones from `lines` (those after the last line
 * the cell already holds; earlier ones were trimmed off and stay off),
 * trimmed like appendAudit.
 */
function mergeAudit(current: string, lines: string[]): string {
  const have = String(current ?? "").split("\n").filter(Boolean);
  const seen = new Set(have);
  const incoming = lines.filter(Boolean);
  let last = -1;
  incoming.forEach((l, i) => { if (seen.has(l)) last = i; });
  for (const l of incoming.slice(last + 1)) if (!seen.has(l)) { have.push(l); seen.add(l); }
  return trimAudit(have, AUDIT_MAX_ENTRIES).join("\n");
}

/** The sheet column the change history is written to (aliases included). */
export function auditHeader(headers: Set<string> | undefined, aliases: Record<string, string[]>): string {
  return Object.keys(databaseRecordToRow({ auditTrail: "" }, headers, aliases))[0] ?? DATABASE_HEADERS.auditTrail;
}

/** The set of column headers actually present in a worksheet, so writes can
 * target alternate column names (e.g. AR's "Cost"/"Address"/"Number"). */
export async function activeHeaderSet(sheet: { loadHeaderRow: () => Promise<void>; headerValues?: string[] }): Promise<Set<string> | undefined> {
  try {
    await sheet.loadHeaderRow();
    return new Set((sheet.headerValues ?? []).map(String));
  } catch {
    return undefined;
  }
}

/**
 * Adds an optional column (e.g. "Cancel Reason") to the END of the Database
 * header row the first time a value is saved to it. Never moves existing columns.
 */
export async function ensureOptionalColumns(sheet: any, records: Partial<DatabaseRowType>[]): Promise<void> {
  const wanted = [...OPTIONAL_DATABASE_KEYS].filter((k) =>
    records.some((r) => String((r as Record<string, unknown>)[k] ?? "").trim() !== "")
  );
  if (wanted.length === 0) return;
  await sheet.loadHeaderRow();
  const current: string[] = [...(sheet.headerValues ?? [])].map((h: unknown) => String(h ?? ""));
  const have = new Set(current.map((h) => h.trim()));
  const missing = wanted.map((k) => DATABASE_HEADERS[k]).filter((h) => h && !have.has(h));
  if (missing.length === 0) return;
  while (current.length && !current[current.length - 1].trim()) current.pop();
  const next = [...current, ...missing];
  if (sheet.columnCount < next.length) {
    await sheet.resize({ rowCount: sheet.rowCount, columnCount: next.length });
  }
  await sheet.setHeaderRow(next);
  invalidateActiveRows();
}

/**
 * PERF: write rows using the CELL batch API instead of GoogleSpreadsheetRow.save().
 *
 * The old path called sheet.getRows() — which downloads EVERY row in the sheet
 * (3,000+ for a busy customer) — and then saved one row per API request. Setting
 * a status on 30 items meant 30 full-sheet downloads and 30 writes.
 *
 * This loads only the header row + the specific row ranges being touched, then
 * commits every change in a SINGLE batch request.
 */
/**
 * Serialises sheet writes. google-spreadsheet caches loaded cells ON the
 * worksheet object, which is shared across requests — so two overlapping
 * batch writes can flush each other's half-finished changes. Queueing them
 * keeps each batch atomic.
 */
let sheetWriteChain: Promise<unknown> = Promise.resolve();
export function withSheetWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = sheetWriteChain.then(fn, fn);
  sheetWriteChain = run.catch(() => undefined);
  return run;
}

/**
 * Set some cells and save ONLY those. The worksheet object is cached per
 * process, so a failed save used to leave its edits pending and the next,
 * unrelated saveUpdatedCells() sent them too, skipping that write's
 * "changed a moment ago" check. On any failure the edits are dropped.
 */
export async function setAndSaveCells(
  ws: GoogleSpreadsheetWorksheet,
  edits: [GoogleSpreadsheetCell, unknown][],
): Promise<void> {
  const touched: GoogleSpreadsheetCell[] = [];
  try {
    for (const [cell, value] of edits) {
      touched.push(cell);
      cell.value = value as never;
    }
    const dirty = touched.filter((c) => c._isDirty);
    if (dirty.length) await ws.saveCells(dirty);
  } catch (err) {
    touched.forEach((c) => c.discardUnsavedChanges());
    throw err;
  }
}

export async function writeRowsByCells(
  sheet: any,
  updates: { rowNumber: number; rowKey?: string; patch: Record<string, unknown>; expect?: Record<string, string>; audit?: AuditMerge }[]
): Promise<number> {
  if (updates.length === 0) return 0;

  return withSheetWriteLock(async () => {
    await sheet.loadHeaderRow();
    const headers: string[] = (sheet.headerValues ?? []).map(String);
    const colOf = new Map<string, number>();
    headers.forEach((h, i) => colOf.set(h, i));

    // ── Position-independent targeting ────────────────────────────────────────
    // A record's rowNumber is only valid while nobody has sorted/inserted/
    // deleted rows in the sheet. If the Row Key column exists we re-resolve the
    // true position from the key, so edits can never land on the wrong record.
    const keyCol = colOf.get(DATABASE_HEADERS.rowKey);
    const resolved = new Map<number, number>(); // index in `updates` -> rowNumber
    if (keyCol !== undefined && updates.some((u) => u.rowKey)) {
      const lastRow = sheet.rowCount ?? 0;
      await sheet.loadCells({
        startRowIndex: 0,
        endRowIndex: lastRow,
        startColumnIndex: keyCol,
        endColumnIndex: keyCol + 1,
      });
      const keyToRows = new Map<string, number[]>();
      for (let r = 1; r < lastRow; r++) {
        const v = String(sheet.getCell(r, keyCol).value ?? "").trim();
        if (v) keyToRows.set(v, [...(keyToRows.get(v) ?? []), r + 1]); // 1-based row number
      }
      updates.forEach((u, i) => {
        if (!u.rowKey) return;
        const found = keyToRows.get(u.rowKey) ?? [];
        // A row copied by hand in the sheet carries the same Row Key as the
        // original. Before, the edit went to the LAST copy — so changing the
        // status of one item silently changed the other one instead.
        if (found.includes(u.rowNumber)) resolved.set(i, u.rowNumber);
        else if (found.length === 1) resolved.set(i, found[0]);
        else if (found.length > 1) throw new Error(
          `Rows ${found.join(", ")} in the sheet have the same Row Key (a row was copied by hand). Clear the Row Key cell on the copied row, then refresh and try again.`
        );
        else throw new Error(
          "That record no longer exists in the sheet (it may have been deleted). Refresh and try again."
        );
      });
    }

    const targets = updates.map((u, i) => ({ ...u, rowNumber: resolved.get(i) ?? u.rowNumber }));

    // Load only the row bands we actually touch (clustered so a couple of
    // far-apart rows don't drag in everything between them).
    const sorted = [...targets].sort((a, b) => a.rowNumber - b.rowNumber);
    const CLUSTER_SPAN = 200;
    let clusterStart = sorted[0].rowNumber;
    let clusterEnd = sorted[0].rowNumber;
    const bands: [number, number][] = [];
    for (const u of sorted) {
      if (u.rowNumber - clusterStart > CLUSTER_SPAN) {
        bands.push([clusterStart, clusterEnd]);
        clusterStart = u.rowNumber;
      }
      clusterEnd = u.rowNumber;
    }
    bands.push([clusterStart, clusterEnd]);

    for (const [start, end] of bands) {
      await sheet.loadCells({
        startRowIndex: start - 1,
        endRowIndex: end,
        startColumnIndex: 0,
        endColumnIndex: Math.max(1, headers.length),
      });
    }

    // Optional guard: refuse the whole batch when a cell no longer holds the
    // value the caller read (e.g. Dispatch cancelled an item a moment ago).
    for (const u of targets) {
      for (const [header, want] of Object.entries(u.expect ?? {})) {
        const col = colOf.get(header);
        if (col === undefined) continue;
        const cell = sheet.getCell(u.rowNumber - 1, col);
        const have = String(cell.formattedValue ?? cell.value ?? "").trim();
        const w = String(want ?? "").trim();
        // Numbers compare as numbers, so a cell showing "10.00" still matches
        // 10: against the cell's value, or its text read the way the app
        // reads it ("3.00" shown for 2.996, "5.5g").
        const wn = w === "" ? NaN : Number(w.replace(/,/g, ""));
        const near = (x: number) => Number.isFinite(x) && Math.abs(wn - x) < 1e-9;
        const sameNumber = Number.isFinite(wn) && (near(typeof cell.value === "number" ? cell.value : NaN) || near(parseFloat(have.replace(/,/g, ""))));
        if (have !== w && !sameNumber) {
          throw new Error("Some items changed a moment ago. Refresh and try again.");
        }
      }
    }

    let count = 0;
    const edits: [GoogleSpreadsheetCell, unknown][] = [];
    for (const u of targets) {
      let touched = false;
      for (const [header, value] of Object.entries(u.patch)) {
        const col = colOf.get(header);
        if (col === undefined) continue;
        edits.push([sheet.getCell(u.rowNumber - 1, col), value === undefined || value === null ? "" : value]);
        touched = true;
      }
      // Change history: added to what the cell holds now, read under the lock,
      // so lines written since the caller loaded the row (e.g. a confirmed
      // delivery's cash) are never overwritten by an older copy.
      const auditCol = u.audit ? colOf.get(u.audit.header) : undefined;
      if (u.audit && auditCol !== undefined) {
        const cell = sheet.getCell(u.rowNumber - 1, auditCol);
        edits.push([cell, mergeAudit(String(cell.value ?? ""), u.audit.lines)]);
        touched = true;
      }
      if (touched) count++;
    }

    await setAndSaveCells(sheet, edits); // one request for everything
    return count;
  });
}

/** Server-side: the tenant's configured column aliases (extends the built-in
 * DATABASE_HEADER_ALIASES), so getRecords/writes read/write the right columns. */
export async function getTenantColumnAliases(): Promise<Record<string, string[]>> {
  try {
    const config = await readConfig("__APP_CONFIG__");
    if (!config) return {};
    const parsed = JSON.parse(config);
    const aliases = parsed?.columnAliases;
    if (aliases && typeof aliases === "object") {
      const out: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(aliases)) {
        if (Array.isArray(v)) out[k] = v.map(String);
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

/** Every row of the Database tab, read fresh (not cached). */
export async function readDatabase(): Promise<{
  sheet: GoogleSpreadsheetWorksheet;
  records: DatabaseRowType[];
  headers: Set<string> | undefined;
  aliases: Record<string, string[]>;
}> {
  const sheet = await getActiveWorksheet("database");
  const rows = await sheet.getRows();
  const aliases = await getTenantColumnAliases();
  return {
    sheet,
    records: rows.map((r) => rowToDatabaseRecord(r, aliases)),
    headers: await activeHeaderSet(sheet),
    aliases,
  };
}
