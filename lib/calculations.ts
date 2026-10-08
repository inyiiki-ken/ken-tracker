import { DatabaseRowType } from '@/types';
import { parseISO, isValid } from 'date-fns';
import { getRatesForDate, RateSnapshot, usesGold } from '@/lib/ratesStore';
import { parseBillingModifiers, getTotalChargesAED, getTotalDiscountsAED } from '@/lib/billingModifiers';
import { getTimezoneOffsetMs } from '@/lib/businessConfig';
import { getMakingCharge, getPricing, paymentPriceMultiplier } from '@/lib/pricingConfig';
import { getMasterlistMapping } from '@/lib/masterlistMapping';
import { getUsdToAed, getPerPcFallback, getB1t1Multiplier, getCcSurchargeRate, getShippingFeeForRegion, getShippingFeeInternational, getShippingFeeMeetUp } from '@/lib/pricingConfig';
import { isUnitMode } from '@/lib/businessConfig';

export function parseNum(x: unknown): number {
  const cleaned = String(x ?? '').replace(/,/g, '');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : 0;
}
const n = parseNum;
/** Half-up to whole units, immune to float noise (2.30 × 445 = 1023.4999… → 1024). */
export function roundPrice(v: number): number {
  const x = Number(v) || 0;
  return Math.sign(x) * Math.round(Math.abs(Number(x.toFixed(6))));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A calendar day at local noon (so no timezone pushes it to the day before/after). */
function dayAt(y: number, m: number, d: number, h = 12, min = 0, sec = 0): Date | null {
  if (y < 100) y += 2000;
  const out = new Date(y, m - 1, d, h, min, sec);
  // Reject overflow (31/02 → Mar 3).
  if (out.getFullYear() !== y || out.getMonth() !== m - 1 || out.getDate() !== d) return null;
  return out;
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/**
 * A date typed or stored in any of the sheet's formats. Never relies on the
 * browser's own parsing of non-ISO text (iPhone Safari rejects most of it):
 *   2026-09-24 / 2026/09/24 / 2026-09-24T08:00:00Z → year first
 *   9/24/2026, 9/24/2026 14:05:00        → month first (Google Sheets)
 *   26/09/2026                           → day first when the first part is above 12
 *   24.09.2026                           → day first
 *   September 24, 2026 / Sep 24 2026 / 24 Sep 2026 (a leading weekday is ignored)
 * A date without a time is placed at local noon.
 */
export function parseDateRobust(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const s = String(dateStr).trim().replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
  if (!s) return null;

  const ymd = s.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/);
  if (ymd) return dayAt(+ymd[1], +ymd[3], +ymd[4]);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(s)) {
    // "2026-09-24 12:00:00 +0400" → "2026-09-24T12:00:00+0400"
    const iso = parseISO(s.replace(' ', 'T').replace(/\s+([+-]\d{2}:?\d{2}|Z)$/i, '$1'));
    if (isValid(iso)) return iso;
  }

  const num = s.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i);
  if (num) {
    const a = +num[1], b = +num[3], y = +num[4];
    const dayFirst = num[2] === '.' || a > 12;
    let h = num[5] !== undefined ? +num[5] : 12;
    const ap = num[8]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const min = num[6] !== undefined ? +num[6] : 0;
    const sec = num[7] !== undefined ? +num[7] : 0;
    return dayFirst ? dayAt(y, b, a, h, min, sec) : dayAt(y, a, b, h, min, sec);
  }

  // A 2-digit year needs a gap before it ("Sep 24 26"), so "Sep 2026" is not read as Sep 20.
  const mdy = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4})|(?:,\s*|\s+)(\d{2}))\b/i);
  if (mdy && monthIndex(mdy[1])) return dayAt(+(mdy[3] ?? mdy[4]), monthIndex(mdy[1]), +mdy[2]);
  const dmy = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4}|\d{2})\b/i);
  if (dmy && monthIndex(dmy[2])) return dayAt(+dmy[3], monthIndex(dmy[2]), +dmy[1]);

  const iso = parseISO(s);
  if (isValid(iso)) return iso;
  // Last resort for other text dates with a month name or zone (e.g. Date.toString() output).
  if (/[a-z]{3}/i.test(s)) {
    const nat = new Date(s);
    if (!isNaN(nat.getTime())) return nat;
  }
  return null;
}

export function getQty(record: DatabaseRowType): number {
  return record.qty != null && Number(record.qty) > 0 ? Number(record.qty) : 1;
}

export function isPcItem(record: DatabaseRowType): boolean {
  const grams = n(record.grams);
  return !grams || isNaN(grams) || grams <= 0;
}

/** Sold by the piece (per pc, screw type, diamond): counted in pieces, never in grams. */
export function isPerPiece(record: DatabaseRowType): boolean {
  const cat = (record.category || '').toLowerCase();
  return cat.includes('per pc') || cat.includes('screw type') || cat.includes('diamond');
}

/**
 * Splitting moves some grams to a new row, so only items priced by the gram can
 * be split: a piece / unit price ignores grams, and both rows would carry it.
 */
export function canSplitItem(record: DatabaseRowType): boolean {
  return !isUnitMode() && !isPcItem(record) && !isPerPiece(record);
}

/** Grams of these items, leaving out per-piece items (see pieceCount). */
export function sumGrams(records: DatabaseRowType[]): number {
  return records.reduce((s, r) => (isPerPiece(r) ? s : s + n(r.grams)), 0);
}

/** How many pieces the per-piece items add up to. */
export function pieceCount(records: DatabaseRowType[]): number {
  return records.reduce((s, r) => (isPerPiece(r) ? s + getQty(r) : s), 0);
}

/** One item's weight: "2.10g", or "1 PC" for a per-piece item. */
export function gramsLabel(record: DatabaseRowType): string {
  if (isPerPiece(record)) return `${getQty(record)} PC`;
  return n(record.grams) ? `${n(record.grams).toFixed(2)}g` : '—';
}

/** Several items: "12.40g", or "12.40g + 2 pcs" when some are per-piece. */
export function gramsTotalLabel(records: DatabaseRowType[]): string {
  const pcs = pieceCount(records);
  return `${sumGrams(records).toFixed(2)}g${pcs > 0 ? ` + ${pcs} pc${pcs !== 1 ? 's' : ''}` : ''}`;
}

export function isFreeSf(record: DatabaseRowType): boolean {
  return String(record.freeSf).toLowerCase() === 'true';
}

/** Returns true if the record has a promo (discounted) SF set */
export function isPromoSf(record: DatabaseRowType): boolean {
  return String(record.freeSf ?? '').toUpperCase().startsWith('PROMO:');
}

/**
 * Parses promoSf value from freeSf field.
 * Format: 'PROMO:AED:25' or 'PROMO:PHP:100'
 * Returns { currency, amount } or null if not a promo.
 */
export function getPromoSf(record: DatabaseRowType): { currency: string; amount: number } | null {
  const val = String(record.freeSf ?? '');
  if (!val.toUpperCase().startsWith('PROMO:')) return null;
  const parts = val.split(':');
  if (parts.length < 3) return null;
  const currency = parts[1].toUpperCase();
  const amount = parseFloat(parts[2]);
  if (isNaN(amount)) return null;
  return { currency, amount };
}

function normCurrency(currency?: string): string {
  return (currency || '').toUpperCase().trim();
}

const PHP_MOPS = new Set(['gcash', 'bank transfer php']);

export function getEffectiveCurrency(record: DatabaseRowType): string {
  const curr = normCurrency(record.currency);
  if (curr) return curr;
  if (PHP_MOPS.has((record.modeOfPayment || '').toLowerCase().trim())) return 'PHP';
  if (normCurrency(record.locationOfMiner) === 'PINAS') return 'PHP';
  return 'AED';
}

// STRICT PAYMENT CURRENCY: Rely entirely on Mode of Payment for DP
export function getPaymentCurrency(record: DatabaseRowType): string {
  const mop = (record.modeOfPayment || '').toLowerCase().trim();
  if (mop === 'gcash' || mop === 'bank transfer php') return 'PHP';
  if (mop.includes('aed') || mop.includes('cod') || mop.includes('cash')) return 'AED';
  if (mop.includes('usd') || mop.includes('western union (us)')) return 'USD';
  // Credit card, Tabby, Tamara, Pick Up Shop, Meet Up are always AED-denominated
  if (mop.includes('credit card') || mop.includes('tabby') || mop.includes('tamara') || mop === 'pick up shop' || mop === 'meet up') return 'AED';
  return getEffectiveCurrency(record);
}

export function getSilverRate(category: string, record?: DatabaseRowType): number | null {
  const cat = (category || '').toLowerCase();
  if (record?.dateOfLive) {
    const snap = getRatesForDate(record.dateOfLive);
    if (cat.includes('silver branded')) return snap.silverBrandedSellRate;
    if (cat.includes('silver normal')) return snap.silverSellRate;
  }
  const snap = getRatesForDate('');
  if (cat.includes('silver branded')) return snap.silverBrandedSellRate;
  if (cat.includes('silver normal')) return snap.silverSellRate;
  return null;
}

export function resolveBaseRateAED(record: DatabaseRowType): number {
  const rawRate = n(record.clientRate);
  const curr = getEffectiveCurrency(record);

  if (curr === 'AED') return rawRate;

  const snap: RateSnapshot = getRatesForDate(record.dateOfLive || '');
  const phpRate = snap.phpRate;
  const silverTarget = snap.silverSellRate;
  const brandedTarget = snap.silverBrandedSellRate;

  const category = (record.category || '').toLowerCase();
  const isSilverBranded = category.includes('silver branded');
  const isSilver = !isSilverBranded && category.includes('silver');

  if (curr === 'PHP') {
    const silverPhpAnchor = Math.round(silverTarget * phpRate);
    const brandedPhpAnchor = Math.round(brandedTarget * phpRate);
    if (isSilver && rawRate === silverPhpAnchor) return silverTarget;
    if (isSilverBranded && rawRate === brandedPhpAnchor) return brandedTarget;
    
    const rawAED = rawRate / phpRate;
    // SMART SNAP — 6 AED tolerance for branded, 2 AED for plain silver
    if (isSilverBranded && Math.abs(rawAED - brandedTarget) <= 6) return brandedTarget;
    if (isSilver && Math.abs(rawAED - silverTarget) <= 2) return silverTarget;
    return rawAED;
  }

  if (curr === 'USD') {
    const silverUsdAnchor = Math.round(silverTarget / getUsdToAed());
    const brandedUsdAnchor = Math.round(brandedTarget / getUsdToAed());
    if (isSilver && rawRate === silverUsdAnchor) return silverTarget;
    if (isSilverBranded && rawRate === brandedUsdAnchor) return brandedTarget;
    
    const rawAED = rawRate * getUsdToAed();
    // SMART SNAP — 6 AED tolerance for branded, 2 AED for plain silver
    if (isSilverBranded && Math.abs(rawAED - brandedTarget) <= 6) return brandedTarget;
    if (isSilver && Math.abs(rawAED - silverTarget) <= 2) return silverTarget;
    return rawAED;
  }

  return rawRate;
}

export function toAED(value: number, record?: DatabaseRowType): number {
  if (!value) return 0;
  const curr = record ? getEffectiveCurrency(record) : 'AED';
  if (curr === 'AED') return value;

  const snap = getRatesForDate(record?.dateOfLive || '');
  let rawAED: number;

  if (curr === 'USD') rawAED = value * getUsdToAed();
  else if (curr === 'PHP') rawAED = value / snap.phpRate;
  else return value;

  if (record?.dateOfLive) {
    const category = (record.category || '').toLowerCase();
    if (category.includes('silver branded') && Math.abs(rawAED - snap.silverBrandedSellRate) <= 6) return snap.silverBrandedSellRate;
    if (category.includes('silver') && Math.abs(rawAED - snap.silverSellRate) <= 2) return snap.silverSellRate;
  }

  return rawAED;
}

export function fromAED(value: number, record?: DatabaseRowType): number {
  if (!value) return 0;
  const curr = record ? getEffectiveCurrency(record) : 'AED';
  if (curr === 'USD') return value / getUsdToAed();
  if (curr === 'PHP') {
    const snap = getRatesForDate(record?.dateOfLive || '');
    return value * snap.phpRate;
  }
  return value;
}

export function clientRateAED(record: DatabaseRowType): number {
  const curr = getEffectiveCurrency(record);
  if (curr === 'AED') return n(record.clientRate);
  return resolveBaseRateAED(record);
}

export function calcItemPrice(record: DatabaseRowType): number {
  if (paymentPriceMultiplier(record.modeOfPayment) !== 1) {
    return roundPrice(fromAED(calcItemPriceAED(record), record));
  }
  // Unit (retail/cosmetics) mode: selling price per unit × qty, in native currency.
  if (isUnitMode()) return roundPrice(n(record.clientRate) * getQty(record));

  const clientRate = n(record.clientRate);
  const category = (record.category || '').toLowerCase();
  const silverRate = getSilverRate(category, record);

  if (silverRate !== null) {
    if (clientRate > 0) return roundPrice(n(record.grams) * clientRate);
    return roundPrice(fromAED(n(record.grams) * silverRate, record));
  }

  if (category.includes('per pc') || category.includes('screw type') || category.includes('diamond')) {
    return roundPrice(clientRate * getQty(record));
  }

  if (isPcItem(record)) return roundPrice(clientRate);
  const price = roundPrice(n(record.grams) * clientRate);
  return price > 0 ? price : (clientRate > 0 ? roundPrice(clientRate) : 0);
}

export function calcItemPriceAED(record: DatabaseRowType): number {
  const multiplier = paymentPriceMultiplier(record.modeOfPayment);
  const roundItem = (amount: number) => roundPrice(amount * multiplier);
  // Unit mode: unit price (converted to AED) × qty.
  if (isUnitMode()) return roundItem(clientRateAED(record) * getQty(record));

  const rateAED = clientRateAED(record);
  const category = (record.category || '').toLowerCase();
  const silverRate = getSilverRate(category, record);

  if (silverRate !== null) {
    if (n(record.clientRate) > 0) return roundItem(n(record.grams) * rateAED);
    return roundItem(n(record.grams) * silverRate);
  }

  if (category.includes('per pc') || category.includes('screw type') || category.includes('diamond')) {
    return roundItem(rateAED * getQty(record));
  }

  if (isPcItem(record)) return roundItem(rateAED);
  const price = roundItem(n(record.grams) * rateAED);
  return price > 0 ? price : (rateAED > 0 ? roundItem(rateAED) : 0);
}

export function calcItemCostAED(record: DatabaseRowType): number {
  // Unit mode: unit cost (supplier rate) × qty. Supplier rate is treated as AED.
  if (isUnitMode()) return roundPrice(n(record.supplierRate) * getQty(record));

  const category = (record.category || '').toLowerCase();
  const desc = (record.itemDescription || '').toLowerCase();
  const grams = n(record.grams);
  const rowGoldRate = n(record.goldRate);
  const supplierRate = n(record.supplierRate);
  
  if (category.includes('diamond')) return roundPrice(supplierRate * getQty(record));

  if (category.includes('per pc') || category.includes('screw type')) {
    const fallback = getPerPcFallback();
    let rate = supplierRate > 0 ? supplierRate : rowGoldRate > 0 ? rowGoldRate : fallback;
    // B1T1 multiplier only applies when we're on the fallback per-pc price.
    if (rate === fallback && (desc.includes('buy 1 take 1') || desc.includes('b1t1'))) rate *= getB1t1Multiplier();
    return roundPrice(rate * getQty(record));
  }

  const snap = getRatesForDate(record.dateOfLive || '');
  if (category.includes('silver branded')) return roundPrice(snap.silverBrandedCostRate * grams);
  if (category.includes('silver')) return roundPrice(snap.silverCostRate * grams);

  // Gold-rate customers only: a gold item with no gold rate on the row falls back
  // to that day's Daily/Sticky gold rate. Silver-only customers (the default)
  // never reach this, so their numbers are unchanged.
  // Rate + MC customers (e.g. Crown): gold rate + MC is the SELLING price, so it
  // can't also be the cost. Use the supplier rate when there is one.
  if (getMasterlistMapping().priceMode === 'rate_plus_mc' && supplierRate > 0) {
    if (isPcItem(record)) return roundPrice(supplierRate);
    return roundPrice(supplierRate * grams);
  }

  const goldRate = rowGoldRate > 0 ? rowGoldRate
    : (usesGold() && snap.goldRate > 0 && !category.includes('silver') ? snap.goldRate : 0);

  if (goldRate > 0) {
    // Empty MC → the customer's MC for this category (Settings → Pricing),
    // falling back to the old fixed 16/21/25 only if none is set.
    const parsedMc = n(record.mc);
    const configuredMc = getMakingCharge(record.category || '');
    const effectiveMc = parsedMc > 0 ? parsedMc : configuredMc > 0 ? configuredMc : (category.includes('special price ef') ? 25 : category.includes('special price') ? 21 : 16);
    if (isPcItem(record)) return roundPrice(goldRate + effectiveMc);
    return roundPrice((goldRate + effectiveMc) * grams);
  }

  if (supplierRate > 0) {
    if (isPcItem(record)) return roundPrice(supplierRate);
    return roundPrice(supplierRate * grams);
  }

  return 0;
}

/** Gold-rate customers: true when a daily/sticky gold rate can price this row. */
function hasDailyGold(record: DatabaseRowType): boolean {
  return usesGold() && getRatesForDate(record.dateOfLive || '').goldRate > 0;
}

export function calcProfitNative(record: DatabaseRowType): number {
  if (isUnitMode()) {
    const costAED = calcItemCostAED(record);
    const curr = getEffectiveCurrency(record);
    const snap = getRatesForDate(record.dateOfLive || '');
    const nativeCost = curr === 'PHP' ? costAED * snap.phpRate : curr === 'USD' ? costAED / getUsdToAed() : costAED;
    return roundPrice(calcItemPrice(record) - nativeCost);
  }

  const category = (record.category || '').toLowerCase();
  const isSilver = getSilverRate(category, record) !== null;
  const isPerPcType = category.includes('per pc') || category.includes('screw type') || category.includes('diamond');
  const grams = n(record.grams);

  if (!isSilver && !isPerPcType && grams > 0) {
    if (n(record.goldRate) === 0 && n(record.supplierRate) === 0 && !hasDailyGold(record)) return 0;
  }

  const costAED = calcItemCostAED(record);
  const curr = getEffectiveCurrency(record);
  const snap = getRatesForDate(record.dateOfLive || '');

  let nativeCost: number;
  if (curr === 'PHP') nativeCost = costAED * snap.phpRate;
  else if (curr === 'USD') nativeCost = costAED / getUsdToAed();
  else nativeCost = costAED;

  const nativeSales = calcItemPrice(record);
  
  const finalProfit = nativeSales - nativeCost;
  return roundPrice(finalProfit);
}

export function calcProfitAED(record: DatabaseRowType): number {
  if (isUnitMode()) {
    const ccFee = record.modeOfPayment === 'Credit Card' ? roundPrice(calcItemPriceAED(record) * getCcSurchargeRate()) : 0;
    return roundPrice(calcItemPriceAED(record) - calcItemCostAED(record) - ccFee);
  }

  const category = (record.category || '').toLowerCase();
  const grams = n(record.grams);
  const isSilver = getSilverRate(category, record) !== null;
  const isPerPcType = category.includes('per pc') || category.includes('screw type') || category.includes('diamond');

  if (!isSilver && !isPerPcType && grams > 0) {
    if (n(record.goldRate) === 0 && n(record.supplierRate) === 0 && !hasDailyGold(record)) return 0;
  }

  const ccFeeDeduction = record.modeOfPayment === 'Credit Card' ? roundPrice(calcItemPriceAED(record) * getCcSurchargeRate()) : 0;
  const finalProfit = calcItemPriceAED(record) - calcItemCostAED(record) - ccFeeDeduction;
  return roundPrice(finalProfit);
}

export function calcProfit(record: DatabaseRowType): number {
  return calcProfitAED(record);
}

export function calcShippingFee(record: DatabaseRowType): number {
  const mos = (record.modeOfSale || '').toLowerCase().trim();
  if (mos === 'in-store' || mos === 'walk-in' || mos === 'walk in') return 0;
  if (isFreeSf(record)) return 0;

  // Promo SF: custom amount (convert PHP to AED if needed)
  const promoSf = getPromoSf(record);
  if (promoSf) {
    if (promoSf.currency === 'PHP') {
      const snap = getRatesForDate(record.dateOfLive || '');
      return Math.round(promoSf.amount / snap.phpRate);
    }
    if (promoSf.currency === 'USD') {
      return Math.round(promoSf.amount * getUsdToAed());
    }
    return promoSf.amount;
  }
  if (record.modeOfPayment === 'Pick Up Shop') return 0;
  if (record.modeOfPayment === 'Meet Up') return getShippingFeeMeetUp();

  const loc = normCurrency(record.locationOfMiner);
  const mop = (record.modeOfPayment || '').toLowerCase();
  const region = (record.regions || '').toLowerCase();

  // International can be picked in Location, Region or Mode of Payment — any of
  // them means the international fee (before, only Location counted, so Region
  // "International" fell through to the "Other regions" default).
  const regionU = normCurrency(record.regions);
  const mopU = normCurrency(record.modeOfPayment);
  if (
    loc === 'INTERNATIONAL' || loc === 'PINAS' ||
    regionU === 'INTERNATIONAL' || regionU === 'PINAS' ||
    mopU === 'INTERNATIONAL'
  ) return getShippingFeeInternational();

  // Rates come from the per-customer pricing config (Settings → Pricing →
  // Shipping fees), so zones can be changed without a code release.
  const deliveryRegion = mop.includes('(') ? mop : region;
  if (loc === 'LOCAL' || mop.includes('cod') || mop.includes('bank transfer aed')) {
    return getShippingFeeForRegion(deliveryRegion || region);
  }
  return 0;
}

export function calcCCFee(record: DatabaseRowType): number {
  if (record.modeOfPayment !== 'Credit Card') return 0;
  return roundPrice(calcItemPriceAED(record) * getCcSurchargeRate());
}

export function resolveDownpaymentCurrencyAED(dpRaw: number, record: DatabaseRowType): number {
  if (dpRaw <= 0) return 0;
  const snap = getRatesForDate(record.dateOfLive || '');
  const dpCurr = getPaymentCurrency(record);
  if (dpCurr === 'PHP') return dpRaw / snap.phpRate;
  if (dpCurr === 'USD') return dpRaw * getUsdToAed();
  // Payment method says AED (e.g. Credit Card), but if the item is PHP-denominated
  // (e.g. a Pinas/Philippines customer), the admin would have entered the PHP amount.
  // Fall back to the item's effective currency to avoid wrongly converting PHP as AED.
  const itemCurr = getEffectiveCurrency(record);
  if (itemCurr === 'PHP') return dpRaw / snap.phpRate;
  if (itemCurr === 'USD') return dpRaw * getUsdToAed();
  return dpRaw;
}

/** Parse downpayment value — handles both plain numbers and CHARGE:CURR:AMT:DESC format */
function parseDpValue(dp?: string): { amount: number; currency?: string } {
  const v = String(dp ?? '').trim();
  if (!v || v === 'acknowledged') return { amount: 0 };
  const upper = v.toUpperCase();
  if (upper.startsWith('CHARGE:')) {
    const parts = v.split(':');
    return { amount: parseFloat(parts[2] || '0') || 0, currency: (parts[1] || '').toUpperCase() };
  }
  return { amount: parseFloat(v) || 0 };
}

export function calcTotalPaid(record: DatabaseRowType): number {
  const dp = parseDpValue(record.downpayment);
  // If the CHARGE: format includes explicit currency, use it directly for conversion
  let dpAED: number;
  if (dp.currency) {
    const snap = getRatesForDate(record.dateOfLive || '');
    if (dp.currency === 'PHP') dpAED = dp.amount / snap.phpRate;
    else if (dp.currency === 'USD') dpAED = dp.amount * getUsdToAed();
    else dpAED = dp.amount;
  } else {
    dpAED = resolveDownpaymentCurrencyAED(dp.amount, record);
  }
  // Include layaway installments + amountReceived
  const layawayRaw = n(record.la1MonthPayment) + n(record.la2MonthPayment) + n(record.la3MonthPayment) + n(record.la4MonthPayment);
  const otherRaw = layawayRaw + n(record.amountReceived);
  const manuallyPaid = dpAED + toAED(otherRaw, record);

  return manuallyPaid;
}

export function calcRemainingBalance(record: DatabaseRowType): number {
  const itemPriceAED = calcItemPriceAED(record);
  const shippingFee = calcShippingFee(record);
  const ccFee = calcCCFee(record);
  // Use billing modifiers parser for structured charges/discounts
  const mods = parseBillingModifiers(record.additionalCharges);
  const snap = getRatesForDate(record.dateOfLive || '');
  const netCharge = Math.round(getTotalChargesAED(mods, snap.phpRate) - getTotalDiscountsAED(mods, snap.phpRate));
  const totalPaid = calcTotalPaid(record);
  return roundPrice((itemPriceAED + shippingFee + ccFee + netCharge) - totalPaid);
}

export function calcRemainingBalanceAED(record: DatabaseRowType): number {
  return calcRemainingBalance(record);
}

export function calcDueDate(dateOfLive?: string): Date | null {
  const d = parseDateRobust(dateOfLive);
  if (!d) return null;
  // Set to end-of-day (23:59:59) on the upload date, then add 24h.
  // This guarantees a full 24-hour window regardless of what time the item was uploaded.
  const due = new Date(d);
  due.setHours(23, 59, 59, 999);
  due.setTime(due.getTime() + 24 * 60 * 60 * 1000);
  return due;
}

export function isOverdue(record: DatabaseRowType): boolean {
  if (record.status !== 'Pending' && record.status !== 'Waiting for Details' && record.status !== 'Waiting for Downpayment') return false;
  const due = calcDueDate(record.dateOfLive);
  if (!due) return false;
  // C4 FIX: Use UAE time (UTC+4) for the date boundary check
  const nowUAE = new Date(Date.now() + getTimezoneOffsetMs()); // customer's timezone (Settings → Business)
  return nowUAE.getTime() > due.getTime();
}

export function calcItemPricePHP(record: DatabaseRowType): number {
  const clientRate = n(record.clientRate);
  if (clientRate === 0) return 0;

  const currency = String(record.currency || 'AED').toUpperCase();
  const snap = getRatesForDate(record.dateOfLive || '');

  if (currency === 'PHP') return clientRate;

  const aedRate = resolveBaseRateAED(record);
  return aedRate * snap.phpRate;
}
// ── Customer-level balance (matches the invoice) ─────────────────────────────
// The invoice charges shipping ONCE per customer and the card surcharge on the
// card items' total; per-item balances charged shipping on every item. Totals
// and "cleared" checks must use these group functions so Accounts, Bossing and
// the invoice all agree.

/** One item's extra charges minus discounts (Additional Charges), AED. */
export function netChargeAED(r: DatabaseRowType): number {
  const mods = parseBillingModifiers(r.additionalCharges);
  const snap = getRatesForDate(r.dateOfLive || '');
  return getTotalChargesAED(mods, snap.phpRate) - getTotalDiscountsAED(mods, snap.phpRate);
}

/** Shipping for ONE customer's items, charged once: a promo SF wins, any free SF means none. */
export function groupShippingFee(records: DatabaseRowType[]): number {
  return shippingGroups(records).reduce((total, rows) => {
    const from = shippingFeeRow(rows);
    return total + (from ? calcShippingFee(from) : 0);
  }, 0);
}

/** Actual dispatch days close a shipment; purchases after it start a new one.
 * Never use the live date as a pretend dispatch date for old records. */
export function shippingGroups(records: DatabaseRowType[], perShipment = getPricing().shippingPerShipment, timezoneOffsetMs = getTimezoneOffsetMs()): DatabaseRowType[][] {
  if (!perShipment) return records.length ? [records] : [];
  const day = (value?: string) => {
    const date = parseDateRobust(value);
    if (!date) return '';
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value || '')) {
      return new Date(date.getTime() + timezoneOffsetMs).toISOString().slice(0, 10);
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const shippedDay = (r: DatabaseRowType) => day(r.dispatchDate) || day(r.deliveredDate);
  const shipments = new Map<string, { day: string; at: number }>();
  const keyFor = (r: DatabaseRowType) => r.shipmentId || shippedDay(r);
  for (const row of records) {
    const date = shippedDay(row);
    if (!date) continue;
    const key = keyFor(row);
    const at = parseDateRobust(row.dispatchDate || row.deliveredDate)?.getTime() || 0;
    const saved = shipments.get(key);
    if (!saved || at < saved.at) shipments.set(key, { day: date, at });
  }
  const ordered = [...shipments].sort((a, b) => a[1].at - b[1].at);
  const groups = new Map<string, DatabaseRowType[]>();
  for (const row of records) {
    const purchase = day(row.dateOfLive);
    // A newly created purchase after today's dispatch starts another shipment.
    // Historical imports retain their original live day rather than import time.
    const created = String(row.auditTrail || '').split('\n').find(line => /\|\s*Created\s*$/.test(line));
    const createdAt = created ? parseDateRobust(created.split(' | ')[0])?.getTime() : undefined;
    const createdDay = created ? day(created.split(' | ')[0]) : '';
    const waitingShipment = purchase ? ordered.find(([, shipment]) =>
      shipment.day > purchase || (shipment.day === purchase &&
        (createdDay !== purchase || !createdAt || createdAt <= shipment.at)))?.[0] : undefined;
    const key = shippedDay(row) ? keyFor(row) : waitingShipment || 'open';
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Reuse the waiting order's shipment when Dispatch marks its items one at a time. */
export function shipmentIdentityFor(row: DatabaseRowType, all: DatabaseRowType[], now: string): string {
  const customer = all.filter(r => customerKey(r) === customerKey(row));
  const group = shippingGroups(customer).find(rows => rows.some(r => r.id === row.id)) || [];
  const sent = group.find(r => r.dispatchDate || r.deliveredDate);
  if (sent?.shipmentId) return sent.shipmentId;
  if (sent) {
    // Match the legacy day key used by shippingGroups (business timezone).
    const value = sent.dispatchDate || sent.deliveredDate;
    const date = parseDateRobust(value);
    if (date) {
      if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value || '')) return new Date(date.getTime() + getTimezoneOffsetMs()).toISOString().slice(0, 10);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
  }
  return `shipment:${now}`;
}

/** The row a customer's shipping fee is worked out from (the promo one, else the first); null when free. */
export function shippingFeeRow(records: DatabaseRowType[]): DatabaseRowType | null {
  if (!records.length) return null;
  const promo = records.find(r => isPromoSf(r));
  const anyFree = !promo && records.some(r => isFreeSf(r));
  return anyFree ? null : promo || records[0];
}

/** Balance owed for ONE customer's items, computed the way the invoice does. */
export function calcGroupBalance(records: DatabaseRowType[]): number {
  if (!records.length) return 0;
  const itemsTotal = records.reduce((s, r) => s + calcItemPriceAED(r), 0);
  const ccItems = records.filter(r => r.modeOfPayment === 'Credit Card').reduce((s, r) => s + calcItemPriceAED(r), 0);
  const shipping = groupShippingFee(records);
  const cc = roundPrice(ccItems * getCcSurchargeRate());
  const charges = roundPrice(records.reduce((s, r) => s + netChargeAED(r), 0));
  const paid = records.reduce((s, r) => s + calcTotalPaid(r), 0);
  return roundPrice(itemsTotal + shipping + cc + charges - paid);
}

/**
 * One customer's invoices, oldest first, as a running account: shipping is
 * charged once (on the first invoice, like calcGroupBalance) and an earlier
 * invoice's store credit is used up by the next ones. Each entry's `balance`
 * is what is still owed on that invoice after earlier credit.
 */
export function calcInvoiceLedger(invoices: DatabaseRowType[][]): { balance: number }[] {
  const out: { balance: number }[] = [];
  let soFar: DatabaseRowType[] = [];
  let before = 0;
  for (const recs of invoices) {
    soFar = soFar.concat(recs);
    const after = calcGroupBalance(soFar);
    const own = after - before;
    // Earlier credit can bring this invoice down to paid, never below.
    out.push({ balance: before < 0 && own > 0 ? Math.max(0, own + before) : own });
    before = after;
  }
  return out;
}

export function customerKey(r: DatabaseRowType): string {
  return String(r.customerId || r.minerName || '').trim().toUpperCase().replace(/\s+/g, ' ') || `#${r.id}`;
}

/** Group records by customer. */
export function groupByCustomer(records: DatabaseRowType[]): Map<string, DatabaseRowType[]> {
  const m = new Map<string, DatabaseRowType[]>();
  for (const r of records) {
    const k = customerKey(r);
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  return m;
}

/** Total still owed across many customers (each customer counted like its invoice). */
export function sumOutstanding(records: DatabaseRowType[]): number {
  let total = 0;
  for (const g of groupByCustomer(records).values()) total += Math.max(0, calcGroupBalance(g));
  return total;
}
