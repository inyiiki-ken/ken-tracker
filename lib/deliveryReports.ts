/**
 * Delivery reports (owner decision): the liver tells Dispatch that a customer
 * got her For COD / For Pick Up items ("Delivered" / "Picked up", COD with the
 * cash she collected). Dispatch confirms with one tap, which sets the items'
 * status and stamps the Delivered date, or rejects with a reason she sees.
 *
 *   Reported → Confirmed (items set Delivered / Picked Up)
 *            → Rejected (Dispatch's reason) · Withdrawn (the liver took it back)
 *
 * The cash is kept on the report and in the items' change history, never in
 * the payment columns. Reported items don't count as overdue while the report
 * is open. Shared types and pure helpers (client + server).
 */

import type { DatabaseRowType } from "@/types";
import { boxFromStatus, fulfilmentStage } from "@/lib/fulfilment";

export type DeliveryKind = "Delivered" | "Picked up";
export type DeliveryReportStatus = "Reported" | "Confirmed" | "Rejected" | "Withdrawn";

export interface DeliveryReport {
  id: string;
  liver: string;
  kind: DeliveryKind;
  /** Item keys (Row Key). */
  itemKeys: string[];
  /** Human-readable list, so the sheet tab is readable on its own. */
  summary: string;
  /** Cash the liver collected (COD only), AED; null when she left it empty. */
  cash: number | null;
  note: string;
  status: DeliveryReportStatus;
  /** Dispatch's reason when it rejected the report. */
  dispatchReply: string;
  reportedBy: string;
  reportedAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface DeliveryReportInput {
  liver: string;
  kind: DeliveryKind;
  itemKeys: string[];
  /** COD only; ignored for pick-up. */
  cash?: number | null;
  note?: string;
}

/** What she may report on an item: Delivered for For COD, Picked up for For Pick Up, else nothing. */
export function deliveryKindOf(r: Pick<DatabaseRowType, "status">): DeliveryKind | null {
  const box = boxFromStatus(r.status);
  return box === "cod" ? "Delivered" : box === "pickup" ? "Picked up" : null;
}

export function isOpenReport(q: DeliveryReport): boolean {
  return q.status === "Reported";
}

/** The status a COD item gets when Dispatch confirms. */
export const DELIVERED_STATUS = "Delivered";

/**
 * The status a picked-up item gets when Dispatch confirms: "Picked Up" (in the
 * list's spelling) when Dispatch's status list has it, else Delivered.
 */
export function pickedUpStatus(dispatchStatuses: string[]): string {
  return dispatchStatuses.map((s) => String(s ?? "").trim()).find((s) => /^picked ?up$/i.test(s)) ?? DELIVERED_STATUS;
}

/** A status confirm may set (the server refuses anything else). */
export function isConfirmStatus(s: string): boolean {
  return fulfilmentStage(s) === "delivered" && /^(picked ?up|delivered)$/i.test(s.trim());
}

/** The status confirm sets for a report of this kind. */
export function confirmStatusFor(kind: DeliveryKind, dispatchStatuses: string[]): string {
  return kind === "Picked up" ? pickedUpStatus(dispatchStatuses) : DELIVERED_STATUS;
}

/** Cash typed by the liver ("1,250", "AED 500") as a number; null when empty, NaN when not a number. */
export function parseCash(v: unknown): number | null {
  const s = String(v ?? "").replace(/aed|,|\s/gi, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}
