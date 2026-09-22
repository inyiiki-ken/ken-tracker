"use client";

/**
 * TENANT ISOLATION FOR BROWSER STORAGE.
 *
 * Every client-side config module (pricing, options, toggles, labels, tabs,
 * rates…) caches itself in localStorage under a fixed key. Those keys were NOT
 * namespaced per customer, so switching workspace in God Mode could leave the
 * previous customer's pricing/rates in memory — the app would briefly compute
 * money using another customer's numbers before the fresh config arrived.
 *
 * Rather than rewrite every key, we stamp which tenant the cache belongs to and
 * wipe it whenever the active tenant changes. Configs are always re-fetched from
 * the sheet on load, so clearing is safe — it only removes a stale head start.
 */

const TENANT_MARKER = "active_tenant_id";

/** Cache keys owned by the app that must never survive a workspace switch. */
const SCOPED_KEYS = [
  "app_config",
  "business_config",
  "custom_toggles",
  "label_config",
  "masterlist_mapping",
  "options_config",
  "pricing_config",
  "tab_config",
  "rates_current_default",
  "rate_metal_mode",
  "myDeals_selectedLiver",
];

/** rates_YYYY-MM-DD and rates_lock_* are per-date, so match them by prefix. */
const SCOPED_PREFIXES = ["rates_"];

function clearScopedStorage(): void {
  try {
    for (const k of SCOPED_KEYS) localStorage.removeItem(k);
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && SCOPED_PREFIXES.some((p) => k.startsWith(p))) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing cached anyway */ }
}

/**
 * Call right BEFORE switching workspace + reloading. Clears this browser's cached
 * settings and stamps the new tenant, so after the reload every settings module
 * starts from clean defaults and then loads ONLY the new customer's own config.
 *
 * Why this matters: each settings module (pricing, masterlist mapping, labels…)
 * boots from this cache, and a customer who has never saved a given setting has
 * nothing to overwrite it with — so without clearing, customer B would silently
 * run on customer A's settings (and saving in B would copy A's into B's sheet).
 */
export function prepareTenantSwitch(nextTenantId: string): void {
  if (typeof localStorage === "undefined") return;
  clearScopedStorage();
  try { localStorage.setItem(TENANT_MARKER, String(nextTenantId ?? "").trim()); } catch { /* ignore */ }
}

/**
 * Call once the active tenant is known. Returns true if the workspace changed
 * (and the stale cache was cleared). The caller must then do a FULL page reload
 * (not just re-fetch): the settings modules keep their values in memory, and a
 * customer with no saved value for a setting would otherwise keep the previous
 * customer's value.
 */
export function ensureTenantScope(tenantId: string | null | undefined): boolean {
  if (typeof localStorage === "undefined") return false;
  const current = String(tenantId ?? "").trim();
  if (!current) return false; // unknown tenant — don't wipe on a failed probe
  try {
    const previous = localStorage.getItem(TENANT_MARKER);
    if (previous === current) return false;
    if (previous !== null) clearScopedStorage(); // switched workspace
    localStorage.setItem(TENANT_MARKER, current);
    return previous !== null;
  } catch {
    return false;
  }
}
