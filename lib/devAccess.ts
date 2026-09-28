"use client";

import { useSyncExternalStore } from "react";

/**
 * Who is driving the app right now, shared with any component: the developer
 * (God Mode) outranks every role in every customer, unless they are previewing
 * the app as a specific user.
 */
let state = { isDeveloper: false, previewing: false, previewRoles: [] as string[] };
const listeners = new Set<() => void>();

export function setDevAccess(next: Partial<typeof state>): void {
  const merged = { ...state, ...next };
  if (merged.isDeveloper === state.isDeveloper && merged.previewing === state.previewing &&
      merged.previewRoles.join(",") === state.previewRoles.join(",")) return;
  state = merged;
  listeners.forEach((l) => l());
}

export function getDevAccess() { return state; }

export function useDevAccess() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
    () => state,
  );
}
