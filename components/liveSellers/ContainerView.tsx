"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, PackageCheck, XCircle, FileText, Plus, Pencil, Printer, Undo2, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { updateLiveItems, moveLiveItems } from "@/lib/api";
import { useBrand } from "@/components/BrandThemeLoader";
import { brandInitials } from "@/lib/brandSettings";
import { buildLiveInvoiceHtml, printHtml } from "@/lib/liveInvoice";
import { daysSince, fmtDate, rateFor, roundAmount, todayISO, type LiveData, type LiveItem, type LiveSession } from "@/lib/liveSellers";
import { Chip, Field, g, holdingLabel, money } from "./parts";
import OpenOutPanel from "./OpenOutPanel";

interface Props {
  seller: string;
  data: LiveData;
  onBack: () => void;
  onChanged: () => Promise<void> | void;
  onAddItems: () => void;
  onWeighBack: (s: LiveSession) => void;
  onOutAction: (action: "add" | "give", s: LiveSession) => void;
}

export default function ContainerView({ seller, data, onBack, onChanged, onAddItems, onWeighBack, onOutAction }: Props) {
  const { settings, invoiceLogo, headerLogo } = useBrand();
  const cur = data.priceList.currency;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pullDate, setPullDate] = useState(todayISO());
  const [invoiceNo, setInvoiceNo] = useState("");
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [edit, setEdit] = useState<LiveItem | null>(null);
  const [editForm, setEditForm] = useState({ description: "", type: "", grams: "", amount: "", liveDate: "" });
  const [lastInvoice, setLastInvoice] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<"sold" | "cancelled">("sold");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");

  const mine = useMemo(() => data.items.filter((i) => i.seller === seller), [data.items, seller]);
  const hold = useMemo(
    () => mine.filter((i) => i.status === "On hold").sort((a, b) => a.liveDate.localeCompare(b.liveDate)),
    [mine]
  );
  const openOut = data.sessions.filter((s) => s.seller === seller && s.status === "Out");
  const sel = hold.filter((i) => selected.has(i.id));
  const holdTotal = hold.reduce((s, i) => s + i.amount, 0);
  const holdGrams = hold.reduce((s, i) => s + i.grams, 0);
  const warn = data.priceList.holdWarnDays;

  const invoices = useMemo(() => {
    const map = new Map<string, LiveItem[]>();
    for (const i of mine) {
      if (i.status !== "Sold") continue;
      const k = i.invoiceNo || `(no number) ${i.pulloutDate}`;
      map.set(k, [...(map.get(k) ?? []), i]);
    }
    return [...map.entries()]
      .map(([no, items]) => ({ no, items, date: items[0].pulloutDate, total: items.reduce((s, i) => s + i.paidAmount, 0) }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  }, [mine]);
  const cancelled = useMemo(
    () => mine.filter((i) => i.status === "Cancelled").sort((a, b) => b.cancelledDate.localeCompare(a.cancelledDate)),
    [mine]
  );

  const logo = invoiceLogo || headerLogo;
  const print = (kind: "hold" | "final", items: LiveItem[], no?: string, date?: string) => {
    const html = buildLiveInvoiceHtml({ kind, seller, items, currency: cur, invoiceNo: no, date: date || todayISO(), brand: settings, logo });
    if (!printHtml(html)) toast.error("Allow pop-ups to print the invoice.");
  };

  const nextInvoiceNo = (dateISO: string) => {
    const prefix = (brandInitials(settings.companyName) || "LS").toUpperCase();
    const stem = `${prefix}-LS-${dateISO.replace(/-/g, "")}-`;
    const used = new Set(data.items.map((i) => i.invoiceNo).filter((n) => n.startsWith(stem)));
    let n = used.size + 1;
    while (used.has(`${stem}${n}`)) n++;
    return `${stem}${n}`;
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = hold.length > 0 && hold.every((i) => selected.has(i.id));

  const openPullout = () => {
    if (!sel.length) return toast.error("Tick the items being pulled out.");
    const d = todayISO();
    setPullDate(d);
    setInvoiceNo(nextInvoiceNo(d));
    setPaid(Object.fromEntries(sel.map((i) => [i.id, String(i.amount)])));
    setPullOpen(true);
  };

  const doPullout = async () => {
    setBusy(true);
    try {
      const paidN = Object.fromEntries(sel.map((i) => [i.id, parseFloat(paid[i.id]) || 0]));
      await updateLiveItems({ action: "pullout", ids: sel.map((i) => i.id), pulloutDate: pullDate, invoiceNo: invoiceNo.trim(), paid: paidN });
      toast.success(`${sel.length} item${sel.length === 1 ? "" : "s"} sold · invoice ${invoiceNo}`);
      setLastInvoice(invoiceNo.trim());
      setSelected(new Set());
      setPullOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pull out failed");
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      await updateLiveItems({ action: "cancel", ids: sel.map((i) => i.id) });
      toast.success(`${sel.length} item${sel.length === 1 ? "" : "s"} cancelled and back in stock.`);
      setSelected(new Set());
      setCancelOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (ids: string[], what: string) => {
    setBusy(true);
    try {
      await updateLiveItems({ action: "restore", ids });
      toast.success(`${what} put back on hold.`);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (i: LiveItem) => {
    setEdit(i);
    setEditForm({ description: i.description, type: i.type, grams: String(i.grams), amount: String(i.amount), liveDate: i.liveDate });
  };
  const editAuto = roundAmount((parseFloat(editForm.grams) || 0) * rateFor(data.priceList, editForm.type));
  const saveEdit = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      await updateLiveItems({
        action: "edit",
        ids: [edit.id],
        edits: {
          [edit.id]: {
            description: editForm.description,
            type: editForm.type,
            grams: parseFloat(editForm.grams) || 0,
            rate: rateFor(data.priceList, editForm.type) || edit.rate,
            amount: editForm.amount === "" ? undefined : parseFloat(editForm.amount) || 0,
            liveDate: editForm.liveDate,
          },
        },
      });
      toast.success("Item updated.");
      setEdit(null);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const otherSellers = useMemo(
    () => [...new Set([...data.items.map((i) => i.seller), ...data.sessions.map((x) => x.seller)])].filter((n) => n && n !== seller).sort(),
    [data, seller]
  );
  const doMove = async () => {
    const to = moveTo.trim().toUpperCase();
    if (!to) return toast.error("Choose who receives the items.");
    if (to === seller) return toast.error("Choose a different seller.");
    setBusy(true);
    try {
      const res = await moveLiveItems({ ids: sel.map((i) => i.id), toSeller: to });
      toast.success(`${res.moved} item${res.moved === 1 ? "" : "s"} moved to ${to}.`);
      setSelected(new Set());
      setMoveOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Move failed");
    } finally {
      setBusy(false);
    }
  };

  const lastInvoiceItems = lastInvoice ? mine.filter((i) => i.invoiceNo === lastInvoice) : [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Sellers
        </Button>
        <h2 className="text-lg font-bold mr-auto">{seller}&apos;s container</h2>
        <Button size="sm" variant="outline" onClick={() => print("hold", hold)} disabled={!hold.length}>
          <FileText className="h-3.5 w-3.5 mr-1.5" /> Hold invoice
        </Button>
        <Button size="sm" variant="outline" onClick={onAddItems}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add item
        </Button>
      </div>

      {openOut.map((s) => (
        <div key={s.id} className="mb-3">
          <OpenOutPanel session={s} onAdd={() => onOutAction("add", s)} onGive={() => onOutAction("give", s)} onWeighBack={() => onWeighBack(s)} />
        </div>
      ))}

      {lastInvoice && lastInvoiceItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-success/15 text-success px-3 py-2 mb-3 text-sm font-medium">
          <PackageCheck className="h-4 w-4" />
          <span className="mr-auto">Sold · invoice {lastInvoice} · {money(lastInvoiceItems.reduce((s, i) => s + i.paidAmount, 0), cur)}</span>
          <Button size="sm" onClick={() => print("final", lastInvoiceItems, lastInvoice, lastInvoiceItems[0].pulloutDate)}>
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Print invoice
          </Button>
          <button className="text-xs underline" onClick={() => setLastInvoice(null)}>Close</button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
          <Chip>On hold</Chip>
          <span className="text-sm text-muted-foreground mr-auto">
            {hold.length} item{hold.length === 1 ? "" : "s"} · {g(holdGrams)} · {money(holdTotal, cur)}
          </span>
          <Button size="sm" variant="outline" onClick={() => { if (!sel.length) return toast.error("Tick the items to move."); setMoveTo(""); setMoveOpen(true); }} disabled={busy} title="Lend to another seller">
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" /> Move
          </Button>
          <Button size="sm" variant="outline" onClick={() => (sel.length ? setCancelOpen(true) : toast.error("Tick the items to cancel."))} disabled={busy}>
            <XCircle className="h-3.5 w-3.5 mr-1.5" /> Cancel
          </Button>
          <Button size="sm" onClick={openPullout} disabled={busy}>
            <PackageCheck className="h-3.5 w-3.5 mr-1.5" /> Pull out{sel.length ? ` ${sel.length}` : ""} → Sold
          </Button>
        </div>
        {hold.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-10">Nothing on hold for {seller}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[11px] text-muted-foreground text-left border-b border-border">
                  <th className="px-3 py-2 w-8">
                    <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? new Set(hold.map((i) => i.id)) : new Set())} />
                  </th>
                  <th className="px-2 py-2 font-medium">Item</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium text-right">Grams</th>
                  <th className="px-2 py-2 font-medium text-right">{cur}</th>
                  <th className="px-2 py-2 font-medium">Live date</th>
                  <th className="px-2 py-2 font-medium">Holding</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {hold.map((i) => {
                  const days = daysSince(i.liveDate);
                  const on = selected.has(i.id);
                  return (
                    <tr key={i.id} className={`border-b border-border/60 ${on ? "bg-primary/5" : ""}`}>
                      <td className="px-3 py-2"><Checkbox checked={on} onCheckedChange={() => toggle(i.id)} /></td>
                      <td className="px-2 py-2">{i.description || "—"}</td>
                      <td className="px-2 py-2"><Chip tone="type">{i.type || "—"}</Chip></td>
                      <td className="px-2 py-2 text-right tabular-nums">{i.grams.toFixed(2)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{Math.round(i.amount).toLocaleString("en-US")}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{fmtDate(i.liveDate)}</td>
                      <td className={`px-2 py-2 whitespace-nowrap ${days >= warn ? "text-destructive font-semibold" : ""}`}>{holdingLabel(days)}</td>
                      <td className="px-2 py-2">
                        <button onClick={() => openEdit(i)} className="text-muted-foreground hover:text-primary" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* History */}
      <div className="mt-5">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setHistoryTab("sold")} className={`text-sm px-3 py-1 rounded-full ${historyTab === "sold" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"}`}>
            Invoices ({invoices.length})
          </button>
          <button onClick={() => setHistoryTab("cancelled")} className={`text-sm px-3 py-1 rounded-full ${historyTab === "cancelled" ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground"}`}>
            Cancelled ({cancelled.length})
          </button>
        </div>
        {historyTab === "sold" ? (
          invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No pullouts yet.</p>
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => (
                <div key={inv.no} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                  <div className="mr-auto min-w-0">
                    <div className="font-medium">{inv.no}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(inv.date)} · {inv.items.length} item{inv.items.length === 1 ? "" : "s"} · {g(inv.items.reduce((s, i) => s + i.grams, 0))}
                    </div>
                  </div>
                  <span className="font-semibold tabular-nums">{money(inv.total, cur)}</span>
                  <Button size="sm" variant="outline" onClick={() => print("final", inv.items, inv.no.startsWith("(") ? undefined : inv.no, inv.date)}>
                    <Printer className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => restore(inv.items.map((i) => i.id), "Invoice items")} disabled={busy} title="Undo pullout (back on hold)">
                    <Undo2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : cancelled.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No cancelled items.</p>
        ) : (
          <div className="space-y-1.5">
            {cancelled.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <span className="mr-auto">{i.description || "—"} <span className="text-muted-foreground">· {i.type} · {g(i.grams)} · live {fmtDate(i.liveDate)} · cancelled {fmtDate(i.cancelledDate)}</span></span>
                <Button size="sm" variant="ghost" onClick={() => restore([i.id], "Item")} disabled={busy} title="Put back on hold">
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pull out dialog */}
      <Dialog open={pullOpen} onOpenChange={setPullOpen}>
        <DialogContent className="bg-card border-border max-w-xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-cinzel text-primary">Pull out → Sold</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pullout date">
              <Input type="date" value={pullDate} onChange={(e) => { setPullDate(e.target.value); setInvoiceNo(nextInvoiceNo(e.target.value || todayISO())); }} className="text-sm" />
            </Field>
            <Field label="Invoice no.">
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="text-sm" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Check the live date and the amount {seller} is paying for each item.</p>
          <div className="space-y-1.5">
            {sel.map((i) => (
              <div key={i.id} className="flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{i.description || "—"}</div>
                  <div className="text-xs text-muted-foreground">{i.type} · {g(i.grams)} · live {fmtDate(i.liveDate)}</div>
                </div>
                <Input
                  type="number"
                  step="any"
                  value={paid[i.id] ?? ""}
                  onChange={(e) => setPaid((p) => ({ ...p, [i.id]: e.target.value }))}
                  className="h-8 w-28 text-right text-sm"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total paid</span>
            <span className="tabular-nums">{money(sel.reduce((s, i) => s + (parseFloat(paid[i.id]) || 0), 0), cur)}</span>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPullOpen(false)} disabled={busy}>Back</Button>
            <Button size="sm" onClick={doPullout} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PackageCheck className="h-4 w-4 mr-2" />}Mark sold & make invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to another seller */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="bg-card border-border max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-cinzel text-primary">Move {sel.length} item{sel.length === 1 ? "" : "s"} to another seller</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            For borrowing: the items come back to the room and go out to the other seller. They stay on hold, now in her container ({g(sel.reduce((s, i) => s + i.grams, 0))}).
          </p>
          <Field label="Move to">
            <Input list="ls-move-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} placeholder="e.g. NENA" className="text-sm uppercase" autoFocus />
            <datalist id="ls-move-to">{otherSellers.map((n) => <option key={n} value={n} />)}</datalist>
          </Field>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMoveOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={doMove} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-cinzel text-primary">Cancel {sel.length} item{sel.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {g(sel.reduce((s, i) => s + i.grams, 0))} goes back to the shop stock. You can undo this from the Cancelled list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on hold</AlertDialogCancel>
            <AlertDialogAction onClick={doCancel}>Cancel items</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit item */}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="bg-card border-border max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-cinzel text-primary">Edit item</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Description" full>
              <Input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="text-sm" />
            </Field>
            <Field label="Type">
              <Select value={editForm.type || undefined} onValueChange={(v) => setEditForm((f) => ({ ...f, type: v, amount: "" }))}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  {data.priceList.types.map((t) => <SelectItem key={t.name} value={t.name} className="text-xs">{t.name} · {t.rate}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Grams">
              <Input type="number" step="any" value={editForm.grams} onChange={(e) => setEditForm((f) => ({ ...f, grams: e.target.value, amount: "" }))} className="text-sm" />
            </Field>
            <Field label={`Amount (${cur})`}>
              <Input type="number" step="any" value={editForm.amount} placeholder={String(editAuto)} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} className="text-sm" />
            </Field>
            <Field label="Live date">
              <Input type="date" value={editForm.liveDate} onChange={(e) => setEditForm((f) => ({ ...f, liveDate: e.target.value }))} className="text-sm" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Leave amount empty to use grams × rate ({money(editAuto, cur)}).</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={saveEdit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
