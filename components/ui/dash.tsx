"use client";

/**
 * Dashboard primitives — the airy, card-based look for LOW-DENSITY screens
 * (Bossing, Liver). Deliberately NOT used on Admin/Dispatch/Accounts, where
 * staff do bulk data entry and need rows to stay tight.
 *
 * Everything here reads from the theme variables, so each customer's own
 * brand colour and light/dark choice still drive the palette.
 */

import type { ReactNode } from "react";

type Accent = "primary" | "gold" | "silver" | "green" | "orange" | "neutral";

const ACCENT: Record<Accent, { ring: string; chip: string; value: string }> = {
  primary: { ring: "border-primary/30", chip: "bg-primary/10 text-primary", value: "text-primary" },
  gold: { ring: "border-warning/30", chip: "bg-warning/10 text-warning", value: "text-warning" },
  silver: { ring: "border-muted-foreground/30", chip: "bg-muted-foreground/10 text-muted-foreground", value: "text-muted-foreground" },
  green: { ring: "border-success/30", chip: "bg-success/10 text-success", value: "text-success" },
  orange: { ring: "border-warning/30", chip: "bg-warning/10 text-warning", value: "text-warning" },
  neutral: { ring: "border-border", chip: "bg-muted text-muted-foreground", value: "text-foreground" },
};

/** A single headline number with an icon chip and optional footnote. */
export function StatCard({
  icon,
  label,
  value,
  sub,
  accent = "neutral",
  className = "",
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: Accent;
  className?: string;
}) {
  const a = ACCENT[accent];
  return (
    <div className={`rounded-2xl border ${a.ring} bg-card p-4 shadow-sm flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        {icon && (
          <span className={`h-7 w-7 rounded-full grid place-items-center shrink-0 ${a.chip}`}>{icon}</span>
        )}
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground truncate">
          {label}
        </p>
      </div>
      <p className={`text-2xl font-bold leading-none tabular-nums ${a.value}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>}
    </div>
  );
}

/** A titled panel that groups related content. */
export function DashCard({
  icon,
  title,
  action,
  children,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border bg-card shadow-sm overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        {icon && (
          <span className="h-7 w-7 rounded-full grid place-items-center bg-primary/10 text-primary shrink-0">
            {icon}
          </span>
        )}
        <h3 className="font-cinzel text-sm text-foreground flex-1 truncate">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/** Small labelled figure for use inside a DashCard. */
export function MiniStat({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}
