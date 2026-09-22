"use client";

/**
 * Business-specific dropdown fallbacks (Pages, Sources) derived from the
 * customer's OWN loaded records — so a customer without a "DATA'S" options tab
 * still sees their real pages/sources instead of another customer's hardcoded
 * list. Populated once on load (same idea as the status registry).
 */

import type { DatabaseRowType } from "@/types";

let _pages: string[] = [];
let _sources: string[] = [];

function distinct(records: DatabaseRowType[], pick: (r: DatabaseRowType) => unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of records) {
    const v = String(pick(r) ?? "").trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function setKnownOptions(records: DatabaseRowType[]): void {
  _pages = distinct(records, (r) => r.page);
  _sources = distinct(records, (r) => r.source);
}

export function getKnownPages(): string[] {
  return _pages;
}

export function getKnownSources(): string[] {
  return _sources;
}
