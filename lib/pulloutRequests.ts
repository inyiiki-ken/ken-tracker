/**
 * Pullout requests — a liver tells Dispatch which "For Pullout" items they will
 * pull out, on which day, and whether they go For COD or For Pick Up, so the
 * items are prepared before the liver comes to the office.
 *
 *   Requested → Dispatch prepares → Ready → liver comes, Dispatch sets the
 *   items to For COD / For Pick Up → Done.
 *
 * The liver may change or cancel the request until Dispatch marks it Ready.
 * Shared types and pure helpers (client + server).
 */

import type { DatabaseRowType } from "@/types";
import { parseDateRobust } from "@/lib/calculations";

export type PulloutRequestStatus = "Requested" | "Ready" | "Done" | "Cancelled";
export type PulloutMethod = "COD" | "Pick Up";

export const PULLOUT_METHODS: { key: PulloutMethod; label: string; status: string }[] = [
  { key: "COD", label: "COD", status: "For COD" },
  { key: "Pick Up", label: "Pick Up", status: "For Pick Up" },
];

/** The status Dispatch sets on the items when the liver has come. */
export function methodStatus(m: PulloutMethod): string {
  return PULLOUT_METHODS.find((x) => x.key === m)?.status ?? "For Pick Up";
}

export interface PulloutRequest {
  id: string;
  liver: string;
  /** yyyy-mm-dd — the day the liver will come. */
  date: string;
  method: PulloutMethod;
  /** Item keys (Row Key, or "#<row number>" when a row has no key yet). */
  itemKeys: string[];
  /** Human-readable list, so the sheet tab is readable on its own. */
  summary: string;
  note: string;
  status: PulloutRequestStatus;
  requestedBy: string;
  requestedAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface PulloutRequestInput {
  liver: string;
  date: string;
  method: PulloutMethod;
  itemKeys: string[];
  summary: string;
  note: string;
}

/** Statuses that make an item show in the liver's "Items to pull out" list. */
export function isToPullOut(r: DatabaseRowType): boolean {
  return String(r.status ?? "").trim().toLowerCase() === "for pullout";
}

export function isCancelledItem(r: DatabaseRowType): boolean {
  return /^cancel/i.test(String(r.status ?? "").trim());
}

/** Stable key for an item in a request. */
export function itemKey(r: DatabaseRowType): string {
  return String(r.rowKey ?? "").trim() || `#${r.id}`;
}

export function findItems(records: DatabaseRowType[], keys: string[]): DatabaseRowType[] {
  const want = new Set(keys);
  return records.filter((r) => want.has(itemKey(r)));
}

export function itemSummary(items: DatabaseRowType[]): string {
  return items
    .map((r) => [r.minerName, r.itemDescription, r.grams ? `${r.grams}g` : ""].filter(Boolean).join(" · "))
    .join("\n");
}

export function isOpenRequest(q: PulloutRequest): boolean {
  return q.status === "Requested" || q.status === "Ready";
}

export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The day has passed and the liver hasn't come yet. */
export function isOverdueRequest(q: PulloutRequest, today = todayISO()): boolean {
  return isOpenRequest(q) && !!q.date && q.date < today;
}

const ISO_AT_START = /^(\d{4}-\d{2}-\d{2}T[^ |]+)\s*\|/;

/**
 * When the item got its current status: the latest change-history line that
 * touched "status", else the live date.
 */
export function statusChangedAt(r: DatabaseRowType): Date | null {
  const lines = String(r.auditTrail ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/\bstatus\b/i.test(lines[i])) continue;
    const m = lines[i].match(ISO_AT_START);
    if (m) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return parseDateRobust(r.dateOfLive);
}
