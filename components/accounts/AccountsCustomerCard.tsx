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

export const accountMoney = (n: number) => `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountsCustomerCard({ account, onUpdate }: { account: CustomerAccount; onUpdate: TabProps['onUpdate'] }) {
  const [expanded, setExpanded] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const { name, records, batches } = account;
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
      <p className="text-xs text-muted-foreground">Payments cover their shipment. Excess carries forward to later shipments, then unshipped items; unused credit remains available. Amounts reflect recorded payments, including any awaiting verification.</p>
      {account.due > 0 && account.credit > 0 && <p className="text-xs text-warning">Credit is reserved for later shipments. Earlier unpaid shipments remain outstanding.</p>}
      <Button size="sm" variant="outline" onClick={() => setInvoice(true)} disabled={!records.length}><FileText className="h-3.5 w-3.5 mr-1" />Customer invoice</Button>
      <p className="text-xs text-muted-foreground">The customer invoice uses the existing combined account total and invoice rounding. Shipment balances below preserve payments to the cent.</p>
      {batches.map((batch, i) => <AccountsClientCard key={batch.key} minerName={name} records={batch.records} batch={batch}
        title={batch.pending ? 'Unshipped / next shipment' : batch.date ? `${batch.records.some(r => r.dispatchDate) ? 'Shipped' : 'Delivered'} ${formatDate(batch.date)} · Batch ${i + 1}` : 'Shipment date unknown'} onUpdate={onUpdate} />)}
      {account.excludedPayments.length > 0 && <div className="rounded-lg border border-warning/40 p-3 text-xs space-y-2">
        <p className="font-semibold text-warning">Payments on cancelled / returned items</p>
        <p>Not counted above. Check whether these payments were refunded or should become credit before changing them.</p>
        {account.excludedPayments.map(r => <p key={r.id}>{r.itemDescription} · {r.status} · {accountMoney(calcTotalPaid(r))}</p>)}
      </div>}
    </div>}
    {invoice && <InvoiceModal records={records} onClose={() => setInvoice(false)} />}
  </section>;
}
