/**
 * Historical Rate Locking Store
 *
 * All dates are normalized to YYYY-MM-DD before being used as localStorage keys.
 * This ensures that "02/27/2026", "February 27, 2026", "Feb 27, 2026", and "2026-02-27"
 * all map to the same key: rates_2026-02-27.
 *
 * STICKY RATE:
 * A "current default" rate is stored under STICKY_RATES_KEY.
 * When no date-specific rate exists, getRatesForDate() falls back to the sticky rate.
 * This means you only need to update the rate when it actually changes — it persists
 * automatically for all future dates until you change it again.
 */

export interface RateSnapshot {
  phpRate: number;
  silverSellRate: number;
  silverCostRate: number;
  silverBrandedSellRate: number;
  silverBrandedCostRate: number;
  silverRetailRate: number;
  /** Gold rate per gram (AED). 0 = not set. Only used by tenants whose rate
   *  metal is "gold" or "both" (see getRateMetal) — silver-only tenants never
   *  see or use it, so their math is unchanged. */
  goldRate: number;
}

/** Which metal(s) this customer's Daily/Sticky rate is for. Per tenant. */
export type RateMetal = 'silver' | 'gold' | 'both';

export const DEFAULT_RATES: RateSnapshot = {
  phpRate: 17.50,
  silverSellRate: 35,
  silverCostRate: 24,
  silverBrandedSellRate: 35,
  silverBrandedCostRate: 27,
  silverRetailRate: 35,
  goldRate: 0,
};

// ── Rate metal mode (per tenant) ──────────────────────────────────────────────
// Not prefixed "rates_" on purpose: serializeRatesConfig treats every "rates_*"
// key as a date. Cleared on workspace switch via tenantStorage SCOPED_KEYS.
const METAL_KEY = 'rate_metal_mode';

export function getRateMetal(): RateMetal {
  try {
    const v = localStorage.getItem(METAL_KEY);
    if (v === 'gold' || v === 'both' || v === 'silver') return v;
  } catch { /* ignore */ }
  return 'silver'; // default = original behaviour
}

export function setRateMetal(m: RateMetal): void {
  try { localStorage.setItem(METAL_KEY, m); } catch { /* ignore */ }
}

export function usesGold(): boolean { return getRateMetal() !== 'silver'; }
export function usesSilver(): boolean { return getRateMetal() !== 'gold'; }

function num(v: unknown, fallback: number): number {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : fallback;
}

// Key for the persistent sticky/default rate (not date-specific)
const STICKY_RATES_KEY = 'rates_current_default';

/** Get the current sticky default rates (falls back to DEFAULT_RATES if never set). */
export function getStickyRates(): RateSnapshot {
  try {
    const raw = localStorage.getItem(STICKY_RATES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RateSnapshot>;
      return {
        phpRate: parsed.phpRate ?? DEFAULT_RATES.phpRate,
        silverSellRate: parsed.silverRetailRate ?? parsed.silverSellRate ?? DEFAULT_RATES.silverRetailRate,
        silverCostRate: parsed.silverCostRate ?? DEFAULT_RATES.silverCostRate,
        silverBrandedSellRate: parsed.silverRetailRate ?? parsed.silverBrandedSellRate ?? DEFAULT_RATES.silverRetailRate,
        silverBrandedCostRate: parsed.silverBrandedCostRate ?? DEFAULT_RATES.silverBrandedCostRate,
        silverRetailRate: parsed.silverRetailRate ?? DEFAULT_RATES.silverRetailRate,
        goldRate: num(parsed.goldRate, DEFAULT_RATES.goldRate),
      };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_RATES };
}

/** Save a rate snapshot as the persistent sticky default (applies to all future dates with no override). */
export function setStickyRates(rates: RateSnapshot): void {
  try {
    localStorage.setItem(STICKY_RATES_KEY, JSON.stringify(rates));
  } catch (e) {
    console.error('ratesStore: failed to save sticky rates', e);
  }
}

// ── Historical PHP Rates ──────────────────────────────────────────────────────
// Hardcoded date-range → phpRate so ALL users get correct historical rates
// without needing localStorage set on their device.
// Sorted newest-first so the first match wins.
interface HistoricalRange {
  from: string; // YYYY-MM-DD inclusive
  to: string;   // YYYY-MM-DD inclusive
  phpRate: number;
}

const HISTORICAL_PHP_RATES: HistoricalRange[] = [
  { from: '2026-04-07', to: '2026-12-31', phpRate: 17.50 }, // locked April 07 — update upper bound when rate changes
  { from: '2026-03-17', to: '2026-04-06', phpRate: 16.80 },
  { from: '2026-03-01', to: '2026-03-16', phpRate: 16.70 },
  { from: '2026-02-22', to: '2026-02-28', phpRate: 16.50 },
  { from: '2026-02-16', to: '2026-02-21', phpRate: 16.60 },
];

function getHistoricalPhpRate(normalizedDate: string): number | null {
  if (!normalizedDate) return null;
  for (const range of HISTORICAL_PHP_RATES) {
    if (normalizedDate >= range.from && normalizedDate <= range.to) {
      return range.phpRate;
    }
  }
  return null;
}

// ── Date Normalization ────────────────────────────────────────────────────────
function normalizeDate(date: string): string {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return date.trim();
  const mdyMatch = date.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
  }
  try {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      const utc = new Date(d.getTime() + d.getTimezoneOffset() * 60000);
      const yyyy = utc.getFullYear();
      const mm = String(utc.getMonth() + 1).padStart(2, '0');
      const dd = String(utc.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch { /* fall through */ }
  return date.trim();
}

const KEY = (date: string) => `rates_${normalizeDate(date)}`;
const LOCK_KEY = (date: string) => `rates_lock_${normalizeDate(date)}`;

/** Save a full rate snapshot for a specific date (any date format accepted). */
export function saveRatesForDate(date: string, rates: RateSnapshot): void {
  if (!date) return;
  try {
    localStorage.setItem(KEY(date), JSON.stringify(rates));
  } catch (e) {
    console.error('ratesStore: failed to save', e);
  }
}

/**
 * Retrieve the rate snapshot for a date (any format).
 * Falls back to STICKY RATES (not hardcoded defaults) when no date-specific rate is found.
 * This means once you set a sticky rate, all future dates automatically use it.
 *
 * IMPORTANT: The hardcoded HISTORICAL_PHP_RATES table ALWAYS wins for phpRate,
 * even when localStorage has a per-date entry. This prevents stale localStorage
 * overrides from producing wrong invoice prices (e.g. rate locked at 16.5 when
 * the correct historical rate for that date is 16.7).
 * Silver sell/cost rates are still read from localStorage so manual overrides work.
 */
export function getRatesForDate(date: string): RateSnapshot {
  // Resolve the authoritative phpRate for this date from the hardcoded table first.
  const historicalPhpRate = date ? getHistoricalPhpRate(normalizeDate(date)) : null;

  if (date) {
    try {
      const raw = localStorage.getItem(KEY(date));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RateSnapshot>;
        const retail = parsed.silverRetailRate ?? DEFAULT_RATES.silverRetailRate;
        return {
          phpRate: historicalPhpRate ?? parsed.phpRate ?? DEFAULT_RATES.phpRate,
          silverSellRate: retail,
          silverCostRate: parsed.silverCostRate ?? DEFAULT_RATES.silverCostRate,
          silverBrandedSellRate: retail,
          silverBrandedCostRate: parsed.silverBrandedCostRate ?? DEFAULT_RATES.silverBrandedCostRate,
          silverRetailRate: retail,
          goldRate: num(parsed.goldRate, getStickyRates().goldRate),
        };
      }
    } catch (e) {
      console.error('ratesStore: failed to read', e);
    }

    // No localStorage override — check hardcoded historical table
    if (historicalPhpRate !== null) {
      const sticky = getStickyRates();
      return { ...sticky, phpRate: historicalPhpRate };
    }
  }
  // No date-specific rate — use the sticky default
  return getStickyRates();
}

/** Returns true only if a snapshot was explicitly saved for this date (not just defaults). */
export function hasRatesSnapshotForDate(date: string): boolean {
  if (!date) return false;
  return localStorage.getItem(KEY(date)) !== null;
}

// ── Rate Lock / Unlock ────────────────────────────────────────────────────────

export function isRateLockedForDate(date: string): boolean {
  if (!date) return false;
  return localStorage.getItem(LOCK_KEY(date)) === 'true';
}

export function lockRatesForDate(date: string): void {
  if (!date) return;
  localStorage.setItem(LOCK_KEY(date), 'true');
}

export function unlockRatesForDate(date: string): void {
  if (!date) return;
  localStorage.removeItem(LOCK_KEY(date));
}

// ── Convenience getters ───────────────────────────────────────────────────────

export const DEFAULT_PHP_RATE = DEFAULT_RATES.phpRate;
export const DEFAULT_SILVER_SELL_RATE = DEFAULT_RATES.silverSellRate;
export const DEFAULT_SILVER_BRANDED_SELL_RATE = DEFAULT_RATES.silverBrandedSellRate;
export const DEFAULT_SILVER_COST_RATE = DEFAULT_RATES.silverCostRate;
export const DEFAULT_SILVER_BRANDED_COST_RATE = DEFAULT_RATES.silverBrandedCostRate;

export function getPhpRate(date: string): number { return getRatesForDate(date).phpRate; }
export function getSilverSellRate(date: string): number { return getRatesForDate(date).silverSellRate; }
export function getSilverBrandedSellRate(date: string): number { return getRatesForDate(date).silverBrandedSellRate; }
export function getSilverCostRate(date: string): number { return getRatesForDate(date).silverCostRate; }
export function getSilverBrandedCostRate(date: string): number { return getRatesForDate(date).silverBrandedCostRate; }
export function getGoldRate(date: string): number { return getRatesForDate(date).goldRate; }

function patchDate(date: string, patch: Partial<RateSnapshot>) {
  saveRatesForDate(date, { ...getRatesForDate(date), ...patch });
}
export function setPhpRate(date: string, rate: number) {
  patchDate(date, { phpRate: rate });
  // S4 FIX: Sync to backend after local save
  try {
    import('@/lib/api').then(({ saveRatesConfig }) => {
      saveRatesConfig({ config: serializeRatesConfig() }).catch(e => console.error('Rate sync failed:', e));
    });
  } catch (e) { console.error('Rate sync failed:', e); }
}
export function setSilverSellRate(date: string, rate: number) { patchDate(date, { silverSellRate: rate }); }
export function setSilverBrandedSellRate(date: string, rate: number) { patchDate(date, { silverBrandedSellRate: rate }); }
export function setSilverCostRate(date: string, rate: number) { patchDate(date, { silverCostRate: rate }); }
export function setSilverBrandedCostRate(date: string, rate: number) { patchDate(date, { silverBrandedCostRate: rate }); }

// ── Backend Config Sync ───────────────────────────────────────────────────────

export interface RatesConfig {
  /** Which metal the Daily/Sticky rate is for (per tenant). Missing = silver. */
  metal?: RateMetal;
  sticky?: Partial<RateSnapshot>;
  dates?: Record<string, { rates: Partial<RateSnapshot>; locked: boolean }>;
}

/** Serialize current localStorage rates state into a config blob for backend storage. */
export function serializeRatesConfig(): string {
  const config: RatesConfig = { metal: getRateMetal(), sticky: getStickyRates(), dates: {} };
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith('rates_') && k !== STICKY_RATES_KEY && !k.startsWith('rates_lock_')) {
      const dateKey = k.replace('rates_', '');
      try {
        const rates = JSON.parse(localStorage.getItem(k) || '') as Partial<RateSnapshot>;
        const locked = localStorage.getItem(`rates_lock_${dateKey}`) === 'true';
        config.dates![dateKey] = { rates, locked };
      } catch { /* skip */ }
    }
  }
  return JSON.stringify(config);
}

/** Apply a config blob from the backend into localStorage (merges — doesn't clear existing). */
export function applyRatesConfig(configJson: string): void {
  if (!configJson) return;
  try {
    const config = JSON.parse(configJson) as RatesConfig;
    setRateMetal(config.metal === 'gold' || config.metal === 'both' ? config.metal : 'silver');
    if (config.sticky) {
      const retail = (config.sticky as any).silverRetailRate ?? config.sticky.silverSellRate ?? DEFAULT_RATES.silverRetailRate;
      setStickyRates({
        phpRate: config.sticky.phpRate ?? DEFAULT_RATES.phpRate,
        silverSellRate: retail,
        silverCostRate: config.sticky.silverCostRate ?? DEFAULT_RATES.silverCostRate,
        silverBrandedSellRate: retail,
        silverBrandedCostRate: config.sticky.silverBrandedCostRate ?? DEFAULT_RATES.silverBrandedCostRate,
        silverRetailRate: retail,
        goldRate: num((config.sticky as any).goldRate, DEFAULT_RATES.goldRate),
      });
    }
    if (config.dates) {
      for (const [dateKey, entry] of Object.entries(config.dates)) {
        const existing = getStickyRates();
        const retail = (entry.rates as any).silverRetailRate ?? entry.rates.silverSellRate ?? existing.silverRetailRate;
        saveRatesForDate(dateKey, {
          phpRate: entry.rates.phpRate ?? existing.phpRate,
          silverSellRate: retail,
          silverCostRate: entry.rates.silverCostRate ?? existing.silverCostRate,
          silverBrandedSellRate: retail,
          silverBrandedCostRate: entry.rates.silverBrandedCostRate ?? existing.silverBrandedCostRate,
          silverRetailRate: retail,
          goldRate: num((entry.rates as any).goldRate, existing.goldRate),
        });
        if (entry.locked) {
          lockRatesForDate(dateKey);
        } else {
          unlockRatesForDate(dateKey);
        }
      }
    }
  } catch (e) {
    console.error('ratesStore: failed to apply config', e);
  }
}

// Legacy aliases
/** @deprecated Use getRatesForDate(date).silverSellRate */
export function getSilverRateForDate(date: string): number | null {
  const raw = localStorage.getItem(KEY(date));
  if (!raw) return null;
  try { return (JSON.parse(raw) as Partial<RateSnapshot>).silverSellRate ?? null; } catch { return null; }
}
/** @deprecated Use setSilverSellRate */
export function setSilverRate(date: string, rate: number) { setSilverSellRate(date, rate); }
/** @deprecated Use getRatesForDate(date).silverBrandedSellRate */
export function getSilverBrandedRateForDate(date: string): number | null {
  const raw = localStorage.getItem(KEY(date));
  if (!raw) return null;
  try { return (JSON.parse(raw) as Partial<RateSnapshot>).silverBrandedSellRate ?? null; } catch { return null; }
}
/** @deprecated Use setSilverBrandedSellRate */
export function setSilverBrandedRate(date: string, rate: number) { setSilverBrandedSellRate(date, rate); }
export function hasPhpRate(date: string): boolean { return localStorage.getItem(KEY(date)) !== null; }
