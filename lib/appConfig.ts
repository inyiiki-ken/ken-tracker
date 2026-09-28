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
  /**
   * Statuses that count as a SALE for the liver (My Sales). Empty = the default
   * (Delivered, Given to Shop). e.g. Crown counts "Dispatched" because delivery
   * can't be tracked.
   */
  saleStatuses: string[];
  /**
   * Deadlines: an item left in `status` longer than `days` shows in Reminders
   * (Dispatch + the liver's own tab) and in the pullout report as "needs to be
   * cancelled". Empty = the built-in reminders (For Pullout 1 day, Dispatched 2 days).
   */
  statusDeadlines: StatusDeadline[];
  /** Statuses listed in the Pullout Report. Empty = For Pullout (+ legacy Dispatch). */
  pulloutStatuses: string[];
  /**
   * When the deadlines were first switched on. Nothing counts as overdue from
   * before this moment, so going live never floods Reminders with old orders.
   */
  deadlinesStartedAt: string;
}

export interface StatusDeadline {
  status: string;
  days: number;
}

export const DEFAULT_SALE_STATUSES = ["Delivered", "Given to Shop"];
export const DEFAULT_PULLOUT_STATUSES = ["For Pullout", "Dispatch"];

export const DEFAULT_APP_CONFIG: AppConfig = {
  columnAliases: {},
  hiddenFields: [],
  statusOptions: [],
  statusOptionsByTab: {},
  requirePaymentForPullout: true,
  saleStatuses: [],
  statusDeadlines: [],
  pulloutStatuses: [],
  deadlinesStartedAt: "",
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

function cleanList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : [];
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
    saleStatuses: cleanList(p?.saleStatuses),
    pulloutStatuses: cleanList(p?.pulloutStatuses),
    deadlinesStartedAt: typeof p?.deadlinesStartedAt === "string" ? p.deadlinesStartedAt : "",
    statusDeadlines: Array.isArray(p?.statusDeadlines)
      ? p!.statusDeadlines
          .map((d) => ({ status: String(d?.status ?? "").trim(), days: Number(d?.days) || 0 }))
          .filter((d) => d.status && d.days > 0)
      : [],
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

/** Apply the customer's saved config; "" (nothing saved) = defaults, so another
 * customer's cached settings can never carry over. */
export function applyAppConfig(json: string): void {
  if (!json) { setAppConfig({ ...DEFAULT_APP_CONFIG }); return; }
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

/** Statuses that count as a sale for the liver. */
export function getSaleStatuses(): string[] {
  return _cfg.saleStatuses.length ? _cfg.saleStatuses : DEFAULT_SALE_STATUSES;
}

/** Statuses shown in the Pullout Report. */
export function getPulloutStatuses(): string[] {
  return _cfg.pulloutStatuses.length ? _cfg.pulloutStatuses : DEFAULT_PULLOUT_STATUSES;
}

/** A status that sends the item out (For Pullout / For COD / For Pick Up…). */
export function isPulloutStatus(status: string): boolean {
  const s = String(status || "").trim().toLowerCase();
  return !!s && getPulloutStatuses().some((x) => x.toLowerCase() === s);
}

/** A status that counts as sold (liver sales, Bossing). */
export function isSaleStatus(status?: string): boolean {
  const s = String(status || "").trim().toLowerCase();
  return !!s && getSaleStatuses().some((x) => x.toLowerCase() === s);
}
