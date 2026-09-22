/**
 * ONE customer = ONE id. Shared by every path that can create a record
 * (masterlist upload + Add Client), so the two can never drift apart.
 *
 * Matching rule (agreed): ignore case, spaces and punctuation. So
 *   "BING YEE" === "BINGYEE" === "Bing-Yee" === "bing  yee"
 * but genuinely different spellings ("Marelen" vs "Marlene") stay separate —
 * those are resolved by hand with the Merge Clients tool.
 *
 * Plain module (no "use server"/"use client") so both sides import the same code.
 */

/** Comparison key for a client name. */
export function customerKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ""); // drops spaces, dots, hyphens, apostrophes…
}

/** A fresh id in the standard CUST-XXXX-XXX shape. */
export function generateCustomerId(): string {
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let rand = "";
  for (let i = 0; i < 3; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `CUST-${ts}${rand}`;
}

/**
 * Build name-key -> existing customerId from rows already in the sheet.
 * First id seen for a key wins, so repeat buyers keep the id they already have.
 */
export function buildCustomerIdIndex(
  rows: { minerName?: string; customerId?: string }[]
): Map<string, string> {
  const index = new Map<string, string>();
  for (const r of rows) {
    const key = customerKey(r.minerName ?? "");
    const id = String(r.customerId ?? "").trim();
    if (key && id && !index.has(key)) index.set(key, id);
  }
  return index;
}

/**
 * Resolve the id for a client name: reuse the existing one, else mint a new one
 * and remember it (so repeats inside the same upload share a single id).
 */
export function resolveCustomerIdFor(name: string, index: Map<string, string>): string {
  const key = customerKey(name);
  if (!key) return generateCustomerId();
  const existing = index.get(key);
  if (existing) return existing;
  const fresh = generateCustomerId();
  index.set(key, fresh);
  return fresh;
}
