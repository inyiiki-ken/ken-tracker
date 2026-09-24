"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Trash2, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { updateLiveSession, deleteLiveSession } from "@/lib/api";
import type { LiveData, LiveSession } from "@/lib/liveSellers";
import { Field, g } from "./parts";

/** Fix a weigh-out / weigh-back entered wrong, or delete it. */
export default function EditSessionDialog({
  session, data, sellers, onClose, onSaved, onAddItems,
}: {
  session: LiveSession | null;
  data: LiveData;
  sellers: string[];
  onClose: () => void;
  onSaved: () => void;
  onAddItems?: (s: LiveSession) => void;
}) {
  const [date, setDate] = useState("");
  const [seller, setSeller] = useState("");
  const [out, setOut] = useState("");
  const [back, setBack] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!session) return;
    setDate(session.date);
    setSeller(session.seller);
    setOut(String(session.weightOut));
    setBack(session.weightBack === null ? "" : String(session.weightBack));
    setNotes(session.notes);
    setConfirmDel(false);
  }, [session]);

  if (!session) return null;
  const linked = data.items.filter((i) => i.sessionId === session.id);
  const sold = linked.filter((i) => i.status === "Sold").length;
  const returned = session.status === "Returned";

  const save = async () => {
    setBusy(true);
    try {
      await updateLiveSession({
        sessionId: session.id,
        date,
        seller,
        weightOut: parseFloat(out) || 0,
        weightBack: returned ? parseFloat(back) || 0 : null,
        notes,
      });
      toast.success("Saved.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await deleteLiveSession({ sessionId: session.id });
      toast.success(res.removedItems ? `Deleted with ${res.removedItems} item${res.removedItems === 1 ? "" : "s"}.` : "Deleted.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!session} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-md" aria-describedby={undefined}>
        <DialogHeader><DialogTitle className="font-cinzel text-primary">Edit {returned ? "live" : "weigh-out"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Seller">
            <Input list="ls-edit-sellers" value={seller} onChange={(e) => setSeller(e.target.value)} className="text-sm uppercase" />
            <datalist id="ls-edit-sellers">{sellers.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-sm" /></Field>
          <Field label="Weight out (g)"><Input type="number" step="any" value={out} onChange={(e) => setOut(e.target.value)} className="text-sm" /></Field>
          {returned && <Field label="Weight back (g)"><Input type="number" step="any" value={back} onChange={(e) => setBack(e.target.value)} className="text-sm" /></Field>}
        </div>
        <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} className="text-sm" /></Field>
        {linked.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {linked.length} item{linked.length === 1 ? "" : "s"} came from this live. To fix an item, open the seller&apos;s container and tap the pencil.
          </p>
        )}
        {returned && onAddItems && (
          <Button size="sm" variant="outline" onClick={() => { onAddItems(session); onClose(); }}>
            <ListPlus className="h-3.5 w-3.5 mr-1.5" /> Add items to this live
          </Button>
        )}
        {confirmDel ? (
          <div className="rounded-lg bg-destructive/10 text-destructive p-3 text-sm space-y-2">
            {sold > 0 ? (
              <p>{sold} item{sold === 1 ? " is" : "s are"} already sold from this live. Undo those pullouts first, then delete.</p>
            ) : (
              <p>Delete this {returned ? "live" : "weigh-out"} ({g(session.weightOut)}){linked.length ? ` and its ${linked.length} item${linked.length === 1 ? "" : "s"}` : ""}? This can&apos;t be undone.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirmDel(false)}>Keep</Button>
              {sold === 0 && <Button size="sm" className="bg-destructive text-destructive-foreground" onClick={remove} disabled={busy}>Delete</Button>}
            </div>
          </div>
        ) : null}
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDel(true)} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
