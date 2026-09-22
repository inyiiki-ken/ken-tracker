"use client";

/**
 * Per-tenant APP CONFIG — developer-editable behavior knobs, so customizing a
 * customer doesn't need code changes:
 *   - columnAliases: extra header names for a field (e.g. AR's "Cost" = supplier
 *     rate, "Address"/"Number" = client address/number).
 *   - hiddenFields: UI features/sections to hide for this customer
 *     (e.g. "reviewChasing", "fbProfileName").
 *   - statusOptions: the status values available in dropdowns (empty = defaults).
 *
 * Stored in the tenant sheet (Uploads marker "__APP_CONFIG__"), loaded once at
 * app start. Extend by adding more keys here + reading them where needed.
 */

export interface AppConfig {
  columnAliases: Record<string, string[]>;
  hiddenFields: string[];
  statusOptions: string[];
  /**
   * Per-tab status lists, so each team only sees the statuses relevant to them
   * (empty = use the built-in default for that tab). Keys: "admin", "dispatch",
   * "accounts".
   */
  statusOptionsByTab: Record<string, string[]>;
  /**
   * If true (default), an item on "Waiting for Downpayment" cannot be moved to
   * "For Pullout" until it has a downpayment or an EID on file. Turn off to let
   * staff pick For Pullout freely.
   */
  requirePaymentForPullout: boolean;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  columnAliases: {},
  hiddenFields: [],
  statusOptions: [],
  statusOptionsByTab: {},
  requirePaymentForPullout: true,
};

/** Field keys that can be hidden from the UI (shown as toggles in the editor). */
export const HIDEABLE_FIELDS: { key: string; label: string }[] = [
  { key: "reviewChasing", label: "Review Chasing" },
  { key: "fbProfileName", label: "FB Profile Name" },
  { key: "clientAddress", label: "Client Address" },
  { key: "clientNumber", label: "Client Number" },
  { key: "remittanceStatus", label: "Remittance Status" },
  { key: "tog", label: "T.O.G" },
];

/** Field keys that can have alias header names configured. */
export const ALIASABLE_FIELDS: { key: string; label: string }[] = [
  { key: "supplierRate", label: "Supplier rate / Cost" },
  { key: "clientAddress", label: "Client Address" },
  { key: "clientNumber", label: "Client Number" },
  { key: "reviewChasing", label: "Review Chasing" },
  { key: "fbProfileName", label: "FB Profile Name" },
  { key: "goldRate", label: "Gold rate" },
  { key: "mc", label: "MC" },
];

const STORAGE_KEY = "app_config";

let _cfg: AppConfig = loadFromCache();

function loadFromCache(): AppConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_APP_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return { ...DEFAULT_APP_CONFIG };
}

function normalize(p: Partial<AppConfig> | null | undefined): AppConfig {
  const columnAliases: Record<string, string[]> = {};
  if (p?.columnAliases && typeof p.columnAliases === "object") {
    for (const [k, v] of Object.entries(p.columnAliases)) {
      if (Array.isArray(v)) columnAliases[k] = v.map(String).map((s) => s.trim()).filter(Boolean);
    }
  }
  const statusOptionsByTab: Record<string, string[]> = {};
  if (p?.statusOptionsByTab && typeof p.statusOptionsByTab === "object") {
    for (const [k, v] of Object.entries(p.statusOptionsByTab)) {
      if (Array.isArray(v)) statusOptionsByTab[k] = v.map(String).map((s) => s.trim()).filter(Boolean);
    }
  }
  return {
    columnAliases,
    hiddenFields: Array.isArray(p?.hiddenFields) ? p!.hiddenFields.map(String) : [],
    statusOptions: Array.isArray(p?.statusOptions) ? p!.statusOptions.map(String).map((s) => s.trim()).filter(Boolean) : [],
    statusOptionsByTab,
    // default true unless explicitly turned off
    requirePaymentForPullout: p?.requirePaymentForPullout !== false,
  };
}

export function getAppConfig(): AppConfig {
  return _cfg;
}

export function setAppConfig(config: AppConfig): void {
  _cfg = normalize(config);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_cfg));
  } catch { /* ignore */ }
}

export function applyAppConfig(json: string): void {
  if (!json) return;
  try { setAppConfig(normalize(JSON.parse(json))); } catch { /* ignore */ }
}

export function serializeAppConfig(): string {
  return JSON.stringify(_cfg);
}

// ── Helpers used by the UI ────────────────────────────────────────────────────

export function isFieldHidden(key: string): boolean {
  return _cfg.hiddenFields.includes(key);
}

/** Status options: the tenant's list if set, else the provided defaults. */
export function getStatusOptions(defaults: string[]): string[] {
  return _cfg.statusOptions.length > 0 ? _cfg.statusOptions : defaults;
}

/** Whether "For Pullout" is locked until a downpayment/EID is on file. */
export function getRequirePaymentForPullout(): boolean {
  return _cfg.requirePaymentForPullout;
}
