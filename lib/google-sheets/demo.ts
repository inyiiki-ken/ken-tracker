"use server";

import type { GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getActiveDoc, getActiveWorksheet, invalidateActiveRows } from "./tenant-context";
import { writeConfig } from "./config-store";
import { databaseRecordToRow } from "./row-mapper";
import { DATABASE_HEADERS, DATABASE_HEADER_ALIASES } from "./sheet-config";
import { SESSION_H, ITEM_H, STOCK_H, LIVE_TABS } from "./liveSellerHeaders";
import { getMyContextCore, getTenantById, getTenants, getSessionEmail, isDeveloper, isMultiTenant } from "./tenancy-core";
import { getSpreadsheetById } from "./client";
import { SHEET_TABS, LEGACY_CONFIG_TITLES, UPLOADS_HEADERS } from "./sheet-config";
import {
  isDemoTenant,
  buildDemoRecords,
  buildDemoSettings,
  buildDemoDataOptions,
  buildDemoPurchases,
  buildDemoLive,
  mergeCopiedSetup,
  COPYABLE_SETUP_MARKERS,
} from "@/lib/demoData";

/**
 * God Mode: fill a DEMO customer's own sheet with made-up data and switch on
 * every feature, so the app can be shown to prospects without real people in
 * it. Only works when the ACTIVE workspace is a demo account (its name, plan or
 * notes say "demo"), so a real customer's sheet can never be wiped by mistake.
 *
 * Runs in steps (one request each) so no single request is long enough to hit
 * the hosting time limit. Every step replaces what that step wrote before, so
 * running it again simply resets the demo.
 */

export type DemoStep = "settings" | "options" | "orders" | "purchasing" | "live";

async function assertDemoWorkspace(): Promise<string> {
  const email = await getSessionEmail();
  if (!isDeveloper(email)) throw new Error("Developer access required.");
  if (!isMultiTenant()) throw new Error("Demo data needs multi-tenant mode, so it can't touch the single shared sheet.");
  const ctx = await getMyContextCore();
  const active = ctx.activeTenant ? await getTenantById(ctx.activeTenant.tenantId) : null;
  if (!active) throw new Error("No active workspace. Switch to the demo account first.");
  if (!isDemoTenant(active)) {
    throw new Error(`"${active.displayName}" is not a demo account. Put "Demo" in its name or plan in the Control sheet first.`);
  }
  return active.displayName;
}

/** Is the active workspace a demo account? Plus the real customers whose setup it can copy. */
export async function getDemoStatus(): Promise<{
  isDemo: boolean;
  name: string;
  reason?: string;
  sources: { tenantId: string; displayName: string }[];
}> {
  let sources: { tenantId: string; displayName: string }[] = [];
  try {
    if (isDeveloper(await getSessionEmail()) && isMultiTenant()) {
      sources = (await getTenants())
        .filter((t) => t.active && !isDemoTenant(t))
        .map((t) => ({ tenantId: t.tenantId, displayName: t.displayName }));
    }
  } catch { /* no list: the demo still works without copying */ }
  try {
    const name = await assertDemoWorkspace();
    return { isDemo: true, name, sources };
  } catch (err) {
    const ctx = await getMyContextCore().catch(() => null);
    return { isDemo: false, name: ctx?.activeTenant?.displayName ?? "", reason: err instanceof Error ? err.message : String(err), sources };
  }
}

/**
 * Read the setup markers (settings only, never data) from another customer's
 * sheet: Ken_Config first, then the legacy config / Uploads markers.
 */
async function readSetupFrom(tenantId: string): Promise<Record<string, string>> {
  const t = await getTenantById(tenantId);
  if (!t) throw new Error("The customer to copy from was not found.");
  if (isDemoTenant(t)) throw new Error("Pick a real customer to copy the setup from.");
  const doc = await getSpreadsheetById(t.sheetId);
  const wanted = new Set<string>(COPYABLE_SETUP_MARKERS);
  const out: Record<string, string> = {};
  const titles = [SHEET_TABS.uploads.title, ...LEGACY_CONFIG_TITLES, SHEET_TABS.config.title]; // later tabs win
  for (const title of titles) {
    const ws = doc.sheetsByTitle[title];
    if (!ws) continue;
    const rows = await ws.getRows().catch(() => []);
    for (const r of rows) {
      const marker = String(r.get(UPLOADS_HEADERS.status) ?? "");
      const value = String(r.get(UPLOADS_HEADERS.masterlistFile) ?? "");
      if (wanted.has(marker) && value) out[marker] = value;
    }
  }
  return out;
}

/** Get a tab by title, creating it with headers; add any missing headers. */
async function tabWithHeaders(title: string, headers: string[]): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getActiveDoc();
  const existing = doc.sheetsByTitle[title];
  if (!existing) return doc.addSheet({ title, headerValues: headers });
  await existing.loadHeaderRow().catch(() => undefined);
  const have = (existing.headerValues ?? []).map(String);
  const missing = headers.filter((h) => !have.includes(h));
  if (!have.length || missing.length) {
    const next = have.length ? [...have, ...missing] : headers;
    if (existing.columnCount < next.length) await existing.resize({ rowCount: existing.rowCount, columnCount: next.length });
    await existing.setHeaderRow(next);
  }
  return existing;
}

async function seedOrders(): Promise<number> {
  const sheet = await getActiveWorksheet("database");
  await sheet.loadHeaderRow().catch(() => undefined);
  const have = (sheet.headerValues ?? []).map((h) => String(h ?? "").trim());
  while (have.length && !have[have.length - 1]) have.pop();
  // Make sure every column the app uses exists (an accepted alternate name counts).
  const missing = Object.entries(DATABASE_HEADERS)
    .filter(([key, header]) => !have.includes(header) && !(DATABASE_HEADER_ALIASES[key] ?? []).some((a) => have.includes(a)))
    .map(([, header]) => header);
  if (!have.length || missing.length) {
    const next = [...have, ...missing];
    if (sheet.columnCount < next.length) await sheet.resize({ rowCount: sheet.rowCount, columnCount: next.length });
    await sheet.setHeaderRow(next);
  }
  const headerSet = new Set([...have, ...missing]);

  await sheet.clearRows();
  const records = buildDemoRecords(new Date(), 2);
  await sheet.addRows(records.map((r) => databaseRecordToRow(r, headerSet)) as never);
  return records.length;
}

async function seedOptions(): Promise<number> {
  const doc = await getActiveDoc();
  const candidates = ["DATA'S", "DATA’S", "DATAS", "DATA", "Options", "Dropdowns"];
  let ws = candidates.map((n) => doc.sheetsByTitle[n]).find(Boolean) ?? null;
  const grid = buildDemoDataOptions();
  if (!ws) ws = await doc.addSheet({ title: "DATA'S", headerValues: grid[0] });
  await ws.clear();
  await ws.setHeaderRow(grid[0]);
  await ws.addRows(grid.slice(1));
  return grid.length - 1;
}

async function seedPurchasing(): Promise<number> {
  const rows = buildDemoPurchases(new Date());
  const ws = await tabWithHeaders("Purchasing", Object.keys(rows[0]));
  await ws.clearRows();
  await ws.addRows(rows);
  return rows.length;
}

async function seedLive(who: string): Promise<number> {
  const live = buildDemoLive(new Date());
  const now = new Date().toISOString();

  const sws = await tabWithHeaders(LIVE_TABS.sessions, Object.values(SESSION_H));
  await sws.clearRows();
  await sws.addRows(
    live.sessions.map((s) => ({
      [SESSION_H.id]: s.id,
      [SESSION_H.date]: s.date,
      [SESSION_H.seller]: s.seller,
      [SESSION_H.weightOut]: String(s.weightOut),
      [SESSION_H.weightBack]: s.weightBack === null ? "" : String(s.weightBack),
      [SESSION_H.status]: s.status,
      [SESSION_H.notes]: s.notes,
      [SESSION_H.outLog]: JSON.stringify([{ at: `${s.date}T10:00:00.000Z`, grams: s.weightOut, note: "Weighed out" }]),
      [SESSION_H.updatedBy]: who,
      [SESSION_H.updatedAt]: now,
    })),
    { raw: true }
  );

  const iws = await tabWithHeaders(LIVE_TABS.items, Object.values(ITEM_H));
  await iws.clearRows();
  await iws.addRows(
    live.items.map((it) => ({
      [ITEM_H.id]: it.id,
      [ITEM_H.sessionId]: it.sessionId,
      [ITEM_H.seller]: it.seller,
      [ITEM_H.liveDate]: it.liveDate,
      [ITEM_H.description]: it.description,
      [ITEM_H.type]: it.type,
      [ITEM_H.grams]: String(it.grams),
      [ITEM_H.rate]: String(it.rate),
      [ITEM_H.amount]: String(it.amount),
      [ITEM_H.status]: it.status,
      [ITEM_H.pulloutDate]: it.pulloutDate,
      [ITEM_H.paidAmount]: it.paidAmount ? String(it.paidAmount) : "",
      [ITEM_H.invoiceNo]: it.invoiceNo,
      [ITEM_H.cancelledDate]: it.cancelledDate,
      [ITEM_H.notes]: "",
      [ITEM_H.recordKey]: "",
      [ITEM_H.customer]: it.customer,
      [ITEM_H.updatedBy]: who,
      [ITEM_H.updatedAt]: now,
    })),
    { raw: true }
  );

  const stws = await tabWithHeaders(LIVE_TABS.stock, Object.values(STOCK_H));
  await stws.clearRows();
  await stws.addRows(
    live.stock.map((s) => ({
      [STOCK_H.id]: s.id,
      [STOCK_H.date]: s.date,
      [STOCK_H.grams]: String(s.grams),
      [STOCK_H.pcs]: String(s.pcs),
      [STOCK_H.description]: s.description,
      [STOCK_H.note]: s.note,
      [STOCK_H.addedBy]: who,
      [STOCK_H.deleted]: "",
    })),
    { raw: true }
  );
  return live.sessions.length + live.items.length;
}

/** Run one step of the demo seed on the active (demo) workspace. */
export async function seedDemoStep(params: { step: DemoStep; copyFrom?: string }): Promise<{ step: DemoStep; count: number }> {
  await assertDemoWorkspace();
  const who = (await getSessionEmail()) || "demo";
  let count = 0;
  try {
    switch (params.step) {
      case "settings": {
        const demo = buildDemoSettings(new Date());
        const settings = params.copyFrom ? mergeCopiedSetup(await readSetupFrom(params.copyFrom), demo) : demo;
        for (const [marker, value] of Object.entries(settings)) await writeConfig(marker, value);
        count = Object.keys(settings).length;
        break;
      }
      case "options":
        count = await seedOptions();
        break;
      case "orders":
        count = await seedOrders();
        break;
      case "purchasing":
        count = await seedPurchasing();
        break;
      case "live":
        count = await seedLive(who);
        break;
      default:
        throw new Error(`Unknown demo step: ${String(params.step)}`);
    }
  } finally {
    invalidateActiveRows();
  }
  return { step: params.step, count };
}
