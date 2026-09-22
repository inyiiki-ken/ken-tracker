"use client";

/**
 * SHARED MOTION COMPONENTS — used by every tab, not one screen.
 *
 * Deliberately small and boring. The job is feedback, not decoration:
 *  - SavedTick     : confirms a write actually happened (the app was silent before)
 *  - Skeleton      : a shimmering placeholder instead of an empty gap
 *  - ProgressBar   : long jobs fill smoothly instead of freezing
 *  - Stagger       : lists enter in sequence so the eye follows the order
 *
 * All of it obeys the reduce-motion setting via globals.css.
 */

import { useEffect, useState, type ReactNode } from "react";

/** Draws a tick, then fades out. Renders nothing when idle. */
export function SavedTick({
  show,
  label = "Saved",
  onDone,
}: {
  show: boolean;
  label?: string;
  onDone?: () => void;
}) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (!show) return;
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); onDone?.(); }, 1600);
    return () => clearTimeout(t);
  }, [show, onDone]);

  if (!visible) return null;

  return (
    <span className="kt-fade inline-flex items-center gap-1 text-[10px] text-success font-medium">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path className="kt-draw" d="M4 12.5l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </span>
  );
}

/** Convenience hook: flash a saved tick after an async action succeeds. */
export function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  return [saved, () => { setSaved(false); requestAnimationFrame(() => setSaved(true)); }];
}

/** Shimmering placeholder. Use while data loads instead of a blank area. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`kt-skeleton ${className}`} aria-hidden="true" />;
}

/** A few skeleton rows shaped like a client card list. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Determinate progress for long jobs (imports, bulk apply, backfills). */
export function ProgressBar({
  value,
  label,
  className = "",
}: {
  value: number; // 0..100
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={className}>
      {label && (
        <div className="flex justify-between text-[11px] mb-1.5">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-foreground tabular-nums">{pct}%</span>
        </div>
      )}
      <div
        className="h-1.5 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="kt-bar-fill h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Wrap a list so its children enter in sequence. */
export function Stagger({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`kt-stagger ${className}`}>{children}</div>;
}

/** Wrap a single block so it eases in. */
export function Rise({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`kt-rise ${className}`}>{children}</div>;
}
