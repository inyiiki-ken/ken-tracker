import type { DatabaseRowType } from "@/types";

type MoneyKey = "downpayment" | "la1MonthPayment" | "la2MonthPayment" | "la3MonthPayment" | "la4MonthPayment" | "amountReceived";
const PAID_FIELDS: MoneyKey[] = ["la1MonthPayment", "la2MonthPayment", "la3MonthPayment", "la4MonthPayment", "amountReceived"];

/**
 * Shares an item's payments by weight when it is split, so each row pays for
 * its own grams. `ratio` is the split-off grams over the original grams.
 * `parent` holds the fields to write back to the original row; `child` the
 * new row's value for every payment field (undefined = leave it empty).
 * Only plain amounts are shared. "acknowledged" and EID are copied as they
 * are; an amount the totals can't read stays whole on the original and the
 * new row is "acknowledged" (covered there), so it isn't locked as unpaid.
 */
export function splitPayments(
  rec: Partial<Record<keyof DatabaseRowType, unknown>>,
  ratio: number
): { parent: Partial<Record<MoneyKey, string>>; child: Partial<Record<MoneyKey, string | undefined>> } {
  const cents = (v: number) => Math.round(v * 100) / 100;
  const share = (amt: number) => { const part = cents(amt * ratio); return [cents(amt - part), part] as const; };
  const parent: Partial<Record<MoneyKey, string>> = {};
  const child: Partial<Record<MoneyKey, string | undefined>> = {};

  const dp = String(rec.downpayment ?? "").trim();
  const isCharge = dp.toUpperCase().startsWith("CHARGE:");
  const parts = dp.split(":");
  const amount = isCharge ? parts[2] ?? "" : dp;
  const [keep, part] = /^\d+(\.\d+)?$/.test(amount) ? share(Number(amount)) : [0, 0];
  if (dp === "acknowledged" || dp.toUpperCase() === "EID") {
    child.downpayment = dp;
  } else if (part > 0) {
    parent.downpayment = isCharge ? [parts[0], parts[1], keep, ...parts.slice(3)].join(":") : String(keep);
    child.downpayment = isCharge ? [parts[0], parts[1], part, ...parts.slice(3)].join(":") : String(part);
  } else {
    // "0", "-" or other junk isn't a downpayment and unlocks nothing.
    child.downpayment = parseFloat(amount) > 0 ? "acknowledged" : undefined;
  }

  for (const key of PAID_FIELDS) {
    const raw = String(rec[key] ?? "").trim();
    const amt = /^-?[\d,]+(\.\d+)?$/.test(raw) ? Number(raw.replace(/,/g, "")) : NaN;
    const [k, p] = Number.isFinite(amt) ? share(amt) : [0, 0];
    if (p !== 0) {
      parent[key] = String(k);
      child[key] = String(p);
    } else {
      child[key] = undefined;
    }
  }
  return { parent, child };
}
