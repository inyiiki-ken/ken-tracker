"use client";

import { Label } from "@/components/ui/label";

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "warn" | "neg" }) {
  const color = tone === "pos" ? "text-success" : tone === "warn" ? "text-warning" : tone === "neg" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold leading-tight ${color}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p> : null}
    </div>
  );
}

const CHIP: Record<string, string> = {
  "On hold": "bg-warning/15 text-warning",
  Sold: "bg-success/15 text-success",
  Cancelled: "bg-destructive/15 text-destructive",
  Out: "bg-info/15 text-info",
  Returned: "bg-muted text-muted-foreground",
  "Fast moving": "bg-success/15 text-success",
  Moving: "bg-info/15 text-info",
  Slow: "bg-warning/15 text-warning",
  "Not moving": "bg-muted text-muted-foreground",
  "No sales yet": "bg-muted text-muted-foreground",
};

export function Chip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const key = tone ?? (typeof children === "string" ? children : "");
  return (
    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CHIP[key] || "bg-muted text-foreground/80"}`}>
      {children}
    </span>
  );
}

export function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function g(n: number): string {
  return `${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} g`;
}

export function money(n: number, cur: string): string {
  return `${cur} ${Math.round(n).toLocaleString("en-US")}`;
}

export function holdingLabel(days: number): string {
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}
