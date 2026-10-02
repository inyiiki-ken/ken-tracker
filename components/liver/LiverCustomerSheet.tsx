"use client";

import { useMemo } from 'react';
import { Phone, User } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import StatusBadge from '@/components/StatusBadge';
import type { DatabaseRowType } from '@/types';
import type { ClientMilestone } from '@/lib/milestones';
import { computeClientMilestones, getMilestoneBadge } from '@/lib/milestones';
import { customerKey, gramsLabel, gramsTotalLabel } from '@/lib/calculations';
import { formatDate } from '@/lib/formatters';
import { dayKey, fulfilmentStage } from '@/lib/fulfilment';
import { isFieldHidden } from '@/lib/appConfig';
import { aedLabel, collectForAED, customerMoney, reportedCashAED, sharedCustomer } from '@/lib/liverMoney';
import { isOpenReport, type DeliveryReport } from '@/lib/deliveryReports';
import { itemKey } from '@/lib/pulloutRequests';
import { groupByDay, newestFirst, statusOf } from '@/lib/liverSales';
import { NotesToggle, OutsourceTag, ShippedLine } from './LiverRowBits';

/** What a Waiting for Details item still needs (never the values themselves). */
function missingDetails(r: DatabaseRowType): string[] {
  const out: string[] = [];
  // A liver gets only "is there an address" from the server, never the address.
  const hasAddress = r.hasClientAddress ?? !!String(r.clientAddress ?? '').trim();
  if (!hasAddress && !isFieldHidden('clientAddress')) out.push('address');
  if (!String(r.clientNumber ?? '').trim() && !isFieldHidden('clientNumber')) out.push('number');
  if (!String(r.modeOfPayment ?? '').trim()) out.push('payment method');
  return out;
}

/**
 * Everything one customer bought from this liver, grouped by order date:
 * status, shipped date, notes, loyalty badge, contact (FB name and phone, never
 * the address) and money (paid / balance due / cash to collect).
 */
export default function LiverCustomerSheet({ customer, rows, clientMilestones, reports, onClose }: {
  /** customerKey of the customer. */
  customer: string;
  /** This liver's items (only hers). */
  rows: DatabaseRowType[];
  /** Every customer's milestones (staff); a liver-only user has none, see below. */
  clientMilestones?: Map<string, ClientMilestone>;
  /** Her delivery reports, for cash she reported but Accounts hasn't entered yet. */
  reports?: DeliveryReport[];
  onClose: () => void;
}) {
  const items = useMemo(() => newestFirst(rows.filter(r => customerKey(r) === customer)), [rows, customer]);
  const byDay = useMemo(() => groupByDay(items, r => dayKey(r.dateOfLive)), [items]);
  const first = items[0];
  const money = useMemo(() => customerMoney(items), [items]);
  const shared = sharedCustomer(items);
  const cashReported = useMemo(() => reportedCashAED(reports ?? [], items), [reports, items]);
  // Items she reported delivered / picked up (not answered yet): nothing left to collect.
  const reportedKeys = useMemo(() => new Set((reports ?? []).filter(isOpenReport).flatMap(q => q.itemKeys)), [reports]);
  const live = items.filter(r => fulfilmentStage(r.status) !== 'excluded');

  const fbName = !isFieldHidden('fbProfileName') ? String(items.find(r => r.fbProfileName?.trim())?.fbProfileName ?? '').trim() : '';
  const phone = !isFieldHidden('clientNumber') ? String(items.find(r => r.clientNumber?.trim())?.clientNumber ?? '').trim() : '';
  const customerId = items.find(r => r.customerId?.trim())?.customerId?.trim();
  // A liver gets only her own rows: her count is the customer's whole count
  // only when the customer never bought from another liver.
  const boughtElsewhere = shared || items.some(r => r.customerBoughtFromOtherLivers);
  const milestone = useMemo(() => {
    if (!customerId) return undefined;
    if (clientMilestones) return clientMilestones.get(customerId);
    return boughtElsewhere ? undefined : computeClientMilestones(items).get(customerId);
  }, [clientMilestones, customerId, boughtElsewhere, items]);
  const badge = milestone ? getMilestoneBadge(milestone.qualifyingCount) : null;

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary text-left">{first?.minerName || 'Customer'}</DialogTitle>
        </DialogHeader>
        {!first ? (
          <p className="text-sm text-muted-foreground">No items for this customer.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{live.length} item{live.length !== 1 ? 's' : ''} · {gramsTotalLabel(live)}</span>
              {badge && <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning font-semibold">{badge}</span>}
            </div>

            {(fbName || phone) && (
              <div className="space-y-1.5 rounded-lg border border-border bg-secondary/20 p-3 text-sm">
                {fbName && <p className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> {fbName}</p>}
                {phone && (
                  <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 text-primary underline-offset-2 hover:underline">
                    <Phone className="h-4 w-4" /> {phone}
                  </a>
                )}
              </div>
            )}

            {money.due > 0 && (
              <p className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                money.balance <= 0 ? 'border-success/40 bg-success/10 text-success'
                : cashReported > 0 ? 'border-border bg-secondary/20 text-foreground'
                : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
                {/* Shared customer: her items only (customerMoney). */}
                {money.balance > 0 ? `Balance due${shared ? ' on your items' : ''} ${aedLabel(money.balance)}` : shared ? 'Paid on your items' : 'Paid'}
                <span className="ml-2 text-xs font-normal text-muted-foreground">Paid {aedLabel(money.paid)} of {aedLabel(money.due)}</span>
                {money.balance > 0 && cashReported > 0 && (
                  <span className="block text-xs font-normal text-muted-foreground">Cash reported {aedLabel(cashReported)} · waiting for Accounts</span>
                )}
                {shared && <span className="block text-xs font-normal text-muted-foreground">Also buys from another liver: Accounts has the full balance.</span>}
              </p>
            )}

            {byDay.map(([day, dayRows]) => (
              <div key={day}>
                <div className="flex items-center gap-2 pt-1 pb-1.5">
                  <span className="text-xs font-semibold">{day === 'Unknown' ? 'No order date' : `Ordered ${formatDate(day)}`}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {dayRows.map(r => {
                    const missing = statusOf(r) === 'Waiting for Details' ? missingDetails(r) : [];
                    const collect = reportedKeys.has(itemKey(r)) ? 0 : collectForAED([r], items);
                    return (
                      <li key={r.id} className="space-y-1 p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={statusOf(r)} />
                          <OutsourceTag r={r} />
                          <span className="ml-auto text-xs">{gramsLabel(r)}</span>
                        </div>
                        <p className="text-sm">{[r.itemDescription, r.orderId].filter(Boolean).join(' · ') || '—'}</p>
                        <ShippedLine r={r} />
                        {collect > 0 && <p className="text-xs font-semibold text-attention">Collect {aedLabel(collect)}</p>}
                        {missing.length > 0 && <p className="text-xs text-warning">Missing: {missing.join(', ')}</p>}
                        {r.cancelReason && fulfilmentStage(r.status) === 'excluded' && <p className="text-xs text-destructive">Reason: {r.cancelReason}</p>}
                        <NotesToggle r={r} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
