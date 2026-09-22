import "server-only";
import type { GoogleSpreadsheet, GoogleSpreadsheetWorksheet, GoogleSpreadsheetRow } from "google-spreadsheet";
import { getSpreadsheetById } from "./client";
import { getActiveSheetId } from "./tenancy-core";
import { SHEET_TABS, UPLOADS_HEADERS, ROLES_HEADERS, LEGACY_CONFIG_TITLES } from "./sheet-config";

/**
 * Tenant-scoped replacements for getSpreadsheet()/getWorksheet(). Every data
 * action resolves the active tenant's sheet id first, so all reads/writes hit
 * the signed-in customer's own sheet (or the env sheet in single-tenant mode).
 */

export async function getActiveDoc(): Promise<GoogleSpreadsheet> {
  const sheetId = await getActiveSheetId();
  return getSpreadsheetById(sheetId);
}

// Dedupes concurrent auto-creates of a system tab (Uploads/Roles).
const createInflight = new Map<string, Promise<GoogleSpreadsheetWorksheet>>();

/** Resolve a known tab on the active tenant's sheet. Prefers gid, falls back to
 * title (customer sheets often have different gids than the template). */
export async function getActiveWorksheet(
  tab: keyof typeof SHEET_TABS
): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getActiveDoc();
  const { gid, title } = SHEET_TABS[tab];

  const byGid = doc.sheetsById[gid];
  if (byGid) return byGid;

  const byTitle = doc.sheetsByTitle[title];
  if (byTitle) return byTitle;

  // Migrate a legacy-named config tab IN PLACE (rename, not recreate) so a
  // customer's existing settings aren't orphaned when we renamed the tab.
  if (tab === "config") {
    for (const legacyTitle of LEGACY_CONFIG_TITLES) {
      const legacy = doc.sheetsByTitle[legacyTitle];
      if (legacy) {
        await legacy.updateProperties({ title });
        return legacy;
      }
    }
  }

  // Auto-create the system tabs the app relies on (Uploads holds all per-tenant
  // settings; Roles holds access). Customer sheets set up with only a Database
  // tab would otherwise fail to persist any settings. Guard so the ~10 parallel
  // config reads on load don't each create a duplicate tab.
  if (tab === "uploads" || tab === "roles" || tab === "config") {
    const ckey = `${doc.spreadsheetId}:${tab}`;
    const inflight = createInflight.get(ckey);
    if (inflight) return inflight;
    // config + uploads share the same marker columns (Status / Masterlist File / Staff)
    const headers = tab === "roles" ? Object.values(ROLES_HEADERS) : Object.values(UPLOADS_HEADERS);
    const p = doc.addSheet({ title, headerValues: headers }).finally(() => createInflight.delete(ckey));
    createInflight.set(ckey, p);
    return p;
  }

  throw new Error(
    `Could not find worksheet "${title}" in spreadsheet ${doc.spreadsheetId}. ` +
      `Check the tab exists and the service account has Editor access.`
  );
}

/**
 * Cached getRows for read-heavy tabs. On app load many config getters read the
 * SAME Uploads tab; caching briefly collapses ~10 API reads into 1, avoiding the
 * Sheets 429 read-quota. Writers call invalidateActiveRows() after saving.
 */
const rowsCache = new Map<string, { at: number; rows: GoogleSpreadsheetRow[] }>();
const ROWS_TTL_MS = 8_000;

export async function getActiveRows(
  tab: keyof typeof SHEET_TABS,
  ttlMs: number = ROWS_TTL_MS
): Promise<GoogleSpreadsheetRow[]> {
  const sheetId = await getActiveSheetId();
  const key = `${sheetId}:${tab}`;
  const cached = rowsCache.get(key);
  if (cached && Date.now() - cached.at < ttlMs) return cached.rows;
  const ws = await getActiveWorksheet(tab);
  const rows = await ws.getRows();
  rowsCache.set(key, { at: Date.now(), rows });
  return rows;
}

export function invalidateActiveRows(): void {
  rowsCache.clear();
}
