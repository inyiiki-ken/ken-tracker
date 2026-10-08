import "server-only";
import type { GoogleSpreadsheetRow, GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { getAppTab } from "./appTabs";
import { getActiveDoc } from "./tenant-context";
import { customerKey } from "@/lib/customerId";
import { MEMORY_FIELDS, type MemoryField, type StoredCustomer, type CustomerType } from "@/lib/customerMemory";

/**
 * The "Customer Memory" tab, auto-created in the ACTIVE customer's own sheet
 * (like Pullout Requests). One row per customer: what was edited on the
 * Customers screen, imported from Customers.xlsx, or learnt from a name fix.
 * Blank cells mean "nothing stored" — the customer's orders decide.
 */

const TAB = "Customer Memory";

const H = {
  name: "Customer",
  customerId: "Customer ID",
  aliases: "Also Written As",
  type: "Type",
  country: "Country",
  clientAddress: "Address",
  clientNumber: "Phone",
  regions: "Region",
  locationOfMiner: "Location",
  modeOfPayment: "Payment",
  page: "Page",
  liverName: "Liver",
  sf: "SF",
  tabby: "Tabby",
  notes: "Notes",
  source: "Source",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
} as const;

function getTab(): Promise<GoogleSpreadsheetWorksheet> {
  return getAppTab(TAB, Object.values(H));
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
/** Text exactly as typed: a value starting with "=" must not become a formula. */
const literal = (v: string) => (v.startsWith("=") ? ` ${v}` : v);

function toType(v: unknown): CustomerType {
  const s = str(v).toLowerCase();
  if (/resell/.test(s)) return "Reseller";
  if (s) return "Customer";
  return "";
}

function toStored(r: GoogleSpreadsheetRow): StoredCustomer {
  const fields: Partial<Record<MemoryField, string>> = {};
  for (const f of MEMORY_FIELDS) {
    const v = str(r.get(H[f]));
    if (v) fields[f] = v;
  }
  return {
    name: str(r.get(H.name)).toUpperCase(),
    customerId: str(r.get(H.customerId)),
    aliases: str(r.get(H.aliases)).split(/[,;\n]/).map((a) => a.trim().toUpperCase()).filter(Boolean),
    type: toType(r.get(H.type)),
    country: str(r.get(H.country)),
    sf: str(r.get(H.sf)),
    tabby: str(r.get(H.tabby)),
    notes: str(r.get(H.notes)),
    fields,
    source: str(r.get(H.source)),
    updatedBy: str(r.get(H.updatedBy)),
    updatedAt: str(r.get(H.updatedAt)),
  };
}

function toCells(s: StoredCustomer): Record<string, string> {
  const out: Record<string, string> = {
    [H.name]: literal(s.name),
    [H.customerId]: literal(s.customerId),
    [H.aliases]: literal(s.aliases.join(", ")),
    [H.type]: s.type,
    [H.country]: literal(s.country),
    [H.sf]: literal(s.sf),
    [H.tabby]: literal(s.tabby),
    [H.notes]: literal(s.notes),
    [H.source]: literal(s.source),
    [H.updatedBy]: literal(s.updatedBy),
    [H.updatedAt]: s.updatedAt,
  };
  for (const f of MEMORY_FIELDS) out[H[f]] = literal(str(s.fields[f]));
  return out;
}

// Uploads and screens read it often; a short cache keeps that to one read per sheet.
const cache = new Map<string, { at: number; list: StoredCustomer[] }>();
const TTL_MS = 10_000;

async function sheetKey(): Promise<string> {
  return (await getActiveDoc()).spreadsheetId;
}

/** Every stored customer of the active tenant. */
export async function readStoredCustomers(fresh = false): Promise<StoredCustomer[]> {
  const key = await sheetKey();
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.list;
  const ws = await getTab();
  const rows = await ws.getRows();
  const list = rows.map(toStored).filter((s) => s.name);
  cache.set(key, { at: Date.now(), list });
  return list;
}

/** Serialises read-check-write on the tab, so two saves can't add the same customer twice. */
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Add or change customers. Each patch is matched to an existing row by its
 * name (or `matchName`, when the customer is being renamed) and merged with
 * `merge`, which gets the row as it is now (undefined for a new customer).
 */
export async function upsertStoredCustomers(
  patches: { matchName: string; merge: (cur: StoredCustomer | undefined) => StoredCustomer | null }[],
): Promise<number> {
  if (!patches.length) return 0;
  return withLock(async () => {
    const ws = await getTab();
    const rows = await ws.getRows();
    const byKey = new Map<string, GoogleSpreadsheetRow>();
    for (const r of rows) {
      const k = customerKey(str(r.get(H.name)));
      if (k && !byKey.has(k)) byKey.set(k, r);
    }
    const toAdd: Record<string, string>[] = [];
    const addedKeys = new Map<string, number>();
    let changed = 0;
    for (const p of patches) {
      const k = customerKey(p.matchName);
      if (!k) continue;
      const row = byKey.get(k);
      if (row) {
        const next = p.merge(toStored(row));
        if (!next) continue;
        row.assign(toCells(next));
        await row.save({ raw: true });
        const nk = customerKey(next.name);
        if (nk && nk !== k) { byKey.delete(k); byKey.set(nk, row); }
        changed++;
        continue;
      }
      // Two patches for the same new customer in one call: merge into the first.
      const pending = addedKeys.get(k);
      const next = p.merge(undefined);
      if (!next) continue;
      if (pending !== undefined) toAdd[pending] = toCells(next);
      else {
        addedKeys.set(k, toAdd.length);
        toAdd.push(toCells(next));
      }
      changed++;
    }
    if (toAdd.length) await ws.addRows(toAdd, { raw: true });
    cache.delete(await sheetKey());
    return changed;
  });
}

/** Remove a customer's stored row (her orders still teach the app). */
export async function deleteStoredCustomer(name: string): Promise<boolean> {
  return withLock(async () => {
    const ws = await getTab();
    const rows = await ws.getRows();
    const k = customerKey(name);
    const row = rows.find((r) => customerKey(str(r.get(H.name))) === k);
    if (!row) return false;
    await row.delete();
    cache.delete(await sheetKey());
    return true;
  });
}

export function blankStored(name: string): StoredCustomer {
  return {
    name: name.toUpperCase().replace(/\s+/g, " ").trim(),
    customerId: "", aliases: [], type: "", country: "", sf: "", tabby: "", notes: "",
    fields: {}, source: "", updatedBy: "", updatedAt: "",
  };
}

const nameOf = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, " ");

/** Learn misspellings (merge, name edits, Live day fixes). No role check: callers already did it. */
export async function rememberAliases(pairs: { from: string; to: string; customerId?: string }[], who: string): Promise<void> {
  const patches = pairs
    .map((p) => ({ from: nameOf(p.from), to: nameOf(p.to), customerId: str(p.customerId) }))
    .filter((p) => customerKey(p.from) && customerKey(p.to) && customerKey(p.from) !== customerKey(p.to));
  if (!patches.length) return;
  const known = await readStoredCustomers(true);
  // A spelling that was itself a customer's main name is never turned into an alias
  // of someone else here — that is a rename, done on the Customers screen.
  const mainNames = new Set(known.map((k) => customerKey(k.name)));
  await upsertStoredCustomers(
    patches
      .filter((p) => !mainNames.has(customerKey(p.from)))
      .map((p) => ({
        matchName: p.to,
        merge: (cur) => {
          const base = cur ?? { ...blankStored(p.to), source: "Learnt from a name fix" };
          if (base.aliases.includes(p.from)) return null;
          return {
            ...base,
            customerId: base.customerId || p.customerId,
            aliases: [...base.aliases, p.from],
            updatedBy: base.updatedBy || who,
            updatedAt: base.updatedAt || new Date().toISOString(),
          };
        },
      })),
  );
}

