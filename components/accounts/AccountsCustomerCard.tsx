"use client";

import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import type { CustomerAccount } from '@/lib/accountsLedger';
import type { TabProps } from '@/types';
import AccountsClientCard from './AccountsClientCard';
import InvoiceModal from '@/components/InvoiceModal';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/formatters';
import { calcTotalPaid } from '@/lib/calculations';
import type { ShipmentPayment } from '@/lib/shipmentPayments';
import type { AccountBatch } from '@/lib/accountsLedger';
import AddShipmentPaymentDialog from './AddShipmentPaymentDialog';

export const accountMoney = (n: number) => `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsCustomerCard({ account, onUpdate, payments, paymentsReady, onPaymentSaved, onPaymentClose }: {
  account: CustomerAccount; onUpdate: TabProps['onUpdate']; payments: ShipmentPayment[]; paymentsReady: boolean;
  onPaymentSaved: (p: ShipmentPayment) => void; onPaymentClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const [paymentBatch, setPaymentBatch] = useState<AccountBatch | null>(null);
  const { name, records, batches } = account;
  const rowKeys = new Set(records.concat(account.excludedPayments).map(r => r.rowKey).filter(Boolean));
  const history = payments.filter(p => p.allocations.some(a => rowKeys.has(a.rowKey)));
  return <section className="rounded-xl border border-border bg-card overflow-hidden">
    <button type="button" aria-expanded={expanded} className="w-full p-4 text-left flex items-center gap-4 hover:bg-secondary/30" onClick={() => setExpanded(v => !v)}>
      <div className="flex-1 min-w-0">
        <h2 className="font-cinzel text-sm font-semibold text-primary">{name}</h2>
        <p className="text-xs text-muted-foreground mt-1">{records.length} items · {batches.filter(b => !b.pending).length} shipments{batches.some(b => b.pending) ? ' · Unshipped items' : ''}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          <span>Charges {accountMoney(account.charges)}</span><span>Payments {accountMoney(account.paid)}</span>
          <span className={account.due > 0 ? 'text-destructive font-semibold' : 'text-success font-semibold'}>{account.due > 0 ? `Outstanding ${accountMoney(account.due)}` : 'No outstanding balance'}</span>
          {account.credit > 0 && <span className="text-success font-semibold">Store credit {accountMoney(account.credit)}</span>}
          {account.verification && <span className="text-warning">Payment verification pending</span>}
          {account.excludedPayments.length > 0 && <span className="text-warning">Excluded payments need review</span>}
        </div>
      </div>
      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className="border-t border-border p-3 space-y-3">
      <p className="text-xs text-muted-foreground">Each shipment includes its own shipping fee. Only payments above its full charges become credit for later shipments, then unshipped items. Unshipped shipping is an estimate until the batch is dispatched. Amounts include payments awaiting verification.</p>
      {account.due > 0 && account.credit > 0 && <p className="text-xs text-warning">Credit is reserved for later shipments. Earlier unpaid shipments remain outstanding.</p>}
      <Button size="sm" variant="outline" onClick={() => setInvoice(true)} disabled={!records.length}><FileText className="h-3.5 w-3.5 mr-1" />Customer invoice</Button>
      <p className="text-xs text-muted-foreground">The invoice opens the existing Invoicing view, which may use different historical shipping rules. Use the shipment breakdown below to check each delivery fee and credit.</p>
      {batches.map((batch, i) => <div key={batch.key}>
        <AccountsClientCard minerName={name} records={batch.records} batch={batch}
          title={batch.pending ? 'Unshipped / next shipment' : batch.date ? `${batch.records.some(r => r.dispatchDate) ? 'Shipped' : 'Delivered'} ${formatDate(batch.date)} · Batch ${i + 1}` : 'Shipment date unknown'} onUpdate={onUpdate} />
        <Button className="mb-3" size="sm" disabled={!paymentsReady} onClick={() => setPaymentBatch(batch)}>Add payment · {batch.pending ? 'Next shipment' : `Batch ${i + 1}`}</Button>
      </div>)}
      <details className="rounded-lg border border-border p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Shipment payment history ({history.length})</summary>
        <p className="text-xs text-muted-foreground my-2">New shipment payments appear here. Older item downpayments remain in the item details and are included in the totals.</p>
        {history.map(p => <div key={p.id} className="border-t border-border py-2 text-xs space-y-1">
          <p className="font-semibold">{formatDate(p.date)} · {accountMoney(p.amountAED)} · {p.method}</p>
          <p>{p.scope === 'shipment' ? 'Whole shipment' : 'Selected items'} · {p.allocations.length} items · {p.reference || 'No reference'}</p>
          <p className="text-muted-foreground">Recorded {formatDate(p.createdAt)} by {p.createdBy}</p>
          <details><summary className="cursor-pointer">Covered items</summary>{p.allocations.map(a => <p key={a.rowKey}>{a.description} · {accountMoney(a.amountAED)}</p>)}</details>
        </div>)}
      </details>
      {account.excludedPayments.length > 0 && <div className="rounded-lg border border-warning/40 p-3 text-xs space-y-2">
        <p className="font-semibold text-warning">Payments on cancelled / returned items</p>
        <p>Not counted above. Check whether these payments were refunded or should become credit before changing them.</p>
        {account.excludedPayments.map(r => <p key={r.id}>{r.itemDescription} · {r.status} · {accountMoney(calcTotalPaid(r))}</p>)}
      </div>}
    </div>}
    {invoice && <InvoiceModal records={records} onClose={() => setInvoice(false)} />}
    {paymentBatch && <AddShipmentPaymentDialog account={account} batch={paymentBatch} onClose={() => { setPaymentBatch(null); onPaymentClose(); }} onSaved={p => { setPaymentBatch(null); onPaymentSaved(p); }} />}
  </section>;
}
