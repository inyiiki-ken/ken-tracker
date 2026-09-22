"use client";

import { isUnitMode } from "@/lib/businessConfig";

/**
 * Per-tenant TERMINOLOGY. The jewellery app hardcodes labels like "Miner Name"
 * and "Liver". For retail/cosmetics those read wrong, so labels are resolved
 * through here: a mode-aware default (jewellery vs per-item) plus optional
 * per-tenant custom overrides, stored in the tenant sheet (Uploads marker
 * "__LABEL_CONFIG__").
 *
 * Kept to the handful of customer-facing terms that actually change meaning by
 * industry — not every string in the app.
 */

export type LabelKey =
  | "minerName"
  | "liverName"
  | "page"
  | "clientRate"
  | "supplierRate"
  | "itemDescription";

export const LABEL_KEYS: LabelKey[] = [
  "minerName", "liverName", "page", "clientRate", "supplierRate", "itemDescription",
];

const DEFAULTS_WEIGHT: Record<LabelKey, string> = {
  minerName: "Client Name",
  liverName: "Liver Name",
  page: "Page",
  clientRate: "Client Rate",
  supplierRate: "Supplier Rate",
  itemDescription: "Item Description",
};

const DEFAULTS_UNIT: Record<LabelKey, string> = {
  minerName: "Customer",
  liverName: "Seller",
  page: "Store",
  clientRate: "Unit Price",
  supplierRate: "Unit Cost",
  itemDescription: "Product",
};

export interface LabelConfig {
  overrides: Partial<Record<LabelKey, string>>;
}

const STORAGE_KEY = "label_config";

let _cfg: LabelConfig = loadFromCache();

function loadFromCache(): LabelConfig {
  if (typeof localStorage === "undefined") return { overrides: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return { overrides: {} };
}

function normalize(p: Partial<LabelConfig> | null | undefined): LabelConfig {
  const overrides: LabelConfig["overrides"] = {};
  for (const k of LABEL_KEYS) {
    const v = p?.overrides?.[k];
    if (typeof v === "string" && v.trim()) overrides[k] = v.trim();
  }
  return { overrides };
}

export function getLabelConfig(): LabelConfig {
  return _cfg;
}

export function setLabelConfig(config: LabelConfig): void {
  _cfg = normalize(config);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_cfg));
  } catch { /* ignore */ }
}

export function applyLabelConfig(json: string): void {
  if (!json) return;
  try { setLabelConfig(normalize(JSON.parse(json))); } catch { /* ignore */ }
}

export function serializeLabelConfig(): string {
  return JSON.stringify(_cfg);
}

/** The mode-aware default label for a key (before any custom override). */
export function getDefaultLabel(key: LabelKey): string {
  return (isUnitMode() ? DEFAULTS_UNIT : DEFAULTS_WEIGHT)[key];
}

/** The effective label: custom override → mode default. */
export function getFieldLabel(key: LabelKey): string {
  return _cfg.overrides[key] || getDefaultLabel(key);
}
