"use client";

import { useEffect, useRef } from 'react';

/**
 * Calls fn every `ms` while the page is on screen, and right away when it
 * comes back (phone unlocked, tab switched back). No calls while hidden.
 */
export function useVisiblePolling(fn: () => void, ms: number): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => { if (!document.hidden) ref.current(); };
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}
