"use client";

/**
 * Per-tenant BUSINESS / INDUSTRY config — makes the app an all-in-one tracker
 * rather than jewellery-only. The key switch is the pricing MODE:
 *
 *   - "weight" (jewellery): price/cost derive from grams × rate + making charge,
 *     with the gold/silver/per-pc rules. This is the original behaviour.
 *   - "unit"   (retail / cosmetics / apparel): price = unit price × qty,
 *     cost = unit cost × qty. No grams, no gold rate — just per-item pricing.
 *
 * Stored in the tenant's own sheet (Uploads marker "__BUSINESS_CONFIG__"),
 * loaded once at app start. A module singleton lets the pure calc functions
 * read it synchronously.
 */

export type BusinessMode = "weight" | "unit";

export interface BusinessConfig {
  mode: BusinessMode;
  /** Just a friendly label for the chosen template (jewellery/retail/…). */
  preset: string;
  /**
   * Customer's timezone offset in hours (UAE = 4). Used for "today" and overdue
   * maths. Was hardcoded to +4, which silently produced wrong dates for any
   * customer outside the UAE.
   */
  timezoneOffsetHours: number;
}

export const DEFAULT_BUSINESS: BusinessConfig = { mode: "weight", preset: "jewellery", timezoneOffsetHours: 4 };

/** Customer timezone offset in milliseconds. */
export function getTimezoneOffsetMs(): number {
  const h = getBusinessConfig().timezoneOffsetHours;
  return (Number.isFinite(h) ? h : 4) * 60 * 60 * 1000;
}

/** "Today" in the customer's timezone, as YYYY-MM-DD. */
export function todayLocalISO(): string {
  return new Date(Date.now() + getTimezoneOffsetMs()).toISOString().split("T")[0];
}

export const BUSINESS_PRESETS: { id: string; label: string; mode: BusinessMode; hint: string }[] = [
  { id: "jewellery", label: "Jewellery (weight-based)", mode: "weight", hint: "Grams × rate + making charge; gold/silver/per-pc rules." },
  { id: "retail", label: "Retail / Apparel (per item)", mode: "unit", hint: "Unit price × qty. No grams or gold rate." },
  { id: "cosmetics", label: "Cosmetics (per item)", mode: "unit", hint: "Unit price × qty. No grams or gold rate." },
  { id: "custom-unit", label: "Custom — per item", mode: "unit", hint: "Unit price × qty." },
  { id: "custom-weight", label: "Custom — weight based", mode: "weight", hint: "Weight × rate + making charge." },
];

const STORAGE_KEY = "business_config";

let _cfg: BusinessConfig = loadFromCache();

function loadFromCache(): BusinessConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_BUSINESS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return { ...DEFAULT_BUSINESS };
}

function normalize(p: Partial<BusinessConfig> | null | undefined): BusinessConfig {
  const mode: BusinessMode = p?.mode === "unit" ? "unit" : "weight";
  const tz = typeof p?.timezoneOffsetHours === "number" ? p.timezoneOffsetHours : DEFAULT_BUSINESS.timezoneOffsetHours;
  return {
    mode,
    preset: (p?.preset && String(p.preset)) || (mode === "unit" ? "retail" : "jewellery"),
    timezoneOffsetHours: tz,
  };
}

export function getBusinessConfig(): BusinessConfig {
  return _cfg;
}

export function getBusinessMode(): BusinessMode {
  return _cfg.mode;
}

export function isUnitMode(): boolean {
  return _cfg.mode === "unit";
}

export function setBusinessConfig(config: BusinessConfig): void {
  _cfg = normalize(config);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_cfg));
  } catch { /* ignore */ }
}

export function applyBusinessConfig(json: string): void {
  if (!json) return;
  try {
    setBusinessConfig(normalize(JSON.parse(json)));
  } catch { /* ignore */ }
}

export function serializeBusinessConfig(): string {
  return JSON.stringify(_cfg);
}
