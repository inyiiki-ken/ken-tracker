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

/** When the item was bought, and the raw value it was read from (live date, else the first dated history line). */
function boughtOnWithSource(r: DatabaseRowType): { at: Date; raw: string } | null {
  const d = parseDateRobust(r.dateOfLive);
  if (d) return { at: d, raw: String(r.dateOfLive).trim() };
  for (const l of String(r.auditTrail ?? "").split("\n")) {
    const x = lineDate(l);
    if (x) return { at: x, raw: l.match(ISO_AT_START)![1] };
  }
  return null;
}

/** When the item was bought: live date, else the first dated history line. */
export function boughtOn(r: DatabaseRowType): Date | null {
  return boughtOnWithSource(r)?.at ?? null;
}

function newestByCustomer(all: DatabaseRowType[]): Map<string, { at: Date; raw: string }> {
  const m = new Map<string, { at: Date; raw: string }>();
  for (const r of all) {
    // Cancelled / returned (lib/fulfilment's "excluded"; not imported here because
    // the server uses this file and fulfilment reads the client-side settings).
    if (/^(cancel|returned)/i.test(String(r.status ?? "").trim())) continue;
    const b = boughtOnWithSource(r);
    if (!b) continue;
    const k = customerKey(r);
    const cur = m.get(k);
    if (!cur || b.at > cur.at) m.set(k, b);
  }
  return m;
}

/** Each customer's latest purchase (any item that isn't cancelled or returned). */
export function newestPurchaseByCustomer(all: DatabaseRowType[]): Map<string, Date> {
  return new Map(Array.from(newestByCustomer(all), ([k, b]) => [k, b.at]));
}

/**
 * The same, as the raw sheet value (live date text or history timestamp). The
 * server stamps this on a liver's rows and her device reads it with the same
 * parser as her own rows, so a date-only live lands on the same instant on
 * both sides whatever the server's timezone.
 */
export function newestPurchaseRawByCustomer(all: DatabaseRowType[]): Map<string, string> {
  return new Map(Array.from(newestByCustomer(all), ([k, b]) => [k, b.raw]));
}
