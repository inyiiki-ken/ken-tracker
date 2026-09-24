"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Plus, Minus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { addLiveStock, deleteLiveStock } from "@/lib/api";
import { fmtDate, round2, todayISO, type LiveData, type LiveSession, type LiveStockEntry, type StockSummary } from "@/lib/liveSellers";
import { Chip, Field, Kpi, g } from "./parts";

export default function StockView({ data, stock, onChanged, canDelete, onEditSession, onAddItems }: { data: LiveData; stock: StockSummary; onChanged: () => Promise<void> | void; canDelete: boolean; onEditSession: (s: LiveSession) => void; onAddItems: (s: LiveSession) => void }) {
  const [form, setForm] = useState({ date: todayISO(), grams: "", pcs: "", description: "", note: "" });
  const [adjust, setAdjust] = useState(false);
  const [saving, setSaving] = useState(false);
  const [del, setDel] = useState<LiveStockEntry | null>(null);

  const sessions = useMemo(() => {
    const listed = new Map<string, number>();
    for (const i of data.items) if (i.sessionId) listed.set(i.sessionId, (listed.get(i.sessionId) ?? 0) + i.grams);
    return [...data.sessions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((s) => ({ ...s, listed: round2(listed.get(s.id) ?? 0) }));
  }, [data]);

  const entries = useMemo(() => [...data.stock].sort((a, b) => b.date.localeCompare(a.date)), [data.stock]);

  const save = async () => {
    const grams = parseFloat(form.grams);
    if (!(grams > 0)) return toast.error("Enter the grams.");
    setSaving(true);
    try {
      await addLiveStock({
        date: form.date,
        grams: adjust ? -grams : grams,
        pcs: parseFloat(form.pcs) || undefined,
        description: form.description,
        note: adjust ? form.note || "Adjustment" : form.note,
      });
      toast.success(adjust ? `${g(grams)} removed from stock.` : `${g(grams)} added to stock.`);
      setForm({ date: todayISO(), grams: "", pcs: "", description: "", note: "" });
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!del) return;
    try {
      await deleteLiveStock({ id: del.id });
      toast.success("Entry deleted.");
      setDel(null);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="In shop" value={g(stock.inShop)} tone={stock.inShop < 0 ? "neg" : undefined} />
        <Kpi label="Out for live" value={g(stock.withSellers)} />
        <Kpi label="On hold (sellers)" value={g(stock.onHold)} tone="warn" />
        <Kpi label="Total stock added" value={g(stock.added)} />
      </div>
      {stock.inShop < 0 && (
        <p className="text-xs text-destructive">In-shop stock is below zero. Add the stock you already have so the numbers start from the right amount.</p>
      )}

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-semibold mr-auto">{adjust ? "Remove from stock (adjustment)" : "Add stock"}</p>
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
            <button onClick={() => setAdjust(false)} className={`px-2.5 py-1 rounded-md ${!adjust ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}><Plus className="h-3 w-3 inline mr-1" />Add</button>
            <button onClick={() => setAdjust(true)} className={`px-2.5 py-1 rounded-md ${adjust ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}><Minus className="h-3 w-3 inline mr-1" />Adjust</button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="text-sm" /></Field>
          <Field label="Grams"><Input type="number" step="any" inputMode="decimal" value={form.grams} onChange={(e) => setForm((f) => ({ ...f, grams: e.target.value }))} className="text-sm" /></Field>
          <Field label="Pcs (optional)"><Input type="number" value={form.pcs} onChange={(e) => setForm((f) => ({ ...f, pcs: e.target.value }))} className="text-sm" /></Field>
          <Field label="Description (optional)"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={adjust ? "" : "e.g. new batch from supplier"} className="text-sm" /></Field>
          <Field label="Note"><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder={adjust ? "reason" : ""} className="text-sm" /></Field>
        </div>
        <div className="flex justify-end mt-3">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}{adjust ? "Remove from stock" : "Add to stock"}
          </Button>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">Live weigh log</p>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lives recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-[11px] text-muted-foreground text-left border-b border-border">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Seller</th>
                  <th className="px-2 py-2 font-medium text-right">Out</th>
                  <th className="px-2 py-2 font-medium text-right">Back</th>
                  <th className="px-2 py-2 font-medium text-right">Missing</th>
                  <th className="px-2 py-2 font-medium text-right">Listed</th>
                  <th className="px-2 py-2 font-medium">Check</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const missing = s.weightBack === null ? null : round2(s.weightOut - s.weightBack);
                  const diff = missing === null ? null : round2(missing - s.listed);
                  return (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(s.date)}</td>
                      <td className="px-2 py-2">{s.seller}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.weightOut.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.weightBack === null ? "—" : s.weightBack.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{missing === null ? "—" : missing.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.listed.toFixed(2)}</td>
                      <td className="px-2 py-2">
                        {s.status === "Out" ? (
                          <Chip>Out</Chip>
                        ) : diff !== null && Math.abs(diff) <= 0.1 ? (
                          <Chip tone="Sold">Matches</Chip>
                        ) : (
                          <button onClick={() => onAddItems(s)} title="Add the missing items to this live">
                            <Chip tone="On hold">{diff !== null && diff > 0 ? `${diff.toFixed(2)} g not listed · add items` : `${Math.abs(diff ?? 0).toFixed(2)} g over`}</Chip>
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => onEditSession(s)} className="text-muted-foreground hover:text-primary" title="Edit or delete"><Pencil className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">Stock added</p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock recorded yet. Start by adding the grams you have now.</p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-muted-foreground">{fmtDate(e.date)}</span>
                <span className={`w-24 shrink-0 tabular-nums font-medium ${e.grams < 0 ? "text-destructive" : "text-success"}`}>{e.grams > 0 ? "+" : ""}{g(e.grams)}</span>
                <span className="mr-auto truncate">{[e.pcs ? `${e.pcs} pcs` : "", e.description, e.note].filter(Boolean).join(" · ") || "—"}</span>
                {canDelete && (
                  <button onClick={() => setDel(e)} className="text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-cinzel text-primary">Delete this stock entry?</AlertDialogTitle>
            <AlertDialogDescription>{del ? `${g(del.grams)} on ${fmtDate(del.date)} will be removed from the stock total.` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
