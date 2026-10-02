import type { DatabaseRowType } from "@/types";
import { parseDateRobust, customerKey } from "@/lib/calculations";

/**
 * Each customer's newest purchase — shared by the reminders (client) and
 * getRecords (server), which works it out over EVERY row before sending a
 * liver only her own, so her deadlines match the ones Dispatch sees.
 */

const ISO_AT_START = /^(\d{4}-\d{2}-\d{2}T[^ |]+)\s*\|/;

/** The date at the start of a change-history line. */
export function lineDate(line: string): Date | null {
  const m = line.match(ISO_AT_START);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When the item was bought: live date, else the first dated history line. */
export function boughtOn(r: DatabaseRowType): Date | null {
  const d = parseDateRobust(r.dateOfLive);
  if (d) return d;
  for (const l of String(r.auditTrail ?? "").split("\n")) { const x = lineDate(l); if (x) return x; }
  return null;
}

/** Each customer's latest purchase (any item that isn't cancelled or returned). */
export function newestPurchaseByCustomer(all: DatabaseRowType[]): Map<string, Date> {
  const m = new Map<string, Date>();
  for (const r of all) {
    // Cancelled / returned (lib/fulfilment's "excluded"; not imported here because
    // the server uses this file and fulfilment reads the client-side settings).
    if (/^(cancel|returned)/i.test(String(r.status ?? "").trim())) continue;
    const d = boughtOn(r);
    if (!d) continue;
    const k = customerKey(r);
    const cur = m.get(k);
    if (!cur || d > cur) m.set(k, d);
  }
  return m;
}
