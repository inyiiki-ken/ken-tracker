import { DatabaseRowType } from '@/types';
import { parseISO, isValid, parse } from 'date-fns';
import { getRatesForDate, RateSnapshot, usesGold } from '@/lib/ratesStore';
import { parseBillingModifiers, getTotalChargesAED, getTotalDiscountsAED } from '@/lib/billingModifiers';
import { getTimezoneOffsetMs } from '@/lib/businessConfig';
import { getUsdToAed, getPerPcFallback, getB1t1Multiplier, getCcSurchargeRate, getShippingFeeForRegion, getShippingFeeInternational, getShippingFeeMeetUp } from '@/lib/pricingConfig';
import { isUnitMode } from '@/lib/businessConfig';

export function parseNum(x: unknown): number {
  const cleaned = String(x ?? '').replace(/,/g, '');
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : 0;
}
const n = parseNum;
export function roundPrice(v: number): number { return Math.round(v); }

export function parseDateRobust(dateStr?: string): Date | null {
  if (!dateStr) return null;
  let safeDateStr = dateStr;
  if (!dateStr.includes('T') && !dateStr.includes('+') && !dateStr.includes('Z')) {
    safeDateStr = `${dateStr} 12:00:00 +0400`;
  }
  const iso = parseISO(safeDateStr);
  if (isValid(iso)) return iso;
  const native = new Date(safeDateStr);
  if (!isNaN(native.getTime())) return native;
  const formats = ['MMMM dd,yyyy', 'MMMM d,yyyy', 'MM/dd/yyyy', 'M/d/yyyy', 'dd/MM/yyyy'];
  for (const fmt of formats) {
    try {
      const d = parse(safeDateStr, fmt, new Date());
      if (isValid(d)) return d;
    } catch { /* continue */ }
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
  // Unit mode: unit price (converted to AED) × qty.
  if (isUnitMode()) return roundPrice(clientRateAED(record) * getQty(record));

  const rateAED = clientRateAED(record);
  const category = (record.category || '').toLowerCase();
  const silverRate = getSilverRate(category, record);

  if (silverRate !== null) {
    if (n(record.clientRate) > 0) return roundPrice(n(record.grams) * rateAED);
    return roundPrice(n(record.grams) * silverRate);
  }

  if (category.includes('per pc') || category.includes('screw type') || category.includes('diamond')) {
    return roundPrice(rateAED * getQty(record));
  }

  if (isPcItem(record)) return roundPrice(rateAED);
  const price = roundPrice(n(record.grams) * rateAED);
  return price > 0 ? price : (rateAED > 0 ? roundPrice(rateAED) : 0);
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
  const goldRate = rowGoldRate > 0 ? rowGoldRate
    : (usesGold() && snap.goldRate > 0 && !category.includes('silver') ? snap.goldRate : 0);

  if (goldRate > 0) {
    // FORCE MC TO 16/21/25 IF EMPTY OR ZERO
    const parsedMc = n(record.mc);
    const effectiveMc = parsedMc > 0 ? parsedMc : (category.includes('special price ef') ? 25 : category.includes('special price') ? 21 : 16);
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

  if (loc === 'INTERNATIONAL' || loc === 'PINAS') return getShippingFeeInternational();

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