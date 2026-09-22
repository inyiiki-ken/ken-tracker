"use client";

/**
 * Per-tenant PRICING CONFIG — the numbers that used to be hardcoded in
 * calculations.ts / AddClientModal.tsx:
 *   - USD→AED conversion
 *   - gold making-charge (MC) tiers by category
 *   - per-piece supplier rates (by T.O.G) + the Buy-1-Take-1 multiplier
 *
 * Stored in the tenant's own Google Sheet (Uploads marker "__PRICING_CONFIG__")
 * so it applies for every user/device of that customer, and is editable by the
 * developer in God Mode / Settings. A module-level singleton (loaded once at
 * app start via applyPricingConfig) lets the pure calc functions read it
 * synchronously without threading config through every call.
 *
 * NOTE: PHP rate and silver sell/cost rates already live in the rates config
 * (ratesStore.ts + "__RATES_CONFIG__"), edited via the Daily Rates editor —
 * they are intentionally not duplicated here.
 */

export interface PricingConfig {
  usdToAed: number;
  /** MC added on top of the gold rate, keyed by category label. */
  makingCharges: Record<string, number>;
  /** Fixed supplier price for "Per PC" items, keyed by T.O.G (plus `default`). */
  perPcRates: Record<string, number>;
  /** Fallback per-pc/screw supplier rate used in cost math when none is set. */
  perPcFallback: number;
  /** Multiplier applied to per-pc rate for Buy-1-Take-1 items. */
  b1t1Multiplier: number;
  /** Credit-card surcharge as a percent (e.g. 5 = 5%). */
  ccSurchargePct: number;
  /** Default for whether the CC surcharge includes shipping (per-invoice toggle can override). */
  ccIncludeShipping: boolean;
  /** Shipping fee per region (lowercase key match). Editable in Settings. */
  shippingFees: Record<string, number>;
  /** Fee used when the region isn't in the list above. */
  shippingFeeDefault: number;
  /** Fee for Pinas / International deliveries. */
  shippingFeeInternational: number;
  /** Fee for a Meet Up. */
  shippingFeeMeetUp: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  usdToAed: 3.67,
  makingCharges: {
    "Gold Normal": 16,
    "Special Price": 21,
    "Special Price EF": 25,
    "Silver Normal": 0,
    "Silver Branded": 0,
    "VCA": 16,
    "Diamond": 0,
    "Per PC": 0,
    "Other": 16,
  },
  perPcRates: {
    "S-925": 32,
    default: 115,
  },
  perPcFallback: 115,
  b1t1Multiplier: 2,
  ccSurchargePct: 5,
  ccIncludeShipping: false,
  // Dubai & Sharjah are the near zones; everything else is the far rate.
  shippingFees: {
    "dubai": 25,
    "sharjah": 25,
    "abu dhabi": 35,
    "ras al khaima": 35,
    "ras al khaimah": 35,
    "ras al-khaimah": 35,
    "r.a.k": 35,
    "rak": 35,
    "fujairah": 35,
    "western": 35,
    "ajman": 35,
    "umm al quwain": 35,
    "uaq": 35,
    "al ain": 35,
  },
  shippingFeeDefault: 35,
  shippingFeeInternational: 299,
  shippingFeeMeetUp: 0,
};

const STORAGE_KEY = "pricing_config";

// Module singleton read by calculations.ts. Starts at defaults; overwritten by
// applyPricingConfig() once the tenant's saved config loads.
let _pricing: PricingConfig = loadFromCache();

function loadFromCache(): PricingConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_PRICING };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return mergeConfig(JSON.parse(raw));
  } catch { /* ignore */ }
  return { ...DEFAULT_PRICING };
}

function mergeConfig(partial: Partial<PricingConfig> | null | undefined): PricingConfig {
  const p = partial ?? {};
  return {
    usdToAed: typeof p.usdToAed === "number" && p.usdToAed > 0 ? p.usdToAed : DEFAULT_PRICING.usdToAed,
    makingCharges: { ...DEFAULT_PRICING.makingCharges, ...(p.makingCharges ?? {}) },
    perPcRates: { ...DEFAULT_PRICING.perPcRates, ...(p.perPcRates ?? {}) },
    perPcFallback:
      typeof p.perPcFallback === "number" && p.perPcFallback > 0 ? p.perPcFallback : DEFAULT_PRICING.perPcFallback,
    b1t1Multiplier:
      typeof p.b1t1Multiplier === "number" && p.b1t1Multiplier > 0 ? p.b1t1Multiplier : DEFAULT_PRICING.b1t1Multiplier,
    ccSurchargePct:
      typeof p.ccSurchargePct === "number" && p.ccSurchargePct >= 0 ? p.ccSurchargePct : DEFAULT_PRICING.ccSurchargePct,
    ccIncludeShipping: typeof p.ccIncludeShipping === "boolean" ? p.ccIncludeShipping : DEFAULT_PRICING.ccIncludeShipping,
    shippingFees: { ...DEFAULT_PRICING.shippingFees, ...(p.shippingFees ?? {}) },
    shippingFeeDefault:
      typeof p.shippingFeeDefault === "number" && p.shippingFeeDefault >= 0 ? p.shippingFeeDefault : DEFAULT_PRICING.shippingFeeDefault,
    shippingFeeInternational:
      typeof p.shippingFeeInternational === "number" && p.shippingFeeInternational >= 0 ? p.shippingFeeInternational : DEFAULT_PRICING.shippingFeeInternational,
    shippingFeeMeetUp:
      typeof p.shippingFeeMeetUp === "number" && p.shippingFeeMeetUp >= 0 ? p.shippingFeeMeetUp : DEFAULT_PRICING.shippingFeeMeetUp,
  };
}

/** Current effective pricing config (synchronous). */
export function getPricing(): PricingConfig {
  return _pricing;
}

/** Overwrite the in-memory config and cache it. */
export function setPricing(config: PricingConfig): void {
  _pricing = mergeConfig(config);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_pricing));
  } catch { /* ignore */ }
}

/** Apply a JSON blob loaded from the tenant sheet at app start. */
export function applyPricingConfig(configJson: string): void {
  if (!configJson) return;
  try {
    setPricing(mergeConfig(JSON.parse(configJson)));
  } catch { /* ignore malformed */ }
}

export function serializePricingConfig(): string {
  return JSON.stringify(_pricing);
}

// ── Convenience getters used by calculations / forms ──────────────────────────

export function getUsdToAed(): number {
  return _pricing.usdToAed || DEFAULT_PRICING.usdToAed;
}

/** MC for a category (case-insensitive match); 0 if the category has none. */
export function getMakingCharge(category: string): number {
  if (!category) return 0;
  const map = _pricing.makingCharges;
  if (category in map) return map[category];
  const lc = category.toLowerCase();
  const key = Object.keys(map).find((k) => k.toLowerCase() === lc);
  return key ? map[key] : 0;
}

/** Per-PC supplier rate for a T.O.G, falling back to the `default` entry. */
export function getPerPcRate(tog: string): number {
  const map = _pricing.perPcRates;
  if (tog && tog in map) return map[tog];
  const lc = (tog || "").toLowerCase();
  const key = Object.keys(map).find((k) => k.toLowerCase() === lc);
  if (key) return map[key];
  return map.default ?? _pricing.perPcFallback;
}

export function getPerPcFallback(): number {
  return _pricing.perPcFallback || DEFAULT_PRICING.perPcFallback;
}

export function getB1t1Multiplier(): number {
  return _pricing.b1t1Multiplier || DEFAULT_PRICING.b1t1Multiplier;
}

/** CC surcharge as a fraction (e.g. 0.05 for 5%). */
export function getCcSurchargeRate(): number {
  const pct = typeof _pricing.ccSurchargePct === "number" ? _pricing.ccSurchargePct : DEFAULT_PRICING.ccSurchargePct;
  return pct / 100;
}

export function getCcIncludeShipping(): boolean {
  return !!_pricing.ccIncludeShipping;
}

/** Shipping fee for a region label (case-insensitive contains match). */
export function getShippingFeeForRegion(regionLabel: string): number {
  const cfg = getPricing();
  const hay = String(regionLabel ?? "").toLowerCase();
  if (!hay) return cfg.shippingFeeDefault;
  // Longest key first so "ras al khaimah" wins over a shorter partial.
  const keys = Object.keys(cfg.shippingFees).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (hay.includes(k)) return cfg.shippingFees[k];
  }
  return cfg.shippingFeeDefault;
}

export function getShippingFeeInternational(): number {
  return getPricing().shippingFeeInternational;
}

export function getShippingFeeMeetUp(): number {
  return getPricing().shippingFeeMeetUp;
}
