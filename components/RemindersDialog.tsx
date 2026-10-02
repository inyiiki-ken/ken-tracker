"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DatabaseRowType } from "@/types";
import { formatDate } from "@/lib/formatters";
import { computeOverdue, hoursInStatus, statusSince, MAX_HOLD_DAYS, type OverdueSection } from "@/lib/reminders";
import { customerKey, gramsLabel } from "@/lib/calculations";
import { newestPurchaseByCustomer } from "@/lib/purchaseDates";

/** Who reads the dialog: Dispatch (everyone's items) or a liver (her own). */
type Audience = "liver" | "dispatch";

/** One card per CLIENT — their overdue items listed under the name once. */
interface ReminderGroup {
  name: string;
  items: DatabaseRowType[];
  oldestHours: number;
  page: string;
  liver: string;
  /** Customer key, to tell whether the newer purchase was on her own live. */
  key: string;
  since?: Date | null;
  lastBuy?: Date;
  due?: Date;
  capped: boolean;
}

function groupByClient(list: DatabaseRowType[], section: OverdueSection): ReminderGroup[] {
  const map = new Map<string, ReminderGroup>();
  for (const r of list) {
    const name = (r.minerName || "—").trim();
    const key = name.toLowerCase();
    const hrs = hoursInStatus(r);
    const d = section.info.get(r.id);
    const g = map.get(key);
    if (g) {
      g.items.push(r);
      if (hrs > g.oldestHours) { g.oldestHours = hrs; g.since = statusSince(r); }
      if (d?.lastBuy && (!g.lastBuy || d.lastBuy > g.lastBuy)) g.lastBuy = d.lastBuy;
      if (d && (!g.due || d.due < g.due)) g.due = d.due;
      if (d?.capped) g.capped = true;
    } else {
      map.set(key, { name, items: [r], oldestHours: hrs, page: r.page || "", liver: r.liverName || "", key: customerKey(r), since: statusSince(r), lastBuy: d?.lastBuy, due: d?.due, capped: !!d?.capped });
    }
  }
  return [...map.values()].sort((a, b) => b.oldestHours - a.oldestHours);
}

function ClientCard({ group, section, audience, ownNewest }: {
  group: ReminderGroup;
  section: OverdueSection;
  audience: Audience;
  /** Liver mode: her own newest purchase per customer. */
  ownNewest?: Map<string, Date>;
}) {
  const days = Math.floor(group.oldestHours / 24);
  const urgent = group.oldestHours >= section.rule.urgentAfterHours;
  const liver = audience === "liver";
  // The newer purchase was on someone else's live when it is newer than any of hers.
  const own = ownNewest?.get(group.key);
  const otherLive = liver && !!group.lastBuy && (!own || group.lastBuy.getTime() > own.getTime() + 60_000);
  const pill = liver
    ? `Overdue ${days}d`
    : urgent ? (section.rule.cancelWhenOverdue ? "CANCEL?" : "ACTION NEEDED") : `${days}d ago`;
  return (
    <div className={`rounded-lg border p-3 ${urgent ? "border-destructive/40 bg-destructive/5" : "border-border bg-secondary/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">
            {group.name}
            <span className="text-muted-foreground font-normal ml-1.5">· {group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            {(liver ? group.page : [group.liver, group.page].filter(Boolean).join(" · ")) || "—"} · since {group.since ? formatDate(group.since.toISOString()) : "—"}
            {group.due && <> · due {formatDate(group.due.toISOString())}</>}
          </p>
          {group.lastBuy && (
            <p className="text-[10px] text-primary">
              {otherLive ? "Bought again on another live" : "Bought again"} {formatDate(group.lastBuy.toISOString())} — deadline counted from then
              {group.capped ? ` (max ${MAX_HOLD_DAYS} days reached)` : ""}
            </p>
          )}
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map((it) => (
              <li key={it.id} className="text-[10px] text-muted-foreground flex items-baseline gap-1.5">
                <span className="text-muted-foreground/60">•</span>
                <span className="truncate">
                  {[it.orderId, it.itemDescription, liver ? gramsLabel(it) : "", liver && it.dateOfLive ? `Ordered ${formatDate(it.dateOfLive)}` : ""].filter(x => x && x !== "—").join(" · ") || "—"}
                </span>
                <span className="ml-auto shrink-0 text-muted-foreground/70">{Math.floor(hoursInStatus(it) / 24)}d</span>
              </li>
            ))}
          </ul>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${urgent ? `bg-destructive/15 text-destructive border-destructive/30${liver ? "" : " animate-pulse"}` : "bg-warning/15 text-warning border-warning/30"}`}>
          {pill}
        </span>
      </div>
    </div>
  );
}

/**
 * Overdue items by status deadline. Used on the Dispatch board (everyone) and in
 * the liver's own tab (only her items).
 */
export default function RemindersDialog({
  records, allRecords, onClose, title = "Reminders", intro, audience = "dispatch", exclude,
}: {
  records: DatabaseRowType[];
  /** Every record, so a customer's newer purchase counts even if it's not in `records`. */
  allRecords?: DatabaseRowType[];
  onClose: () => void;
  title?: string;
  intro?: string;
  /** "liver": her own wording (no liver name, "Overdue Nd", "Follow up now"). Dispatch is the default. */
  audience?: Audience;
  /** Item ids to leave out (e.g. already in her pullout request). */
  exclude?: Set<number>;
}) {
  const sections = computeOverdue(records, undefined, allRecords ?? records)
    .map((s) => (exclude?.size ? { ...s, items: s.items.filter((r) => !exclude.has(r.id)) } : s))
    .filter((s) => s.items.length > 0);
  const ownNewest = audience === "liver" ? newestPurchaseByCustomer(records) : undefined;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> {title}
          </DialogTitle>
        </DialogHeader>
        {intro && <p className="text-xs text-muted-foreground -mt-1">{intro}</p>}
        {sections.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">✅ Nothing overdue. All clear!</p>}
        {sections.map((section) => {
          const groups = groupByClient(section.items, section);
          return (
            <div key={section.rule.status} className="space-y-2 mt-2">
              <h3 className="text-xs font-bold text-warning uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" /> {section.rule.title} ({groups.length} client{groups.length !== 1 ? "s" : ""} · {section.items.length} item{section.items.length !== 1 ? "s" : ""})
              </h3>
              <p className="text-[10px] text-muted-foreground">{audience === "liver" ? "Follow up now." : section.rule.hint}</p>
              {groups.map((g) => <ClientCard key={g.name} group={g} section={section} audience={audience} ownNewest={ownNewest} />)}
            </div>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
