import type { DatabaseRowType } from "@/types";
import type { FulfilmentStage } from "@/lib/fulfilment";
import { calcTotalPaid, calcItemPrice, calcItemPriceAED, calcCCFee, getEffectiveCurrency } from "@/lib/calculations";
import { getRatesForDate } from "@/lib/ratesStore";
import { getUsdToAed } from "@/lib/pricingConfig";

export type MoneyKey = "downpayment" | "la1MonthPayment" | "la2MonthPayment" | "la3MonthPayment" | "la4MonthPayment" | "amountReceived";
export const MONEY_KEYS: MoneyKey[] = ["downpayment", "la1MonthPayment", "la2MonthPayment", "la3MonthPayment", "la4MonthPayment", "amountReceived"];

/**
 * How a split moves the payment fields. `parent`: fields to write back to the
 * original row. `child`: the new row's value for every payment field (null =
 * leave it empty).
 */
export type SplitPayments = { parent: Partial<Record<MoneyKey, string>>; child: Record<MoneyKey, string | null> };

const PLAIN = /^\d+(\.\d+)?$/;

/**
 * Everything stays on the original row. The new row only gets the
 * downpayment marker ("acknowledged" when the original has one, so it isn't
 * locked as unpaid; EID as it is).
 */
export function keepPaymentsOnOriginal(rec: Partial<Record<keyof DatabaseRowType, unknown>>, markers = true): SplitPayments {
  const dp = String(rec.downpayment ?? "").trim();
  const amount = dp.toUpperCase().startsWith("CHARGE:") ? dp.split(":")[2] ?? "" : dp;
  const marker = dp === "acknowledged" || dp.toUpperCase() === "EID" ? dp : parseFloat(amount) > 0 ? "acknowledged" : null;
  return {
    parent: {},
    child: { downpayment: markers ? marker : null, la1MonthPayment: null, la2MonthPayment: null, la3MonthPayment: null, la4MonthPayment: null, amountReceived: null },
  };
}

/**
 * Shares an item's payments between the two rows of a split, so each row
 * pays for itself and separate invoices balance. Worked out on the screen,
 * where the customer's rates are loaded.
 *
 * - Fully paid: the new row gets exactly its own price (plus card fee); the
 *   rest, e.g. money that also paid shipping or extra charges, stays on the
 *   original, where those are charged.
 * - Partly paid: shared in proportion to each row's price.
 * - Split off as Cancelled / Returned: nothing moves; the money stays on the
 *   original (as credit if it was paid).
 * - Anything the totals can't read back exactly (unusual amounts, silver
 *   paid in PHP/USD): nothing moves, so no money is ever lost or invented.
 */
export function planSplitPayments(record: DatabaseRowType, splitGrams: number, newStage: FulfilmentStage): SplitPayments {
  const origGrams = Number(record.grams) || 0;
  const keep = keepPaymentsOnOriginal(record, newStage !== "excluded");
  const paid = calcTotalPaid(record);
  if (newStage === "excluded" || !(paid > 0) || !(splitGrams > 0) || splitGrams >= origGrams) return keep;

  const child = { ...record, grams: splitGrams };
  const parent = { ...record, grams: Math.round((origGrams - splitGrams) * 10000) / 10000 };
  // Each row's own price in AED. A PHP / USD item is billed in its own
  // currency, so its price is taken from there at the plain rate (the invoice
  // converts paid money the same way), not from the rounded AED price.
  const currency = getEffectiveCurrency(record);
  const phpRate = getRatesForDate(record.dateOfLive || "").phpRate;
  const own = (r: DatabaseRowType) => {
    if (currency === "PHP" && phpRate > 0) return calcItemPrice(r) / phpRate + calcCCFee(r);
    if (currency === "USD") return calcItemPrice(r) * getUsdToAed() + calcCCFee(r);
    return calcItemPriceAED(r) + calcCCFee(r);
  };
  const ownChild = own(child);
  const ownParent = own(parent);
  const total = ownChild + ownParent;
  if (!(total > 0)) return keep;
  const target = paid >= total ? ownChild : (paid * ownChild) / total;
  const ratio = target / paid;

  const cents = (v: number) => Math.round(v * 100) / 100;
  const out: SplitPayments = { parent: {}, child: { ...keep.child } };
  const dp = String(record.downpayment ?? "").trim();
  const parts = dp.split(":");
  const isCharge = dp.toUpperCase().startsWith("CHARGE:");
  const dpAmount = isCharge ? parts[2] ?? "" : dp;
  if (PLAIN.test(dpAmount) && Number(dpAmount) > 0) {
    const part = cents(Number(dpAmount) * ratio);
    const rest = cents(Number(dpAmount) - part);
    if (part > 0) {
      out.parent.downpayment = isCharge ? [parts[0], parts[1], rest, ...parts.slice(3)].join(":") : String(rest);
      out.child.downpayment = isCharge ? [parts[0], parts[1], part, ...parts.slice(3)].join(":") : String(part);
    }
  }
  for (const key of MONEY_KEYS) {
    if (key === "downpayment") continue;
    const raw = String(record[key] ?? "").trim();
    if (!/^-?[\d,]+(\.\d+)?$/.test(raw)) continue;
    const amt = Number(raw.replace(/,/g, ""));
    const part = cents(amt * ratio);
    if (part === 0) continue;
    out.parent[key] = String(cents(amt - part));
    out.child[key] = String(part);
  }

  // Read both rows back the way every balance does. If the shares don't add
  // up to what was paid, or the new row doesn't get its share, move nothing.
  const after = (base: DatabaseRowType, fields: Partial<Record<MoneyKey, string | null>>) => {
    const r: DatabaseRowType = { ...base };
    for (const k of MONEY_KEYS) if (k in fields) (r as any)[k] = fields[k] ?? "";
    return calcTotalPaid(r);
  };
  const childPaid = after(child, out.child);
  const parentPaid = after(parent, out.parent);
  if (Math.abs(childPaid + parentPaid - paid) > 0.02 || Math.abs(childPaid - target) > 0.05) return keep;
  return out;
}

/** The new row's share of the payments in AED (0 when nothing moves). */
export function childPaidAED(record: DatabaseRowType, splitGrams: number, plan: SplitPayments): number {
  const r: DatabaseRowType = { ...record, grams: splitGrams };
  for (const k of MONEY_KEYS) (r as any)[k] = plan.child[k] ?? "";
  return calcTotalPaid(r);
}
