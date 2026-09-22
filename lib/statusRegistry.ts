"use client";

/**
 * DATA-DRIVEN STATUS LIST.
 *
 * The status dropdowns must reflect the statuses a customer ACTUALLY uses, not a
 * hardcoded subset. So the effective list is built from three sources, deduped:
 *   1. The tenant's configured statusOptions (App Settings), if the developer set any.
 *   2. Every distinct status found in the customer's own data (auto-discovered on load).
 *   3. A comprehensive default base list (covers the common lifecycle).
 * The record's current status is always included so a row never loses its value.
 *
 * This means AR's statuses (Reseller, Given to Courier X, Picked Up, Waiting for
 * Details, etc.) show up automatically because they exist in AR's sheet — the
 * developer never has to type them in.
 */

import { getAppConfig } from "@/lib/appConfig";
import type { DatabaseRowType } from "@/types";

/** Comprehensive default lifecycle, in a sensible order. */
export const DEFAULT_STATUSES: string[] = [
  "Pending",
  "Waiting for Details",
  "Waiting for Downpayment",
  "Paid/DP but Item Hold",
  "Payment for Verification",
  "Pending for Tabby",
  "Pending for Tamara",
  "For Pullout",
  "Dispatched",
  "Picked Up",
  "Given to Shop",
  "Delivered",
  "Reseller",
  "Returned Item",
  "Walk-in",
  "In-Store",
  "Cancelled",
];

/** Which dropdown is asking — each team gets its own relevant statuses. */
export type StatusContext = "admin" | "dispatch" | "accounts" | "all";

/** Admin / intake team: order-taking + payment phase (NOT courier/delivery). */
export const DEFAULT_ADMIN_STATUSES: string[] = [
  "Pending",
  "Waiting for Details",
  "Waiting for Downpayment",
  "Paid/DP but Item Hold",
  "Payment for Verification",
  "Pending for Tabby",
  "Pending for Tamara",
  "For Pullout",
  "Reseller",
  "Cancelled",
];

/** Accounts team: payment verification + holds, plus a few fulfillment states. */
export const DEFAULT_ACCOUNTS_STATUSES: string[] = [
  "Payment for Verification",
  "Paid/DP but Item Hold",
  "Waiting for Downpayment",
  "Pending for Tabby",
  "Pending for Tamara",
  "Dispatched",
  "Delivered",
  "Given to Shop",
  "Cancelled",
];

/** Dispatch team: fulfillment phase — couriers (from data) are added on top. */
export const DEFAULT_DISPATCH_STATUSES: string[] = [
  "For Pullout",
  "Dispatched",
  "Picked Up",
  "Given to Shop",
  "Delivered",
  "Returned Item",
  "Paid/DP but Item Hold",
  "Payment for Verification",
  "Cancelled",
];

// Statuses discovered from the loaded data, in first-seen order.
let _known: string[] = [];

/** Record the distinct statuses present in the customer's data (called on load). */
export function setKnownStatuses(records: Array<Pick<DatabaseRowType, "status">>): void {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of records) {
    const s = String(r?.status ?? "").trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  _known = out;
}

export function getKnownStatuses(): string[] {
  return _known;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw ?? "").trim();
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

/**
 * The status options to offer in a dropdown, scoped to the team asking:
 *   - "admin"    → intake/payment statuses only (no courier/delivery clutter)
 *   - "dispatch" → the full set incl. every "Given to Courier …" from the data
 *   - "accounts" → payment-focused statuses
 *   - "all"      → everything (used by generic pickers)
 * A developer can override any tab's list in Settings (statusOptionsByTab);
 * otherwise the built-in default for that tab is used. `current` is always
 * included so a row never loses its own value.
 */
export function getEffectiveStatuses(context: StatusContext = "all", current?: string): string[] {
  const cfg = getAppConfig();
  const override = cfg.statusOptionsByTab?.[context];

  let base: string[];
  if (override && override.length > 0) {
    base = override;
  } else {
    switch (context) {
      case "admin":
        base = DEFAULT_ADMIN_STATUSES;
        break;
      case "accounts":
        base = DEFAULT_ACCOUNTS_STATUSES;
        break;
      case "dispatch":
        // Dispatch sees everything, including couriers discovered in the data.
        base = [...DEFAULT_DISPATCH_STATUSES, ...DEFAULT_STATUSES, ..._known];
        break;
      default:
        base = [...cfg.statusOptions, ...DEFAULT_STATUSES, ..._known];
    }
  }

  const list = dedupe(base);
  if (current) {
    const has = list.some((s) => s.toLowerCase() === current.toLowerCase());
    if (!has) return [current, ...list];
  }
  return list;
}
