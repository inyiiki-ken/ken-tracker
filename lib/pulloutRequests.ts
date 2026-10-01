/**
 * Pullout requests — a liver tells Dispatch which "For Pullout" / Outsource items they will
 * pull out, on which day, and whether they go For COD or For Pick Up, so the
 * items are prepared before the liver comes to the office.
 *
 *   Requested → Dispatch prepares → Ready → liver comes, Dispatch sets the
 *   items to For COD / For Pick Up → Done.
 *
 * The liver may change or cancel the request until Dispatch marks it Ready.
 * Dispatch can reply, move the day or cancel it while it is open; Done and
 * Cancelled are final.
 * Shared types and pure helpers (client + server).
 */

import type { DatabaseRowType } from "@/types";
import { parseDateRobust } from "@/lib/calculations";
import { todayLocalISO } from "@/lib/businessConfig";

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
  /** Item keys (Row Key; older requests may hold "#<row number>"). */
  itemKeys: string[];
  /** Human-readable list, so the sheet tab is readable on its own. */
  summary: string;
  /** The liver's note. */
  note: string;
  /** Dispatch's answer ("Ring not found — call me"), shown on the liver's card. */
  dispatchReply: string;
  status: PulloutRequestStatus;
  requestedBy: string;
  requestedAt: string;
  updatedBy: string;
  updatedAt: string;
  /** Sent by someone other than the liver (an admin on her behalf). Staff view only. */
  onBehalf?: boolean;
}

/**
 * Moves a request may make. Done and Cancelled are final. A liver may only
 * withdraw her own request while it is Requested (server-enforced).
 */
export const PULLOUT_MOVES: Record<PulloutRequestStatus, PulloutRequestStatus[]> = {
  Requested: ["Ready", "Cancelled"],
  Ready: ["Requested", "Done", "Cancelled"],
  Done: [],
  Cancelled: [],
};

/** What "Liver came" does (or would do) to a request's items. */
export interface LiverCameMove { key: string; rowId: number; summary: string; from: string; to: string }
export interface LiverCamePlan {
  moves: LiverCameMove[];
  /** In the request but no longer waiting to be pulled out; reason is its status (Cancelled…). */
  skipped: { key: string; summary: string; reason: string }[];
  /** Keys that match no item of this liver (deleted, or the ID changed). */
  missing: number;
  total: number;
}

export interface PulloutRequestInput {
  liver: string;
  date: string;
  method: PulloutMethod;
  itemKeys: string[];
  summary: string;
  note: string;
}

/** Statuses that make an item show in the liver's "Items to pull out" list:
 * For Pullout (any spelling, and the old "Dispatch" status), and Outsource
 * items (Dispatch gets them in before the liver comes). Not the Settings
 * pullout list: a customer may have put For COD in it. */
export function isToPullOut(r: Pick<DatabaseRowType, "status">): boolean {
  const s = String(r.status ?? "").trim().toLowerCase();
  return s === "dispatch" || /\bpull\s?-?out\b/.test(s) || /outsourc/.test(s);
}

/** Liver names compared the way the masterlist's Liver column is (case/spaces ignored). */
export function liverKey(v: unknown): string {
  return String(v ?? "").toUpperCase().trim().replace(/\s+/g, " ");
}

export function isCancelledItem(r: DatabaseRowType): boolean {
  return /^cancel/i.test(String(r.status ?? "").trim());
}

/** Stable key for an item in a request ("#<row>" only marks a row with no Row Key yet). */
export function itemKey(r: DatabaseRowType): string {
  return String(r.rowKey ?? "").trim() || `#${r.id}`;
}

/** A Row Key a new request may use ("#<row>" moves with the sheet's sorting). */
export function isRealItemKey(k: string): boolean {
  return !!k && !k.startsWith("#");
}

/** Items by key, built once per records list (see itemsFor). */
export function itemsByKey(records: DatabaseRowType[]): Map<string, DatabaseRowType[]> {
  const m = new Map<string, DatabaseRowType[]>();
  for (const r of records) {
    const k = itemKey(r);
    const g = m.get(k);
    if (g) g.push(r); else m.set(k, [r]);
  }
  return m;
}

export function itemsFor(byKey: Map<string, DatabaseRowType[]>, keys: string[]): DatabaseRowType[] {
  return keys.flatMap((k) => byKey.get(k) ?? []);
}

export function findItems(records: DatabaseRowType[], keys: string[]): DatabaseRowType[] {
  return itemsFor(itemsByKey(records), keys);
}

/** One line per item: "MARIA · ring · 2.1g". */
export function itemLine(r: DatabaseRowType): string {
  return [r.minerName, r.itemDescription, r.grams ? `${r.grams}g` : ""].filter(Boolean).join(" · ");
}

export function itemSummary(items: DatabaseRowType[]): string {
  return items.map(itemLine).join("\n");
}

export function isOpenRequest(q: PulloutRequest): boolean {
  return q.status === "Requested" || q.status === "Ready";
}

/** yyyy-mm-dd. Without a date: the business's "today" (its timezone, not the device's). */
export function todayISO(d?: Date): string {
  if (!d) return todayLocalISO();
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
