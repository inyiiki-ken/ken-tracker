"use server";

import { requireRole } from "./authz";
import { deleteStoredCustomer, readStoredCustomers, rememberAliases, upsertStoredCustomers } from "./customerMemoryStore";
import { customerKey } from "@/lib/customerId";
import { MEMORY_FIELDS, type StoredCustomer } from "@/lib/customerMemory";

/**
 * Customer Memory screen + learning. Staff only: a liver never gets this list
 * (it holds every customer's address). Everything lives in the ACTIVE tenant's
 * own sheet, so one tenant never sees another's customers.
 */

const MEMORY_ROLES = ["super_admin", "admin", "dispatch", "accounts", "livesellers"];

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const nameOf = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, " ");

function clean(entry: StoredCustomer, who: string, source: string): StoredCustomer {
  const name = nameOf(entry.name);
  const key = customerKey(name);
  const fields: StoredCustomer["fields"] = {};
  for (const f of MEMORY_FIELDS) {
    const v = str(entry.fields?.[f]);
    if (v) fields[f] = v.slice(0, 500);
  }
  return {
    name,
    customerId: str(entry.customerId).slice(0, 40),
    aliases: [...new Set((entry.aliases ?? []).map(nameOf).filter((a) => a && customerKey(a) !== key))].slice(0, 30),
    type: entry.type === "Reseller" || entry.type === "Customer" ? entry.type : "",
    country: str(entry.country).slice(0, 80),
    sf: str(entry.sf).slice(0, 20),
    tabby: str(entry.tabby).slice(0, 80),
    notes: str(entry.notes).slice(0, 500),
    fields,
    source,
    updatedBy: who,
    updatedAt: new Date().toISOString(),
  };
}

export async function getCustomerMemory(): Promise<StoredCustomer[]> {
  await requireRole(MEMORY_ROLES);
  return readStoredCustomers();
}

/**
 * Save one customer from the Customers screen. `matchName` is her name before
 * the edit (so a rename updates the same row). The old name is kept as an
 * "also written as" spelling.
 */
export async function saveCustomerMemory(params: { matchName: string; entry: StoredCustomer }): Promise<{ success: boolean }> {
  const who = (await requireRole(MEMORY_ROLES)) || "unknown";
  const next = clean(params.entry, who, "Edited");
  if (!customerKey(next.name)) throw new Error("Enter the customer's name.");
  const renamedFrom = nameOf(params.matchName);
  if (renamedFrom && customerKey(renamedFrom) !== customerKey(next.name) && !next.aliases.includes(renamedFrom)) {
    next.aliases.push(renamedFrom);
  }
  await upsertStoredCustomers([{ matchName: params.matchName || next.name, merge: () => next }]);
  return { success: true };
}

/** Forget what was saved for a customer (what her orders say still counts). */
export async function deleteCustomerMemory(params: { name: string }): Promise<{ success: boolean }> {
  await requireRole(MEMORY_ROLES);
  await deleteStoredCustomer(params.name);
  return { success: true };
}

/**
 * Customers.xlsx import. A customer already on the tab keeps anything the
 * file leaves blank, and her spellings from both are kept.
 */
export async function importCustomerList(params: { entries: StoredCustomer[] }): Promise<{ success: boolean; saved: number }> {
  const who = (await requireRole(MEMORY_ROLES)) || "unknown";
  const entries = params.entries.slice(0, 2000).map((e) => clean(e, who, "Customers.xlsx")).filter((e) => customerKey(e.name));
  const saved = await upsertStoredCustomers(
    entries.map((e) => ({
      matchName: e.name,
      merge: (cur) => {
        if (!cur) return e;
        const fields = { ...cur.fields };
        for (const f of MEMORY_FIELDS) if (e.fields[f]) fields[f] = e.fields[f];
        return {
          ...e,
          customerId: cur.customerId || e.customerId,
          aliases: [...new Set([...cur.aliases, ...e.aliases])],
          type: e.type || cur.type,
          country: e.country || cur.country,
          sf: e.sf || cur.sf,
          tabby: e.tabby || cur.tabby,
          notes: e.notes || cur.notes,
          fields,
        };
      },
    })),
  );
  return { success: true, saved };
}

/**
 * Remember that `from` is a misspelling of `to`, so it is fixed automatically
 * next time. Only spelling fixes are learnt (see isSpellingFix), plus merges.
 */
export async function learnCustomerAlias(params: { from: string; to: string; customerId?: string }): Promise<{ success: boolean }> {
  const who = (await requireRole(MEMORY_ROLES)) || "unknown";
  await rememberAliases([params], who);
  return { success: true };
}

