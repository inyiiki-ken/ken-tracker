import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes safely (later classes override earlier conflicting ones). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "MMM DD, YYYY" formatting used everywhere in the UI per the build spec
 * ("Format all dates strictly as short dates... Strip out any raw ISO
 * timestamp strings"). */
export function formatShortDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

export function formatAED(amount: number): string {
  return `AED ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
