"use client";
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addShipmentPayment } from '@/lib/api';
import { businessDay } from '@/lib/calculations';
import { paymentFingerprint, type ShipmentPayment } from '@/lib/shipmentPayments';
import type { AccountBatch, CustomerAccount } from '@/lib/accountsLedger';

export default function AddShipmentPaymentDialog({ account, batch, onClose, onSaved }: {
  account: CustomerAccount; batch: AccountBatch; onClose: () => void; onSaved: (payment: ShipmentPayment) => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [scope, setScope] = useState<'shipment' | 'items'>('shipment');
  const [selected, setSelected] = useState(() => new Set(batch.records.map(r => r.id)));
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => businessDay(new Date().toISOString()));
  const [method, setMethod] = useState('Bank transfer');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const rows = scope === 'shipment' ? batch.records : batch.records.filter(r => selected.has(r.id));
  const valid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= 100000000 && !!date && rows.length > 0 && !!method.trim();
  async function save() {
    if (!valid || saving) return;
    setSaving(true); setSubmitted(true); setError('');
    try {
      const payment = await addShipmentPayment({ id, accountKey: account.key, batchKey: batch.key, scope,
        amountAED: Number(amount), date, method, reference,
        items: rows.map(r => ({ id: r.id, rowKey: r.rowKey || '', fingerprint: paymentFingerprint(r) })),
      });
      onSaved(payment);
    } catch (e) {
      setError((e instanceof Error ? e.message : 'Could not save the payment.') + ' Retry keeps the same payment ID to prevent counting it twice.');
    } finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" aria-describedby="shipment-payment-help">
      <DialogHeader><DialogTitle>Add payment — {account.name}</DialogTitle></DialogHeader>
      <p id="shipment-payment-help" className="text-xs text-muted-foreground">Record new money received in AED. Do not re-enter a payment already recorded as an item downpayment, or transferred store credit.</p>
      <fieldset disabled={saving || submitted} className="space-y-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <label><input type="radio" name="payment-scope" checked={scope === 'shipment'} onChange={() => setScope('shipment')} /> Whole shipment ({batch.records.length} items)</label>
          <label><input type="radio" name="payment-scope" checked={scope === 'items'} onChange={() => setScope('items')} /> Select items</label>
        </div>
        {scope === 'items' && <div className="max-h-48 overflow-y-auto rounded-lg border p-2 space-y-2">
          {batch.records.map(r => <label key={r.id} className="flex gap-2 text-xs"><input type="checkbox" checked={selected.has(r.id)} onChange={e => setSelected(prev => { const next = new Set(prev); e.target.checked ? next.add(r.id) : next.delete(r.id); return next; })} /><span>{r.itemDescription}</span></label>)}
        </div>}
        <p className="text-xs text-muted-foreground">{rows.length} items covered. The amount is shared evenly across these items for tracking if they later ship separately. Their downpayment fields stay unchanged.</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Amount received (AED)<Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label className="text-sm">Payment date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        </div>
        <label className="block text-sm">Payment method<select className="block w-full rounded-md border border-input bg-background p-2 text-sm" value={method} onChange={e => setMethod(e.target.value)}><option>Bank transfer</option><option>Cash</option><option>Credit card</option><option>Other</option></select></label>
        <label className="block text-sm">Reference / note (optional)<Input maxLength={500} value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank reference or payment note" /></label>
      </fieldset>
      <p className="text-xs text-muted-foreground">Current batch remaining: AED {batch.due.toFixed(2)}. Any excess becomes credit for the next batch.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>Close</Button><Button disabled={!valid || saving} onClick={save}>{saving ? 'Saving…' : submitted ? 'Retry same payment' : 'Save payment'}</Button></div>
    </DialogContent>
  </Dialog>;
}
