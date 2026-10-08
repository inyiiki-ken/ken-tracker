/**
 * CUSTOMER MEMORY — the app learns each repeat customer from this tenant's own
 * data and fills the next order in for them.
 *
 * Agreed with the owner (2026-10-08):
 *  - It learns name spellings, address, phone, region, location, payment
 *    method, page, liver, box, shipping fee and customer/reseller type.
 *  - A repeat customer's EMPTY fields are filled; nothing typed is ever
 *    replaced. Every filled field is written in the change history as
 *    "Remembered: …", so Admin can tag it for a double-check.
 *  - A name fixed once (ROTH LYN → RUTH LYN) is fixed automatically after that.
 *  - When an address / phone changes, the newest one wins.
 *  - The status is never set from memory.
 *
 * Two sources, both in the tenant's own sheet (never shared between tenants):
 *  1. The orders themselves (learnt on the fly, so it works from day one).
 *  2. The "Customer Memory" tab: edits from the Customers screen, the imported
 *     Customers.xlsx, and name corrections the app picked up.
 *
 * Plain module (no "use server"/"use client"): the upload runs it on the
 * server, Add Client and the Customers screen run it in the browser.
 */

import type { DatabaseRowType } from "@/types";
import { customerKey } from "@/lib/customerId";
import { levenshtein } from "@/lib/nameFix";
import { parseDateRobust } from "@/lib/calculations";
import { boxLabel, orderBox } from "@/lib/fulfilment";

/** Record fields copied from a customer's last order into the next one. */
export const MEMORY_FIELDS = [
  "clientAddress",
  "clientNumber",
  "regions",
  "locationOfMiner",
  "modeOfPayment",
  "page",
  "liverName",
] as const;
export type MemoryField = (typeof MEMORY_FIELDS)[number];

export const MEMORY_FIELD_LABELS: Record<MemoryField, string> = {
  clientAddress: "Address",
  clientNumber: "Phone",
  regions: "Region",
  locationOfMiner: "Location",
  modeOfPayment: "Payment",
  page: "Page",
  liverName: "Liver",
};

/** Fields a masterlist upload fills. Page and liver always come with the upload itself. */
export const UPLOAD_FILL_FIELDS: MemoryField[] = ["clientAddress", "clientNumber", "regions", "modeOfPayment"];

export type CustomerType = "" | "Customer" | "Reseller";

/** One row of the "Customer Memory" tab. Blank = nothing stored (orders decide). */
export interface StoredCustomer {
  name: string;
  customerId: string;
  aliases: string[];
  type: CustomerType;
  country: string;
  /** "" = normal fee, "FREE", or an amount in AED for a customer with her own fee. */
  sf: string;
  tabby: string;
  notes: string;
  fields: Partial<Record<MemoryField, string>>;
  source: string;
  updatedBy: string;
  updatedAt: string;
}

export type LearnedFrom = "orders" | "edited" | "imported";

export interface Learned {
  value: string;
  /** Time the value is from (order date, or when it was saved). Newest wins. */
  at: number;
  from: LearnedFrom;
}

export interface CustomerProfile {
  key: string;
  name: string;
  customerId: string;
  aliases: string[];
  type: CustomerType;
  country: string;
  sf: string;
  tabby: string;
  notes: string;
  fields: Partial<Record<MemoryField, Learned>>;
  orders: number;
  lastOrder: number;
  /** Box of the latest order (Intl / COD / Pick Up / Reseller…), for display only. */
  box: string;
  stored?: StoredCustomer;
}

export interface CustomerMemory {
  profiles: Map<string, CustomerProfile>;
  /** Name key of a known misspelling → the customer's key. */
  aliasTo: Map<string, string>;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const upper = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, " ");

function timeOf(r: DatabaseRowType): number {
  return parseDateRobust(str(r.dateOfLive))?.getTime() ?? 0;
}

function savedAt(s: StoredCustomer): number {
  const t = Date.parse(s.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

function emptyProfile(key: string, name: string): CustomerProfile {
  return {
    key, name, customerId: "", aliases: [], type: "", country: "", sf: "", tabby: "", notes: "",
    fields: {}, orders: 0, lastOrder: 0, box: "",
  };
}

/**
 * Everything the app knows about this tenant's customers. `records` are this
 * tenant's rows; `stored` its "Customer Memory" tab. Rows are read in sheet
 * order, so on the same live date a later row wins.
 */
export function buildCustomerMemory(records: DatabaseRowType[], stored: StoredCustomer[] = []): CustomerMemory {
  const profiles = new Map<string, CustomerProfile>();
  const aliasTo = new Map<string, string>();

  // Names stored as "also written as" point to their customer, so orders typed
  // with the old spelling still count for the right person.
  for (const s of stored) {
    const key = customerKey(s.name);
    if (!key) continue;
    for (const a of s.aliases) {
      const ak = customerKey(a);
      if (ak && ak !== key) aliasTo.set(ak, key);
    }
  }
  const keyOf = (name: string) => {
    const k = customerKey(name);
    return aliasTo.get(k) ?? k;
  };

  for (const r of records) {
    const key = keyOf(str(r.minerName));
    if (!key) continue;
    let p = profiles.get(key);
    if (!p) {
      p = emptyProfile(key, upper(r.minerName));
      profiles.set(key, p);
    }
    const at = timeOf(r);
    p.orders++;
    if (!p.customerId && str(r.customerId)) p.customerId = str(r.customerId);
    if (at >= p.lastOrder) {
      p.lastOrder = at;
      p.box = boxLabel(orderBox(r));
      // The name as most recently written (unless it was an alias spelling).
      if (customerKey(str(r.minerName)) === key) p.name = upper(r.minerName);
    }
    for (const f of MEMORY_FIELDS) {
      const v = str(r[f]);
      if (!v) continue;
      const cur = p.fields[f];
      if (!cur || at >= cur.at) p.fields[f] = { value: v, at, from: "orders" };
    }
  }

  for (const s of stored) {
    const key = customerKey(s.name);
    if (!key) continue;
    let p = profiles.get(key);
    if (!p) {
      p = emptyProfile(key, upper(s.name));
      profiles.set(key, p);
    }
    p.stored = s;
    p.name = upper(s.name) || p.name;
    if (s.customerId && !p.customerId) p.customerId = s.customerId;
    p.aliases = [...new Set(s.aliases.map(upper).filter(Boolean))];
    p.type = s.type || p.type;
    p.country = s.country;
    p.sf = s.sf;
    p.tabby = s.tabby;
    p.notes = s.notes;
    const at = savedAt(s);
    const from: LearnedFrom = /xlsx|import/i.test(s.source) ? "imported" : "edited";
    for (const f of MEMORY_FIELDS) {
      const v = str(s.fields[f]);
      if (!v) continue;
      const cur = p.fields[f];
      if (!cur || at >= cur.at) p.fields[f] = { value: v, at, from };
    }
  }

  return { profiles, aliasTo };
}

/** The customer this name belongs to (her own name or a remembered misspelling). */
export function profileFor(name: string, mem: CustomerMemory): CustomerProfile | undefined {
  const k = customerKey(name);
  if (!k) return undefined;
  return mem.profiles.get(mem.aliasTo.get(k) ?? k);
}

/** The right spelling for a name the app has learnt is a misspelling; null otherwise. */
export function correctedName(name: string, mem: CustomerMemory): string | null {
  const k = customerKey(name);
  const to = k ? mem.aliasTo.get(k) : undefined;
  if (!to) return null;
  const p = mem.profiles.get(to);
  return p && p.name && customerKey(p.name) !== k ? p.name : null;
}

/** A customer is "repeat" once she has an order or a saved entry. */
export function isRepeat(p: CustomerProfile | undefined): p is CustomerProfile {
  return !!p && (p.orders > 0 || !!p.stored);
}

/** The Free SF value a remembered shipping fee writes on a record, or "". */
export function sfToFreeSf(sf: string): string {
  const s = str(sf).toUpperCase();
  if (!s) return "";
  if (s === "FREE" || s === "0") return "TRUE";
  const n = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? `PROMO:AED:${n}` : "";
}

export interface MemoryFill {
  /** Corrected name, when the typed one is a remembered misspelling. */
  minerName?: string;
  fields: Partial<Record<MemoryField | "freeSf", string>>;
  /** Record keys filled from memory (for the "Remembered:" history line). */
  remembered: string[];
  wasName?: string;
}

/**
 * What memory fills on a new row: the corrected name, and each of `fields`
 * the row has empty. Never replaces anything already there.
 */
export function fillFromMemory(
  row: Partial<Record<string, unknown>>,
  mem: CustomerMemory,
  fields: readonly MemoryField[] = MEMORY_FIELDS,
): MemoryFill {
  const out: MemoryFill = { fields: {}, remembered: [] };
  const name = str(row.minerName);
  const fixed = correctedName(name, mem);
  if (fixed) {
    out.minerName = fixed;
    out.wasName = upper(name);
    out.remembered.push("minerName");
  }
  const p = profileFor(fixed ?? name, mem);
  if (!isRepeat(p)) return out;
  for (const f of fields) {
    if (str(row[f])) continue;
    const v = p.fields[f]?.value;
    if (!v) continue;
    out.fields[f] = v;
    out.remembered.push(f);
  }
  if (!str(row.freeSf)) {
    const sf = sfToFreeSf(p.sf);
    if (sf) {
      out.fields.freeSf = sf;
      out.remembered.push("freeSf");
    }
  }
  return out;
}

const REMEMBERED = "Remembered: ";

/** The change-history text for a fill, e.g. "Remembered: clientAddress, clientNumber (name was ROTH LYN)". */
export function rememberedNote(fill: Pick<MemoryFill, "remembered" | "wasName">): string {
  if (!fill.remembered.length) return "";
  return `${REMEMBERED}${fill.remembered.join(", ")}${fill.wasName ? ` (name was ${fill.wasName.replace(/[|()]/g, " ").trim()})` : ""}`;
}

/**
 * Fields on this record that memory filled and nobody has changed since —
 * the ones Admin tags "remembered" for a double-check.
 */
export function rememberedFieldsOf(auditTrail?: string): Set<string> {
  const out = new Set<string>();
  for (const line of String(auditTrail ?? "").split("\n")) {
    const at = line.indexOf(REMEMBERED);
    if (at >= 0) {
      const list = line.slice(at + REMEMBERED.length).split(" (")[0];
      for (const f of list.split(",")) if (f.trim()) out.add(f.trim());
      continue;
    }
    const upd = line.indexOf("Updated: ");
    if (upd >= 0) for (const f of line.slice(upd + 9).split(",")) out.delete(f.trim());
  }
  return out;
}

/**
 * True when `to` looks like a spelling fix of `from` (a typo or a name cut
 * short), not a different customer. Only these are learnt automatically.
 */
export function isSpellingFix(from: string, to: string): boolean {
  const a = customerKey(from);
  const b = customerKey(to);
  if (!a || !b || a === b) return false;
  if (a.length >= 3 && (b.startsWith(a) || a.startsWith(b))) return true;
  const limit = Math.max(a.length, b.length) >= 8 ? 2 : 1;
  return levenshtein(a, b) <= limit;
}
