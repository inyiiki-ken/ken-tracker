"use client";

import type { DatabaseRowType } from "@/types";
import { getAppConfig, type StatusDeadline } from "@/lib/appConfig";
import { parseDateRobust, customerKey } from "@/lib/calculations";

/**
 * Status deadlines ("an item may stay For COD for 3 days, Reseller for 3 weeks").
 * Used by the Dispatch reminders, the liver's own reminders, and the pullout
 * report's "needs to be cancelled" list.
 */

export interface ReminderRule {
  status: string;
  /** Other status values treated as the same (legacy "Dispatch" = "For Pullout"). */
  aliases?: string[];
  days: number;
  title: string;
  hint: string;
  /** Built-in rules only nag; configured deadlines mean "cancel if not done". */
  cancelWhenOverdue: boolean;
  /** Legacy card look: show "ACTION NEEDED" only after this many hours. */
  urgentAfterHours: number;
}

const LEGACY_RULES: ReminderRule[] = [
  {
    status: "Dispatched",
    days: 2,
    title: "Dispatched — Courier Follow-Up",
    hint: "Items dispatched but not yet delivered after 48+ hours.",
    cancelWhenOverdue: false,
    urgentAfterHours: 72,
  },
  {
    status: "For Pullout",
    aliases: ["Dispatch"],
    days: 1,
    title: "For Pullout — Waiting 24h+",
    hint: "Items marked for pullout but still waiting after 24+ hours.",
    cancelWhenOverdue: false,
    urgentAfterHours: 72,
  },
];

function daysLabel(d: number): string {
  if (d % 7 === 0 && d >= 7) return `${d / 7} week${d === 7 ? "" : "s"}`;
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function ruleFromDeadline(d: StatusDeadline): ReminderRule {
  return {
    status: d.status,
    days: d.days,
    title: `${d.status} — over ${daysLabel(d.days)}`,
    hint: `Still "${d.status}" after ${daysLabel(d.days)}. Follow up now or cancel the item.`,
    cancelWhenOverdue: true,
    urgentAfterHours: d.days * 24,
  };
}

/** The customer's deadlines, or the built-in reminders when none are set. */
export function getReminderRules(): ReminderRule[] {
  const cfg = getAppConfig();
  return cfg.statusDeadlines.length ? cfg.statusDeadlines.map(ruleFromDeadline) : LEGACY_RULES;
}

const ISO_AT_START = /^(\d{4}-\d{2}-\d{2}T[^ |]+)\s*\|/;

function lineDate(line: string): Date | null {
  const m = line.match(ISO_AT_START);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * When the item got its current status:
 *   1. the latest change-history line that touched "status";
 *   2. else when the row was created/imported (its first dated line);
 *   3. else the live date.
 * Never earlier than the day the deadlines were switched on.
 */
export function statusSince(r: DatabaseRowType): Date | null {
  const lines = String(r.auditTrail ?? "").split("\n");
  let found: Date | null = null;
  for (let i = lines.length - 1; i >= 0 && !found; i--) {
    if (/\bstatus\b/i.test(lines[i])) found = lineDate(lines[i]);
  }
  if (!found) {
    for (const l of lines) { const d = lineDate(l); if (d) { found = d; break; } }
  }
  if (!found) found = parseDateRobust(r.dateOfLive);
  const start = getAppConfig().deadlinesStartedAt;
  if (start) {
    const s = new Date(start);
    if (!Number.isNaN(s.getTime()) && (!found || found < s)) return s;
  }
  return found;
}

export function hoursInStatus(r: DatabaseRowType, now = Date.now()): number {
  const d = statusSince(r);
  return d ? Math.max(0, Math.floor((now - d.getTime()) / 3_600_000)) : 0;
}

function matches(rule: ReminderRule, status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === rule.status.toLowerCase() || (rule.aliases ?? []).some((a) => a.toLowerCase() === s);
}

/**
 * A customer who buys again is still active, so her waiting items count from her
 * NEWEST purchase (they go out together). But an item never waits longer than
 * this many days from when it got its status (unless the rule itself is longer,
 * e.g. Reseller 3 weeks).
 */
export const MAX_HOLD_DAYS = 7;
const DAY = 86_400_000;

/** When the item was bought: live date, else the first dated history line. */
function boughtOn(r: DatabaseRowType): Date | null {
  const d = parseDateRobust(r.dateOfLive);
  if (d) return d;
  for (const l of String(r.auditTrail ?? "").split("\n")) { const x = lineDate(l); if (x) return x; }
  return null;
}

/** Each customer's latest purchase (any item that isn't cancelled). */
export function lastPurchases(all: DatabaseRowType[]): Map<string, Date> {
  const m = new Map<string, Date>();
  for (const r of all) {
    if (/cancel/i.test(String(r.status ?? ""))) continue;
    const d = boughtOn(r);
    if (!d) continue;
    const k = customerKey(r);
    const cur = m.get(k);
    if (!cur || d > cur) m.set(k, d);
  }
  return m;
}

export interface DueInfo {
  /** When the item got its current status. */
  since: Date;
  /** When it becomes overdue. */
  due: Date;
  /** Newer purchase that pushed the deadline, if any. */
  lastBuy?: Date;
  /** The deadline was pushed but hit the maximum hold. */
  capped: boolean;
}

export function dueInfo(r: DatabaseRowType, rule: ReminderRule, last?: Map<string, Date>): DueInfo | null {
  const since = statusSince(r);
  if (!since) return null;
  let base = since;
  const lb = last?.get(customerKey(r));
  const extended = !!lb && lb.getTime() > since.getTime();
  if (extended) base = lb!;
  let due = new Date(base.getTime() + rule.days * DAY);
  const cap = new Date(since.getTime() + Math.max(rule.days, MAX_HOLD_DAYS) * DAY);
  const capped = due > cap;
  if (capped) due = cap;
  return { since, due, lastBuy: extended ? lb : undefined, capped: extended && capped };
}

export interface OverdueSection {
  rule: ReminderRule;
  items: DatabaseRowType[];
  /** Deadline details per item id. */
  info: Map<number, DueInfo>;
}

/**
 * Items past their deadline, one section per rule (most overdue first).
 * `all` = every record, so a customer's newer purchase is seen even when
 * `records` is only part of the list (e.g. one liver's items).
 */
export function computeOverdue(records: DatabaseRowType[], rules = getReminderRules(), all: DatabaseRowType[] = records): OverdueSection[] {
  const now = Date.now();
  const last = lastPurchases(all);
  return rules
    .map((rule) => {
      const info = new Map<number, DueInfo>();
      const items = records.filter((r) => {
        if (!matches(rule, String(r.status ?? ""))) return false;
        const d = dueInfo(r, rule, last);
        if (!d || now < d.due.getTime()) return false;
        info.set(r.id, d);
        return true;
      }).sort((a, b) => info.get(a.id)!.due.getTime() - info.get(b.id)!.due.getTime());
      return { rule, items, info };
    })
    .filter((s) => s.items.length > 0);
}

/** Items that went past a configured deadline — for the "needs to be cancelled" list. */
export function computeToCancel(records: DatabaseRowType[], all: DatabaseRowType[] = records): OverdueSection[] {
  return computeOverdue(records, getReminderRules(), all).filter((s) => s.rule.cancelWhenOverdue);
}
