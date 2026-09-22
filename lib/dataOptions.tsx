"use client";

import { useEffect, useState } from "react";
import { getDataOptions, type DataOptions } from "@/lib/api";

/**
 * Client-side access to the editable dropdown lists stored in the "DATA'S"
 * sheet tab. Fetched once per session (module-level cache) and shared across
 * every form, so opening a modal doesn't re-hit the Sheets API.
 *
 * Sheet values are the source of truth when present; each consumer passes its
 * own hardcoded list as a fallback via `mergeOptions`, so the app still works
 * if the DATA'S tab is missing or a column is blank.
 */

const EMPTY: DataOptions = {
  itemDescriptions: [], currencies: [], categories: [], sources: [], tog: [], livers: [], pages: [],
};

let cache: DataOptions | null = null;
let inflight: Promise<DataOptions> | null = null;

function load(): Promise<DataOptions> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getDataOptions()
      .then((res) => { cache = res; return res; })
      .catch(() => EMPTY)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useDataOptions(): DataOptions {
  const [options, setOptions] = useState<DataOptions>(cache ?? EMPTY);
  useEffect(() => {
    let active = true;
    load().then((res) => { if (active) setOptions(res); });
    return () => { active = false; };
  }, []);
  return options;
}

/** Sheet values first (deduped), then any fallback entries not already present.
 * Case-insensitive de-dup; returns fallback unchanged when the sheet has none. */
export function mergeOptions(sheetValues: string[], fallback: string[]): string[] {
  if (!sheetValues || sheetValues.length === 0) return fallback;
  const seen = new Set(sheetValues.map((v) => v.toLowerCase()));
  const extras = fallback.filter((v) => !seen.has(v.toLowerCase()));
  return [...sheetValues, ...extras];
}
