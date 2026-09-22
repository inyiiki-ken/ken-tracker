"use client";

/**
 * Per-tenant TAB CONFIG — white-label navigation. Lets the developer choose,
 * per customer, which tabs are visible, rename them (e.g. "Bossing" →
 * "Rexie/Analyn"), and reorder them. Stored in the customer's own sheet
 * (Uploads marker "__TAB_CONFIG__"), loaded once at app start.
 *
 * Only the business tabs are configurable; "settings" and "godmode" are system
 * tabs and always available to whoever already has access to them.
 */

export type ConfigurableTabKey =
  | "admin"
  | "dispatch"
  | "accounts"
  | "bossing"
  | "liver"
  | "purchasing"
  | "invoicing";

export const CONFIGURABLE_TAB_KEYS: ConfigurableTabKey[] = [
  "admin", "dispatch", "accounts", "bossing", "liver", "purchasing", "invoicing",
];

export const DEFAULT_TAB_LABELS: Record<ConfigurableTabKey, string> = {
  admin: "Admin",
  dispatch: "Dispatch",
  accounts: "Accounts",
  bossing: "Bossing",
  liver: "Liver",
  purchasing: "Purchasing",
  invoicing: "Invoicing",
};

export interface TabOverride {
  visible?: boolean; // default true
  label?: string; // default DEFAULT_TAB_LABELS[key]
}

export interface TabConfig {
  overrides: Partial<Record<ConfigurableTabKey, TabOverride>>;
  order?: ConfigurableTabKey[];
}

const STORAGE_KEY = "tab_config";

const EMPTY: TabConfig = { overrides: {} };

let _config: TabConfig = loadFromCache();

function loadFromCache(): TabConfig {
  if (typeof localStorage === "undefined") return { overrides: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return { overrides: {} };
}

function normalize(partial: Partial<TabConfig> | null | undefined): TabConfig {
  const p = partial ?? {};
  const overrides: TabConfig["overrides"] = {};
  for (const key of CONFIGURABLE_TAB_KEYS) {
    const o = p.overrides?.[key];
    if (o) {
      overrides[key] = {
        visible: typeof o.visible === "boolean" ? o.visible : undefined,
        label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : undefined,
      };
    }
  }
  const order = Array.isArray(p.order)
    ? p.order.filter((k): k is ConfigurableTabKey => CONFIGURABLE_TAB_KEYS.includes(k as ConfigurableTabKey))
    : undefined;
  return { overrides, order };
}

export function getTabConfig(): TabConfig {
  return _config;
}

export function setTabConfig(config: TabConfig): void {
  _config = normalize(config);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_config));
  } catch { /* ignore */ }
}

export function applyTabConfig(json: string): void {
  if (!json) return;
  try {
    setTabConfig(normalize(JSON.parse(json)));
  } catch { /* ignore */ }
}

export function serializeTabConfig(): string {
  return JSON.stringify(_config);
}

// ── Helpers used by the nav ───────────────────────────────────────────────────

export function getTabLabel(key: string): string {
  const k = key as ConfigurableTabKey;
  if (!CONFIGURABLE_TAB_KEYS.includes(k)) return key; // system tab: keep as-is
  return _config.overrides[k]?.label || DEFAULT_TAB_LABELS[k];
}

/** A configurable tab is hidden only when explicitly set visible=false. */
export function isTabHidden(key: string): boolean {
  const k = key as ConfigurableTabKey;
  if (!CONFIGURABLE_TAB_KEYS.includes(k)) return false;
  return _config.overrides[k]?.visible === false;
}

/** Order configurable keys per config; any not listed keep their natural order. */
export function orderConfigurableKeys(keys: ConfigurableTabKey[]): ConfigurableTabKey[] {
  const order = _config.order;
  if (!order || order.length === 0) return keys;
  const inOrder = order.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !inOrder.includes(k));
  return [...inOrder, ...rest];
}
