"use client";

import { useState } from "react";
import { AlertTriangle, Clock, Truck, CheckCircle2, XCircle, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEffectiveStatuses } from "@/lib/statusRegistry";
import { businessDay } from "@/lib/calculations";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DatabaseRowType } from "@/types";
import { formatDate } from "@/lib/formatters";
import { computeOverdue, hoursInStatus, statusSince, MAX_HOLD_DAYS, parseSnooze, snoozeValue, type OverdueSection } from "@/lib/reminders";
import { customerKey, gramsLabel } from "@/lib/calculations";
import { newestPurchaseByCustomer } from "@/lib/purchaseDates";
import { dayKey, fulfilmentStage } from "@/lib/fulfilment";

type BulkUpdate = (updates: { rowId: number; fields: Partial<DatabaseRowType> }[]) => Promise<void>;

/** This customer's own spelling of a status for a stage ("Delivered", "Cancelled"…). */
function statusFor(stage: "dispatched" | "delivered" | "excluded", preferred: string): string {
  const list = getEffectiveStatuses("dispatch");
  return list.find((x) => x.toLowerCase() === preferred.toLowerCase())
    ?? list.find((x) => fulfilmentStage(x) === stage && (stage !== "excluded" || /^cancel/i.test(x)))
    ?? preferred;
}

/** Mark Dispatched / Delivered, Cancel and Snooze for the ticked overdue items of one customer. */
function CardActions({ items, onBulkUpdate, selected }: {
  items: DatabaseRowType[]; onBulkUpdate: BulkUpdate; selected: Set<number>;
}) {
  const [mode, setMode] = useState<"" | "cancel" | "snooze">("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState(1);
  const [busy, setBusy] = useState(false);
  const picked = items.filter((r) => selected.has(r.id));
  const notShipped = picked.filter((r) => !["dispatched", "delivered"].includes(fulfilmentStage(r.status)));
  const run = async (rows: DatabaseRowType[], fields: (r: DatabaseRowType) => Partial<DatabaseRowType>, done: string) => {
    if (!rows.length || busy) return;
    setBusy(true);
    try {
      await onBulkUpdate(rows.map((r) => ({ rowId: r.id, fields: fields(r) })));
      toast.success(`${rows.length} item${rows.length !== 1 ? "s" : ""} ${done}`);
      setMode("");
    } catch {
      toast.error("Could not update all items. Please try again.");
    } finally { setBusy(false); }
  };
  const until = () => businessDay(new Date(Date.now() + days * 86_400_000).toISOString());
  return (
    <div className="mt-2 border-t border-border/60 pt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy || !notShipped.length}
          onClick={() => run(notShipped, () => ({ status: statusFor("dispatched", "Dispatched") }), "marked Dispatched")}>
          <Truck className="h-3 w-3 mr-1" />Mark Dispatched
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy || !picked.length}
          onClick={() => run(picked, () => ({ status: statusFor("delivered", "Delivered") }), "marked Delivered")}>
          <CheckCircle2 className="h-3 w-3 mr-1" />Mark Delivered
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px] text-destructive" disabled={busy || !picked.length}
          onClick={() => { setReason(""); setMode(mode === "cancel" ? "" : "cancel"); }}>
          <XCircle className="h-3 w-3 mr-1" />Cancel…
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={busy || !picked.length}
          onClick={() => { setNote(""); setMode(mode === "snooze" ? "" : "snooze"); }}>
          <BellOff className="h-3 w-3 mr-1" />Snooze…
        </Button>
        {picked.length !== items.length && <span className="text-[10px] text-muted-foreground self-center">{picked.length} of {items.length} ticked</span>}
      </div>
      {mode === "cancel" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-1.5">
          <p className="text-[11px]">Cancel {picked.length} item{picked.length !== 1 ? "s" : ""}? The liver sees the reason.</p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. unpaid after deadline)" className="h-7 text-xs" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="destructive" className="h-7 text-[11px]" disabled={busy || !reason.trim()}
              onClick={() => run(picked, () => ({ status: statusFor("excluded", "Cancelled"), cancelReason: reason.trim() }), "cancelled")}>Confirm cancel</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setMode("")}>Back</Button>
          </div>
        </div>
      )}
      {mode === "snooze" && (
        <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            Hide for
            {[1, 2, 3].map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={`px-2 py-0.5 rounded-full border ${days === d ? "border-primary bg-primary/15 text-primary" : "border-border"}`}>{d} day{d > 1 ? "s" : ""}</button>
            ))}
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. courier says tomorrow)" className="h-7 text-xs" />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 text-[11px]" disabled={busy || !note.trim()}
              onClick={() => run(picked, (r) => ({ reminderSnooze: snoozeValue(until(), String(r.status ?? ""), note) }), `snoozed until ${formatDate(until())}`)}>Save snooze</Button>
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setMode("")}>Back</Button>
          </div>
        </div>
      )}
    </div>
  );
}

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

function ClientCard({ group, section, audience, ownNewest, onBulkUpdate }: {
  group: ReminderGroup;
  section: OverdueSection;
  audience: Audience;
  /** Liver mode: her own newest purchase per customer. */
  ownNewest?: Map<string, Date>;
  onBulkUpdate?: BulkUpdate;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(group.items.map((r) => r.id)));
  const actions = audience === "dispatch" && !!onBulkUpdate;
  // The note left when this customer was last snoozed (shown once it comes back).
  const lastNote = group.items.map((r) => parseSnooze(r.reminderSnooze))
    .filter((n): n is NonNullable<typeof n> => !!n?.note)
    .sort((a, b) => b.until.localeCompare(a.until))[0];
  const days = Math.floor(group.oldestHours / 24);
  const urgent = group.oldestHours >= section.rule.urgentAfterHours;
  const liver = audience === "liver";
  // The newer purchase was on someone else's live when it is on a later day than any of hers.
  const own = ownNewest?.get(group.key);
  const otherLive = liver && !!group.lastBuy && (!own || dayKey(group.lastBuy.toISOString()) > dayKey(own.toISOString()));
  // Liver: days past the deadline (not days in the status).
  const overdueDays = group.due ? Math.max(0, Math.floor((Date.now() - group.due.getTime()) / 86_400_000)) : days;
  const pill = liver
    ? (overdueDays === 0 ? "Overdue today" : `Overdue ${overdueDays}d`)
    : urgent ? (section.rule.cancelWhenOverdue ? "CANCEL?" : "ACTION NEEDED") : `${days}d ago`;
  // Livers read this on a phone: a size up from Dispatch's dense list.
  const small = liver ? "text-xs" : "text-[10px]";
  return (
    <div className={`rounded-lg border p-3 ${urgent ? "border-destructive/40 bg-destructive/5" : "border-border bg-secondary/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">
            {group.name}
            <span className="text-muted-foreground font-normal ml-1.5">· {group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
          </p>
          <p className={`${small} text-muted-foreground`}>
            {(liver ? group.page : [group.liver, group.page].filter(Boolean).join(" · ")) || "—"} · {liver ? `${section.rule.status} since` : "since"} {group.since ? formatDate(group.since.toISOString()) : "—"}
            {group.due && <> · due {formatDate(group.due.toISOString())}</>}
          </p>
          {group.lastBuy && (
            <p className={`${small} text-primary`}>
              {otherLive ? "Bought again on another live" : "Bought again"} {formatDate(group.lastBuy.toISOString())} — deadline counted from then
              {group.capped ? ` (max ${MAX_HOLD_DAYS} days reached)` : ""}
            </p>
          )}
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map((it) => liver ? (
              // Liver (on a phone): what it is on one line, its weight and order date
              // on a second that never gets cut off.
              <li key={it.id} className={`${small} text-muted-foreground flex items-baseline gap-1.5`}>
                <span className="text-muted-foreground/60">•</span>
                <span className="min-w-0">
                  <span className="block truncate">{[it.orderId, it.itemDescription].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="block break-words">
                    {[gramsLabel(it), it.dateOfLive ? `Ordered ${formatDate(it.dateOfLive)}` : ""].filter(x => x && x !== "—").join(" · ")}
                  </span>
                </span>
              </li>
            ) : (
              <li key={it.id} className={`${small} text-muted-foreground flex items-baseline gap-1.5`}>
                {actions
                  ? <input type="checkbox" aria-label={`Select ${it.orderId || it.itemDescription || "item"}`} className="self-center" checked={selected.has(it.id)}
                      onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(it.id); else next.delete(it.id); setSelected(next); }} />
                  : <span className="text-muted-foreground/60">•</span>}
                <span className="truncate">
                  {[it.orderId, it.itemDescription].filter(x => x && x !== "—").join(" · ") || "—"}
                </span>
                <span className="ml-auto shrink-0 text-muted-foreground/70">{Math.floor(hoursInStatus(it) / 24)}d</span>
              </li>
            ))}
          </ul>
          {lastNote && <p className={`${small} text-muted-foreground italic mt-1`}>Last note (snoozed to {formatDate(lastNote.until)}): {lastNote.note}</p>}
          {actions && <CardActions items={group.items} onBulkUpdate={onBulkUpdate!} selected={selected} />}
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
  records, allRecords, onClose, title = "Reminders", intro, audience = "dispatch", exclude, onBulkUpdate,
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
  /** Dispatch: act on items from the reminder (status changes, cancel, snooze). */
  onBulkUpdate?: BulkUpdate;
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
              <p className={`${audience === "liver" ? "text-xs" : "text-[10px]"} text-muted-foreground`}>{audience === "liver" ? "Follow up now." : section.rule.hint}</p>
              {groups.map((g) => <ClientCard key={g.name} group={g} section={section} audience={audience} ownNewest={ownNewest} onBulkUpdate={onBulkUpdate} />)}
            </div>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
