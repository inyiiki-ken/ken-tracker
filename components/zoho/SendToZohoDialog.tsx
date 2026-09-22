"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt, AlertTriangle, CheckCircle2, UserPlus, Link2 } from "lucide-react";
import { toast } from "sonner";
import { findZohoContacts, pushToZoho } from "@/lib/zoho/actions";
import type { ZohoContactMatch } from "@/lib/zoho/types";
import type { DatabaseRowType } from "@/types";
import { calcItemPriceAED, getQty } from "@/lib/calculations";

/**
 * Confirm-before-send flow for Zoho.
 *
 * Nothing reaches the customer's accounting system without the user seeing
 * exactly what will be created: which Zoho customer (existing or new) and the
 * precise line items. Sending is a real, irreversible business action.
 */
export default function SendToZohoDialog({
  minerName,
  records,
  onClose,
  onDone,
}: {
  minerName: string;
  records: DatabaseRowType[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const [matches, setMatches] = useState<ZohoContactMatch[] | null>(null);
  const [searching, setSearching] = useState(true);
  const [choice, setChoice] = useState<string | "new" | null>(null);
  const [sending, setSending] = useState(false);

  // Already linked to a Zoho contact from a previous send?
  const linkedId = useMemo(
    () => records.map((r) => String(r.zohoContactId ?? "").trim()).find(Boolean) ?? "",
    [records]
  );
  const alreadyInvoiced = useMemo(
    () => records.map((r) => String(r.zohoInvoice ?? "").trim()).find(Boolean) ?? "",
    [records]
  );

  const lineItems = useMemo(
    () =>
      records.map((r) => ({
        name: (r.itemDescription || "Item").slice(0, 100),
        description: [r.orderId, r.tog, r.grams ? `${r.grams}g` : ""].filter(Boolean).join(" · "),
        quantity: getQty(r) || 1,
        rate: Number(calcItemPriceAED(r).toFixed(2)),
      })),
    [records]
  );

  const total = useMemo(
    () => lineItems.reduce((s, li) => s + li.rate * li.quantity, 0),
    [lineItems]
  );

  useEffect(() => {
    if (linkedId) { setChoice(linkedId); setSearching(false); setMatches([]); return; }
    findZohoContacts({ name: minerName })
      .then((res) => {
        setMatches(res);
        setChoice(res.length > 0 ? res[0].contactId : "new");
      })
      .catch(() => { setMatches([]); setChoice("new"); })
      .finally(() => setSearching(false));
  }, [minerName, linkedId]);

  const send = async () => {
    if (!choice) return;
    setSending(true);
    try {
      const res = await pushToZoho({
        minerName,
        rowIds: records.map((r) => r.id),
        lineItems,
        contactId: choice === "new" ? undefined : choice,
        address: records.find((r) => r.clientAddress)?.clientAddress,
        phone: records.find((r) => r.clientNumber)?.clientNumber,
        date: records[0]?.dateOfLive,
      });
      if (res.success) {
        // A partial write-back means Zoho has the invoice but the tracker may
        // not show it — the user must know, or they'll try to send again.
        if (res.warning) {
          toast.warning(res.warning, { duration: 15000 });
        } else {
          toast.success(`Zoho invoice ${res.invoiceNumber} created.`);
        }
        onDone?.();
        onClose();
      } else {
        toast.error(res.error || "Could not send to Zoho.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send to Zoho.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary flex items-center gap-2">
            <Receipt className="h-5 w-5" /> Send to Zoho
          </DialogTitle>
        </DialogHeader>

        {alreadyInvoiced && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              These items already have Zoho invoice <b>{alreadyInvoiced}</b>. Sending again would
              create a duplicate in the accounts — this is blocked.
            </span>
          </div>
        )}

        {/* Which Zoho customer */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">Zoho customer</p>

          {searching ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking for “{minerName}” in Zoho…
            </div>
          ) : linkedId ? (
            <div className="rounded-md border border-success/40 bg-success/5 p-2.5 text-xs text-success flex items-center gap-2">
              <Link2 className="h-3.5 w-3.5" /> Already linked to a Zoho customer — will reuse it.
            </div>
          ) : (
            <div className="space-y-1.5">
              {(matches ?? []).map((m) => (
                <button
                  key={m.contactId}
                  onClick={() => setChoice(m.contactId)}
                  className={`w-full text-left rounded-md border p-2.5 transition-colors ${
                    choice === m.contactId ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${choice === m.contactId ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="text-xs font-medium text-foreground flex-1 truncate">{m.contactName}</span>
                    {typeof m.outstanding === "number" && m.outstanding > 0 && (
                      <span className="text-[10px] text-warning">owes {m.outstanding.toFixed(2)}</span>
                    )}
                  </div>
                  {(m.email || m.phone) && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate pl-5">
                      {[m.email, m.phone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </button>
              ))}

              <button
                onClick={() => setChoice("new")}
                className={`w-full text-left rounded-md border p-2.5 transition-colors ${
                  choice === "new" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-2">
                  <UserPlus className={`h-3.5 w-3.5 ${choice === "new" ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-xs font-medium text-foreground">
                    Create new customer “{minerName}”
                  </span>
                </div>
              </button>

              {matches?.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No match found in Zoho — a new customer will be created.</p>
              )}
            </div>
          )}
        </div>

        {/* Exactly what will be created */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">Invoice preview</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5">Item</th>
                  <th className="text-right px-2 py-1.5">Qty</th>
                  <th className="text-right px-2 py-1.5">Rate</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="px-2 py-1.5">
                      <span className="text-foreground">{li.name}</span>
                      {li.description && <span className="block text-muted-foreground text-[10px]">{li.description}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{li.quantity}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{li.rate.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Subtotal (before tax rules)</span>
            <span className="font-bold tabular-nums text-foreground">{total.toFixed(2)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Tax is applied by Zoho using the rate set in Settings. Zoho assigns the invoice number.
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={sending} className="flex-1">Cancel</Button>
          <Button onClick={send} disabled={sending || !choice || !!alreadyInvoiced} className="flex-1">
            {sending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending…</> : "Create in Zoho"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
