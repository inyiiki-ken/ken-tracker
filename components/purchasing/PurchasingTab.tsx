"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Loader2, Pencil, Trash2, ShoppingBag, Search, Package } from "lucide-react";
import { toast } from "sonner";
import { getPurchases, createPurchase, updatePurchase, deletePurchase, type PurchaseOrder } from "@/lib/api";
import { PURCHASE_STATUSES } from "@/lib/purchasingConstants";
import { useDataOptions, mergeOptions } from "@/lib/dataOptions";

interface Props {
  userEmail?: string;
}

const STATUS_STYLES: Record<string, string> = {
  Ordered: "bg-warning/15 text-warning",
  Received: "bg-info/15 text-info",
  "Partially Paid": "bg-hold/15 text-hold",
  Paid: "bg-success/15 text-success",
  Cancelled: "bg-destructive/15 text-destructive",
};

const emptyForm = {
  date: new Date().toISOString().split("T")[0],
  supplier: "",
  reference: "",
  item: "",
  category: "",
  qty: "1",
  unitCost: "",
  currency: "AED",
  amountPaid: "",
  status: "Ordered",
  notes: "",
};

export default function PurchasingTab({ userEmail: _userEmail }: Props) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null);

  const dataOpts = useDataOptions();
  const supplierOptions = mergeOptions(dataOpts.sources, []);
  const currencyOptions = mergeOptions(dataOpts.currencies, ["AED", "PHP", "USD"]);
  const categoryOptions = mergeOptions(dataOpts.categories, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await getPurchases({}));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      return [o.supplier, o.item, o.reference, o.category, o.notes].some((f) => f.toLowerCase().includes(q));
    });
  }, [orders, search, statusFilter]);

  const totals = useMemo(() => {
    const live = orders.filter((o) => o.status !== "Cancelled");
    const spend = live.reduce((s, o) => s + o.totalCost, 0);
    const paid = live.reduce((s, o) => s + o.amountPaid, 0);
    return { spend, paid, outstanding: Math.max(0, spend - paid), count: live.length };
  }, [orders]);

  const openAdd = () => { setEditing(null); setForm({ ...emptyForm }); setShowForm(true); };
  const openEdit = (o: PurchaseOrder) => {
    setEditing(o);
    setForm({
      date: o.date || emptyForm.date,
      supplier: o.supplier,
      reference: o.reference,
      item: o.item,
      category: o.category,
      qty: String(o.qty || 1),
      unitCost: String(o.unitCost || ""),
      currency: o.currency || "AED",
      amountPaid: String(o.amountPaid || ""),
      status: o.status || "Ordered",
      notes: o.notes,
    });
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.supplier.trim()) return toast.error("Supplier is required.");
    if (!form.item.trim()) return toast.error("Item is required.");
    setSaving(true);
    const fields = {
      date: form.date,
      supplier: form.supplier.trim(),
      reference: form.reference.trim(),
      item: form.item.trim(),
      category: form.category,
      qty: parseFloat(form.qty) || 0,
      unitCost: parseFloat(form.unitCost) || 0,
      currency: form.currency,
      amountPaid: parseFloat(form.amountPaid) || 0,
      status: form.status,
      notes: form.notes.trim(),
    };
    try {
      if (editing) await updatePurchase({ rowId: editing.id, fields });
      else await createPurchase({ fields });
      toast.success(editing ? "Purchase updated." : "Purchase added.");
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePurchase({ rowId: deleteTarget.id });
      toast.success("Purchase deleted.");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const money = (n: number, cur = "AED") => `${cur} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-4 pt-4">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h1 className="font-cinzel text-lg text-primary flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" /> Purchasing
          </h1>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add purchase
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <SummaryCard label="Total spend" value={money(totals.spend)} />
          <SummaryCard label="Paid" value={money(totals.paid)} tone="pos" />
          <SummaryCard label="Outstanding" value={money(totals.outstanding)} tone={totals.outstanding > 0 ? "neg" : undefined} />
          <SummaryCard label="Orders" value={String(totals.count)} />
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier, item, ref…" className="pl-8 h-8 text-sm" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All statuses</SelectItem>
              {PURCHASE_STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading purchases…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-14 border border-dashed border-border rounded-xl">
            <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{orders.length === 0 ? "No purchases yet. Add your first supplier order." : "No matches for this filter."}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((o) => (
              <div key={o.id} className="rounded-lg border border-border bg-card p-3 gold-left-bar">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{o.supplier || "—"}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[o.status] || "bg-muted text-muted-foreground"}`}>{o.status || "—"}</span>
                      {o.reference && <span className="text-[10px] text-muted-foreground">#{o.reference}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {o.item}{o.category ? ` · ${o.category}` : ""} · {o.qty} × {money(o.unitCost, o.currency)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{o.date}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{money(o.totalCost, o.currency)}</p>
                    <p className={`text-[11px] ${o.balance > 0 ? "text-warning" : "text-success"}`}>
                      {o.balance > 0 ? `${money(o.balance, o.currency)} due` : "Settled"}
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <button onClick={() => openEdit(o)} className="text-muted-foreground hover:text-primary" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setDeleteTarget(o)} className="text-muted-foreground hover:text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="font-cinzel text-primary">{editing ? "Edit purchase" : "Add purchase"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="text-sm" /></Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{PURCHASE_STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Supplier">
              <Input list="po-suppliers" value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} className="text-sm" placeholder="Supplier name" />
              <datalist id="po-suppliers">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Reference (optional)"><Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className="text-sm" placeholder="PO / invoice #" /></Field>
            <Field label="Item" full>
              <Input value={form.item} onChange={(e) => setForm((f) => ({ ...f, item: e.target.value }))} className="text-sm" placeholder="What you bought" />
            </Field>
            <Field label="Category">
              <Input list="po-cats2" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="text-sm" placeholder="optional" />
              <datalist id="po-cats2">{categoryOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </Field>
            <Field label="Currency">
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{currencyOptions.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Qty"><Input type="number" step="any" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} className="text-sm" /></Field>
            <Field label="Unit cost"><Input type="number" step="any" value={form.unitCost} onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))} className="text-sm" /></Field>
            <Field label="Amount paid"><Input type="number" step="any" value={form.amountPaid} onChange={(e) => setForm((f) => ({ ...f, amountPaid: e.target.value }))} className="text-sm" /></Field>
            <Field label="Total (auto)">
              <div className="h-9 flex items-center px-3 text-sm rounded-md border border-border bg-muted/30 text-muted-foreground">
                {form.currency} {((parseFloat(form.qty) || 0) * (parseFloat(form.unitCost) || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            </Field>
            <Field label="Notes" full><Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="text-sm" rows={2} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}{editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-cinzel text-primary">Delete purchase?</AlertDialogTitle>
            <AlertDialogDescription>This removes the row from the Purchasing sheet. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-success" : tone === "neg" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold font-cinzel leading-tight ${color}`}>{value}</p>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
