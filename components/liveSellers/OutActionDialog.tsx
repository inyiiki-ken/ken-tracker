"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { addToLiveSession, transferLiveWeight } from "@/lib/api";
import { round2, type LiveSession } from "@/lib/liveSellers";
import { Field, g } from "./parts";

export type OutAction = "add" | "give";

/**
 * While a seller's stock is still out for the live:
 *   add  — more pieces taken from the room, weighed and added to her
 *   give — she lends grams to another seller (back through the room and out to them)
 */
export default function OutActionDialog({
  open, action, session, sellers, onClose, onSaved,
}: {
  open: boolean;
  action: OutAction;
  session: LiveSession | null;
  sellers: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grams, setGrams] = useState("");
  const [note, setNote] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setGrams(""); setNote(""); setTo(""); }
  }, [open]);

  if (!session) return null;
  const n = parseFloat(grams) || 0;
  const after = action === "add" ? round2(session.weightOut + n) : round2(session.weightOut - n);

  const save = async () => {
    if (!(n > 0)) return toast.error("Enter the grams.");
    setSaving(true);
    try {
      if (action === "add") {
        await addToLiveSession({ sessionId: session.id, grams: n, note });
        toast.success(`${g(n)} added to ${session.seller}.`);
      } else {
        const who = to.trim().toUpperCase();
        if (!who) throw new Error("Choose who receives it.");
        await transferLiveWeight({ fromSessionId: session.id, toSeller: who, grams: n, note });
        toast.success(`${g(n)} moved from ${session.seller} to ${who}.`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary">
            {action === "add" ? `Add more to ${session.seller}` : `${session.seller} lends to another seller`}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {action === "add"
            ? "Weigh the extra pieces she takes from the room and enter the grams."
            : "The pieces come back to the room, are weighed, and go out to the other seller. Enter the grams."}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {action === "give" && (
            <Field label="Give to" full>
              <Input list="ls-give-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. NENA" className="text-sm uppercase" autoFocus />
              <datalist id="ls-give-to">{sellers.filter((s) => s !== session.seller).map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
          )}
          <Field label="Grams">
            <Input type="number" step="any" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} className="text-sm" autoFocus={action === "add"} />
          </Field>
          <Field label="Note (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === "add" ? "e.g. 2 rings" : "e.g. bracelet"} className="text-sm" />
          </Field>
        </div>
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm flex justify-between">
          <span className="text-muted-foreground">{session.seller} out now</span>
          <span className="tabular-nums">{g(session.weightOut)} → <b>{g(Math.max(0, after))}</b></span>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {action === "add" ? "Add to her" : "Give"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
