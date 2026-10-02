/**
 * Order codes as written on the masterlist: a letter prefix + a running number
 * that restarts every live (e.g. AMB01, AMB02… or BELLA01). The prefix is
 * whatever THIS tenant's own data uses — nothing here is hard-coded.
 *
 * Plain module (no "use server"/"use client") so the Add Client form and the
 * masterlist import share the same rules.
 */

import type { DatabaseRowType } from "@/types";

const CODE_RE = /^([A-Z]+)-?(\d{1,4})$/;

/** "amb5" / "AMB05" / "AMB-05" → { prefix: "AMB", num: 5, width: 2 }. */
export function splitCode(code: unknown): { prefix: string; num: number; width: number } | null {
  const u = String(code ?? "").toUpperCase().replace(/\s+/g, "").trim();
  const m = u.match(CODE_RE);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10), width: Math.max(2, m[2].length) };
}

/** Comparison key: AMB5 === AMB05 === amb-05. Other codes compare as written. */
export function codeKey(code: unknown): string {
  const p = splitCode(code);
  if (p) return `${p.prefix}${p.num}`;
  return String(code ?? "").toUpperCase().replace(/\s+/g, "").trim();
}

/** "September 24, 2026" / "9/24/2026" / "2026-09-24" → "2026-09-24". */
export function dayKey(v: unknown): string {
  const s = String(v ?? "").trim().replace(/^[a-z]+day,?\s+/i, "");
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.toUpperCase();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const up = (v: unknown) => String(v ?? "").toUpperCase().replace(/\s+/g, " ").trim();

export interface CodeSuggestion {
  /** e.g. "AMB" */
  prefix: string;
  /** Next free code on that day, e.g. "AMB06". */
  next: string;
}

/**
 * Next codes for a manual entry, learnt from the tenant's own records.
 * Prefixes used by the same liver come first, then the ones used on the same
 * page (most recent first). The number is the next one free on that day.
 */
export function suggestOrderCodes(
  records: Pick<DatabaseRowType, "orderId" | "page" | "liverName" | "dateOfLive">[],
  opts: { page?: string; liverName?: string; date?: string },
  limit = 4
): CodeSuggestion[] {
  const page = up(opts.page);
  const liver = up(opts.liverName);
  const day = dayKey(opts.date);

  // prefix -> score (liver match beats page match; recent beats old)
  const score = new Map<string, number>();
  const width = new Map<string, number>();
  const maxOnDay = new Map<string, number>();

  for (const r of records) {
    const p = splitCode(r.orderId);
    if (!p) continue;
    if (!width.has(p.prefix) || p.width > (width.get(p.prefix) ?? 2)) width.set(p.prefix, p.width);
    if (day && dayKey(r.dateOfLive) === day) {
      maxOnDay.set(p.prefix, Math.max(maxOnDay.get(p.prefix) ?? 0, p.num));
    }
    const sameLiver = !!liver && up(r.liverName) === liver;
    const samePage = !!page && up(r.page) === page;
    if (!sameLiver && !samePage) continue;
    const t = Date.parse(dayKey(r.dateOfLive)) || 0;
    const s = (sameLiver ? 1e15 : 0) + t;
    if (s > (score.get(p.prefix) ?? -1)) score.set(p.prefix, s);
  }

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([prefix]) => ({
      prefix,
      next: prefix + String((maxOnDay.get(prefix) ?? 0) + 1).padStart(width.get(prefix) ?? 2, "0"),
    }));
}

/** A code that already looks like this tenant's codes, for the field's hint. */
export function exampleCode(records: Pick<DatabaseRowType, "orderId">[]): string {
  for (let i = records.length - 1; i >= 0; i--) {
    if (splitCode(records[i].orderId)) return String(records[i].orderId).toUpperCase().trim();
  }
  return "";
}
