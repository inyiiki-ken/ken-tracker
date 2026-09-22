/**
 * Billing Modifiers — Parse & encode charges + discounts from the `additionalCharges` field.
 *
 * Encoding format (backwards-compatible):
 *   Plain number          → legacy charge in AED (e.g. "50")
 *   ADDCHARGE:CURR:AMT    → charge without description
 *   CHARGE:CURR:AMT:DESC  → charge with description
 *   DISCOUNT:CURR:AMT:DESC → discount with description
 *   SHIPFEE:CURR:AMT      → shipping fee override
 *   Multiple entries separated by "||"
 */

import { getRatesForDate } from '@/lib/ratesStore';

export interface BillingCharge {
  amount: number;
  currency: string;
  description: string;
}

export interface BillingDiscount {
  amount: number;
  currency: string;
  description: string;
}

export interface BillingModifiers {
  charges: BillingCharge[];
  discounts: BillingDiscount[];
  shipFeeOverride: { currency: string; amount: number } | null;
}

const USD_AED = 3.67;

function toAEDVal(amount: number, currency: string, phpRate: number): number {
  if (currency === 'PHP') return amount / phpRate;
  if (currency === 'USD') return amount * USD_AED;
  return amount;
}

export function parseBillingModifiers(additionalCharges?: string): BillingModifiers {
  const result: BillingModifiers = { charges: [], discounts: [], shipFeeOverride: null };
  if (!additionalCharges) return result;

  const entries = additionalCharges.split('||').map(s => s.trim()).filter(Boolean);

  for (const entry of entries) {
    const upper = entry.toUpperCase();

    if (upper.startsWith('CHARGE:')) {
      const parts = entry.split(':');
      result.charges.push({
        currency: (parts[1] || 'AED').toUpperCase(),
        amount: parseFloat(parts[2] || '0') || 0,
        description: parts.slice(3).join(':').trim(),
      });
    } else if (upper.startsWith('DISCOUNT:')) {
      const parts = entry.split(':');
      result.discounts.push({
        currency: (parts[1] || 'AED').toUpperCase(),
        amount: parseFloat(parts[2] || '0') || 0,
        description: parts.slice(3).join(':').trim(),
      });
    } else if (upper.startsWith('SHIPFEE:')) {
      const parts = entry.split(':');
      result.shipFeeOverride = {
        currency: (parts[1] || 'AED').toUpperCase(),
        amount: parseFloat(parts[2] || '0') || 0,
      };
    } else if (upper.startsWith('ADDCHARGE:')) {
      const parts = entry.split(':');
      result.charges.push({
        currency: (parts[1] || 'AED').toUpperCase(),
        amount: parseFloat(parts[2] || '0') || 0,
        description: parts.length > 3 ? parts.slice(3).join(':').trim() : '',
      });
    } else {
      const num = parseFloat(entry);
      if (num && !isNaN(num)) {
        result.charges.push({ amount: num, currency: 'AED', description: '' });
      }
    }
  }

  return result;
}

export function encodeBillingModifiers(modifiers: BillingModifiers): string {
  const parts: string[] = [];

  if (modifiers.shipFeeOverride && modifiers.shipFeeOverride.amount > 0) {
    parts.push(`SHIPFEE:${modifiers.shipFeeOverride.currency}:${modifiers.shipFeeOverride.amount}`);
  }

  for (const c of modifiers.charges) {
    if (c.amount <= 0) continue;
    if (c.description) {
      parts.push(`CHARGE:${c.currency}:${c.amount}:${c.description}`);
    } else {
      // Use legacy format when no description to keep backwards compatibility
      if (c.currency === 'AED' && parts.length === 0) {
        parts.push(String(c.amount));
      } else {
        parts.push(`ADDCHARGE:${c.currency}:${c.amount}`);
      }
    }
  }

  for (const d of modifiers.discounts) {
    if (d.amount <= 0) continue;
    parts.push(`DISCOUNT:${d.currency}:${d.amount}:${d.description || 'Discount'}`);
  }

  return parts.join('||');
}

/** Total charges converted to AED */
export function getTotalChargesAED(modifiers: BillingModifiers, phpRate: number): number {
  return modifiers.charges.reduce((s, c) => s + toAEDVal(c.amount, c.currency, phpRate), 0);
}

/** Total discounts converted to AED */
export function getTotalDiscountsAED(modifiers: BillingModifiers, phpRate: number): number {
  return modifiers.discounts.reduce((s, d) => s + toAEDVal(d.amount, d.currency, phpRate), 0);
}

/** Net additional charge AED (charges minus discounts) for a single record */
export function getNetChargeAED(additionalCharges?: string, dateOfLive?: string): number {
  const mods = parseBillingModifiers(additionalCharges);
  const snap = getRatesForDate(dateOfLive || '');
  return Math.round(getTotalChargesAED(mods, snap.phpRate) - getTotalDiscountsAED(mods, snap.phpRate));
}

/** Get structured charge/discount for display */
export function getChargeDescriptions(records: { additionalCharges?: string; dateOfLive?: string }[]): {
  charges: { label: string; amountAED: number }[];
  discounts: { label: string; amountAED: number }[];
} {
  const charges: { label: string; amountAED: number }[] = [];
  const discounts: { label: string; amountAED: number }[] = [];

  for (const r of records) {
    const mods = parseBillingModifiers(r.additionalCharges);
    const snap = getRatesForDate(r.dateOfLive || '');

    // Skip SHIPFEE entries (handled separately)
    for (const c of mods.charges) {
      charges.push({
        label: c.description || 'Additional Charge',
        amountAED: Math.round(toAEDVal(c.amount, c.currency, snap.phpRate)),
      });
    }
    for (const d of mods.discounts) {
      discounts.push({
        label: d.description || 'Discount',
        amountAED: Math.round(toAEDVal(d.amount, d.currency, snap.phpRate)),
      });
    }
  }

  return { charges, discounts };
}
