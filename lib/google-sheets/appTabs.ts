import "server-only";
import type { GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveDoc } from "./tenant-context";

/**
 * App-owned tabs (Pullout Requests, Delivery Reports) live in the ACTIVE
 * customer's own sheet and are created on first use. New columns go at the END
 * of the header row; existing columns and rows are never touched.
 */

// Keyed by "<sheet id>|<tab title>".
const inflight = new Map<string, Promise<GoogleSpreadsheetWorksheet>>();
// Tabs whose header row was already checked by this server process.
const headersChecked = new Set<string>();

export async function getAppTab(title: string, headers: string[]): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getActiveDoc();
  const key = `${doc.spreadsheetId}|${title}`;
  const existing = doc.sheetsByTitle[title];
  if (existing) {
    if (headersChecked.has(key)) return existing;
    await existing.loadHeaderRow().catch(() => undefined);
    const current = [...(existing.headerValues ?? [])].map((h) => String(h ?? ""));
    const have = new Set(current.map((h) => h.trim()));
    const missing = headers.filter((h) => !have.has(h));
    if (missing.length && current.length) {
      while (current.length && !current[current.length - 1].trim()) current.pop();
      const next = [...current, ...missing];
      if (existing.columnCount < next.length) {
        await existing.resize({ rowCount: existing.rowCount, columnCount: next.length });
      }
      await existing.setHeaderRow(next);
    }
    headersChecked.add(key);
    return existing;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const created = doc.addSheet({ title, headerValues: headers })
    .catch(async (err) => {
      // Created a moment ago from another PC/server: reload the tab list and use it.
      if (/already exists/i.test(String(err?.message ?? err))) {
        await doc.loadInfo();
        const t = doc.sheetsByTitle[title];
        if (t) return t;
      }
      throw err;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, created);
  return created;
}
