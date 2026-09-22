"use client";

/**
 * CENTRAL EDITABLE DROPDOWN LISTS.
 *
 * Every choice list in the app (Mode of Payment, Region, Category, Currency,
 * T.O.G, Source, Mode of Sale, Location, Remittance Status …) resolves through
 * here, so the developer can add/remove values in Settings without code changes.
 *
 * Resolution order for a list:
 *   1. The customer's saved list in Settings  → wins EXACTLY (deletions stick)
 *   2. Values discovered in the customer's own data (so nothing already in use disappears)
 *   3. Built-in defaults (only when 1 and 2 are empty)
 *
 * The key detail: when the developer has saved a list, it is used verbatim —
 * previously the forms merged a hardcoded fallback back in, which is why
 * removed Categories kept reappearing.
 */

import type { DatabaseRowType } from "@/types";

export type OptionKey =
  | "modeOfPayment"
  | "region"
  | "tog"
  | "category"
  | "currency"
  | "modeOfSale"
  | "source"
  | "location"
  | "remittanceStatus"
  | "page";

export interface OptionListDef {
  key: OptionKey;
  label: string;
  /** Field on a record used to discover values already in the customer's data. */
  field?: keyof DatabaseRowType;
  defaults: string[];
}

export const OPTION_LISTS: OptionListDef[] = [
  {
    key: "modeOfPayment",
    label: "Mode of Payment",
    field: "modeOfPayment",
    defaults: [
      "COD", "Bank Transfer", "Bank Transfer PHP", "GCash", "Credit Card",
      "Tabby", "Tamara", "Botim", "Cash", "Pick Up Shop", "Meet Up",
      "Western Union", "International",
    ],
  },
  {
    key: "region",
    label: "Region",
    field: "regions",
    defaults: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "RAK", "Fujairah", "UAQ", "Al Ain", "Pinas", "International"],
  },
  { key: "tog", label: "T.O.G", field: "tog", defaults: ["S-925", "18K", "21K", "22K", "24K", "VCA"] },
  {
    key: "category",
    label: "Category",
    field: "category",
    defaults: ["Gold Normal", "Special Price", "Special Price EF", "Silver Normal", "Silver Branded", "VCA", "Per PC", "Diamond", "Other"],
  },
  { key: "currency", label: "Currency", field: "currency", defaults: ["AED", "PHP", "USD"] },
  { key: "modeOfSale", label: "Mode of Sale", field: "modeOfSale", defaults: ["Live", "Dropshipping", "In-Store", "Offline"] },
  { key: "source", label: "Source", field: "source", defaults: [] },
  { key: "location", label: "Location", field: "locationOfMiner", defaults: ["Local", "Pinas", "International"] },
  { key: "remittanceStatus", label: "Remittance Status", field: "remittanceStatus", defaults: ["Pending", "Remitted", "Cleared", "N/A"] },
  { key: "page", label: "Page", field: "page", defaults: [] },
];

export type OptionsConfig = Partial<Record<OptionKey, string[]>>;

const STORAGE_KEY = "options_config";

let _cfg: OptionsConfig = loadFromCache();
// Values discovered in the customer's loaded records.
let _discovered: Partial<Record<OptionKey, string[]>> = {};

function normalize(p: unknown): OptionsConfig {
  const out: OptionsConfig = {};
  if (p && typeof p === "object") {
    for (const def of OPTION_LISTS) {
      const v = (p as Record<string, unknown>)[def.key];
      if (Array.isArray(v)) {
        out[def.key] = v.map(String).map((s) => s.trim()).filter(Boolean);
      }
    }
  }
  return out;
}

function loadFromCache(): OptionsConfig {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return {};
}

export function getOptionsConfig(): OptionsConfig {
  return _cfg;
}

export function setOptionsConfig(cfg: OptionsConfig): void {
  _cfg = normalize(cfg);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_cfg));
  } catch { /* ignore */ }
}

export function applyOptionsConfig(json: string): void {
  if (!json) return;
  try { setOptionsConfig(normalize(JSON.parse(json))); } catch { /* ignore */ }
}

export function serializeOptionsConfig(): string {
  return JSON.stringify(_cfg);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw ?? "").trim();
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

/** Record the values actually present in this customer's data (called on load). */
export function setDiscoveredOptions(records: DatabaseRowType[]): void {
  const found: Partial<Record<OptionKey, string[]>> = {};
  for (const def of OPTION_LISTS) {
    if (!def.field) continue;
    const seen = new Set<string>();
    const vals: string[] = [];
    for (const r of records) {
      const v = String((r as Record<string, unknown>)[def.field] ?? "").trim();
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); vals.push(v); }
    }
    found[def.key] = vals.sort((a, b) => a.localeCompare(b));
  }
  _discovered = found;
}

/**
 * The options to show for a list. A saved list wins EXACTLY (so removals stick).
 * `current` is always included so an existing record never loses its value.
 */
export function getOptions(key: OptionKey, current?: string): string[] {
  const def = OPTION_LISTS.find((d) => d.key === key);
  const saved = _cfg[key];

  let base: string[];
  if (saved && saved.length > 0) {
    base = saved; // verbatim — deletions are respected
  } else {
    const discovered = _discovered[key] ?? [];
    base = discovered.length > 0 ? [...discovered, ...(def?.defaults ?? [])] : (def?.defaults ?? []);
  }

  const list = dedupe(base);
  if (current) {
    const has = list.some((s) => s.toLowerCase() === current.toLowerCase());
    if (!has) return [current, ...list];
  }
  return list;
}

/** Defaults + whatever is in the data — used to prefill the Settings editor. */
export function getSuggestedOptions(key: OptionKey): string[] {
  const def = OPTION_LISTS.find((d) => d.key === key);
  return dedupe([...(_discovered[key] ?? []), ...(def?.defaults ?? [])]);
}
