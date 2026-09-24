"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { startLiveSession, finishLiveSession, addLiveItems } from "@/lib/api";
import { rateFor, roundAmount, round2, todayISO, type LivePriceList, type LiveSession } from "@/lib/liveSellers";
import { Field, g, money } from "./parts";

export type LiveDayMode = "out" | "back" | "hold";

interface Row {
  key: number;
  description: string;
  type: string;
  grams: string;
  amount: string;
  amountEdited: boolean;
}

let rowSeq = 1;
function emptyRow(type = ""): Row {
  return { key: rowSeq++, description: "", type, grams: "", amount: "", amountEdited: false };
}

const TOLERANCE = 0.1; // grams — scale rounding

interface Props {
  open: boolean;
  mode: LiveDayMode;
  onClose: () => void;
  onSaved: () => void;
  priceList: LivePriceList;
  sellers: string[];
  /** Open weigh-out being weighed back (mode "back"). */
  session?: LiveSession | null;
  /** Pre-selected seller (mode "hold" or "out"). */
  seller?: string;
}

export default function LiveDayDialog({ open, mode, onClose, onSaved, priceList, sellers, session, seller }: Props) {
  const [date, setDate] = useState(todayISO());
  const [name, setName] = useState("");
  const [weightOut, setWeightOut] = useState("");
  const [weightBack, setWeightBack] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(session?.date || todayISO());
    setName(session?.seller || seller || "");
    setWeightOut(session ? String(session.weightOut) : "");
    setWeightBack("");
    setNotes(session?.notes || "");
    setRows([emptyRow(), emptyRow(), emptyRow()]);
  }, [open, session, seller]);

  const cur = priceList.currency;
  const withAmounts = useMemo(
    () =>
      rows.map((r) => {
        const grams = parseFloat(r.grams) || 0;
        const rate = rateFor(priceList, r.type);
        const auto = roundAmount(grams * rate);
        const amount = r.amountEdited ? parseFloat(r.amount) || 0 : auto;
        return { ...r, gramsN: grams, rate, amountN: amount };
      }),
    [rows, priceList]
  );
  const filled = withAmounts.filter((r) => r.description.trim() || r.gramsN > 0);
  const listed = round2(filled.reduce((s, r) => s + r.gramsN, 0));
  const total = filled.reduce((s, r) => s + r.amountN, 0);
  const outN = parseFloat(weightOut) || 0;
  const backN = weightBack === "" ? null : parseFloat(weightBack) || 0;
  const missing = backN === null ? null : round2(outN - backN);
  const diff = missing === null ? null : round2(missing - listed);

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = async () => {
    const who = name.trim().toUpperCase();
    if (!who) return toast.error("Enter the live seller.");
    const bad = filled.find((r) => !r.type || !(r.gramsN > 0));
    if (mode !== "out" && bad) return toast.error("Each item needs a type and grams.");
    setSaving(true);
    try {
      if (mode === "out") {
        if (!(outN > 0)) throw new Error("Enter the weight going out.");
        await startLiveSession({ date, seller: who, weightOut: outN, notes });
        toast.success(`${g(outN)} out with ${who}.`);
      } else if (mode === "back") {
        if (!(outN > 0)) throw new Error("Enter the weight that went out.");
        if (backN === null) throw new Error("Enter the weight that came back.");
        if (backN > outN + TOLERANCE) throw new Error("Weight back is more than weight out. Check the scale.");
        const items = filled.map((r) => ({ description: r.description, type: r.type, grams: r.gramsN, rate: r.rate, amount: r.amountN }));
        const res = await finishLiveSession({ sessionId: session?.id, date, seller: who, weightOut: outN, weightBack: backN, notes, items });
        toast.success(`${res.added} item${res.added === 1 ? "" : "s"} on hold for ${who}.`);
      } else {
        if (!filled.length) throw new Error("Add at least one item.");
        const items = filled.map((r) => ({ description: r.description, type: r.type, grams: r.gramsN, rate: r.rate, amount: r.amountN }));
        const res = await addLiveItems({ seller: who, liveDate: date, items });
        toast.success(`${res.added} item${res.added === 1 ? "" : "s"} added to ${who}'s container.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "out" ? "Weigh out" : mode === "back" ? "Weigh back & list items" : "Add to container";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-3xl max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary">{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Live seller">
            <Input list="ls-sellers" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PAPS" className="text-sm uppercase" disabled={!!session} />
            <datalist id="ls-sellers">{sellers.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label={mode === "hold" ? "Live date" : "Date"}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm" />
          </Field>
          {mode !== "hold" && (
            <Field label="Weight out (g)">
              <Input type="number" step="any" inputMode="decimal" value={weightOut} onChange={(e) => setWeightOut(e.target.value)} className="text-sm" />
            </Field>
          )}
          {mode === "back" && (
            <Field label="Weight back (g)">
              <Input type="number" step="any" inputMode="decimal" value={weightBack} onChange={(e) => setWeightBack(e.target.value)} className="text-sm" autoFocus />
            </Field>
          )}
        </div>

        {mode === "out" && (
          <p className="text-xs text-muted-foreground">
            Weigh everything the seller takes for the live and enter the total. When it comes back, tap <b>Weigh back</b> on the seller.
          </p>
        )}
        {mode === "hold" && (
          <p className="text-xs text-muted-foreground">
            For items taken straight from the shop (for example a customer changed an item). They go on hold and leave the shop stock.
          </p>
        )}

        {mode !== "out" && (
          <>
            <div className="flex items-center justify-between mt-1">
              <p className="text-sm font-semibold">Items taken <span className="text-xs font-normal text-muted-foreground">— type sets the rate, amount fills in</span></p>
              <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, emptyRow(r[r.length - 1]?.type || "")])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Row
              </Button>
            </div>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-[11px] text-muted-foreground text-left">
                    <th className="px-1 py-1 font-medium">Description</th>
                    <th className="px-1 py-1 font-medium w-40">Type</th>
                    <th className="px-1 py-1 font-medium w-24 text-right">Grams</th>
                    <th className="px-1 py-1 font-medium w-14 text-right">Rate</th>
                    <th className="px-1 py-1 font-medium w-28 text-right">Amount</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {withAmounts.map((r) => (
                    <tr key={r.key}>
                      <td className="px-1 py-1">
                        <Input value={r.description} onChange={(e) => setRow(r.key, { description: e.target.value })} placeholder="e.g. Cuban chain 20in" className="h-8 text-sm" />
                      </td>
                      <td className="px-1 py-1">
                        <Select value={r.type || undefined} onValueChange={(v) => setRow(r.key, { type: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
                          <SelectContent>
                            {priceList.types.map((t) => (
                              <SelectItem key={t.name} value={t.name} className="text-xs">{t.name} · {t.rate}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1">
                        <Input type="number" step="any" inputMode="decimal" value={r.grams} onChange={(e) => setRow(r.key, { grams: e.target.value })} className="h-8 text-sm text-right" />
                      </td>
                      <td className="px-1 py-1 text-right text-muted-foreground tabular-nums">{r.rate || "—"}</td>
                      <td className="px-1 py-1">
                        <Input
                          type="number"
                          step="any"
                          value={r.amountEdited ? r.amount : r.amountN ? String(r.amountN) : ""}
                          onChange={(e) => setRow(r.key, { amount: e.target.value, amountEdited: e.target.value !== "" })}
                          className={`h-8 text-sm text-right ${r.amountEdited ? "border-warning" : ""}`}
                          title={r.amountEdited ? "Changed by hand — clear to go back to grams × rate" : "grams × rate"}
                        />
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))} className="text-muted-foreground hover:text-destructive" title="Remove row">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Items listed</span><span className="tabular-nums">{filled.length} · {g(listed)} · {money(total, cur)}</span></div>
              {mode === "back" && missing !== null && (
                <div className="flex justify-between"><span className="text-muted-foreground">Missing from weight ({g(outN)} − {g(backN ?? 0)})</span><span className="tabular-nums">{g(missing)}</span></div>
              )}
            </div>
            {mode === "back" && diff !== null && (
              Math.abs(diff) <= TOLERANCE ? (
                <div className="flex items-center gap-2 rounded-lg bg-success/15 text-success px-3 py-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4" /> Weight matches the items listed.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-warning/15 text-warning px-3 py-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {diff > 0
                    ? `${g(diff)} missing but not listed. Check with the seller before saving.`
                    : `Items listed are ${g(-diff)} more than what's missing. Check the grams.`}
                </div>
              )
            )}
          </>
        )}

        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm" />
        </Field>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {mode === "out" ? "Save weigh-out" : mode === "back" ? "Save & put on hold" : "Add to container"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
