"use client";

import { useState, memo, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, Copy, Check, Clock, AlertTriangle } from 'lucide-react';

function LayawayAgingBadge({ dateStr }: { dateStr?: string }) {
  if (!dateStr) return null;
  const d = parseDateRobust(dateStr);
  if (!d) return null;
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  const color = days > 30 ? 'bg-destructive/20 text-destructive border-destructive/30'
    : days > 14 ? 'bg-warning/20 text-warning border-warning/30'
    : 'bg-secondary text-muted-foreground border-border';
  const Icon = days > 14 ? AlertTriangle : Clock;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${color}`}>
      <Icon className="h-2.5 w-2.5" />
      {days === 0 ? 'Today' : `${days}d on layaway`}
    </span>
  );
}
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatabaseRowType } from '@/types';
import { calcTotalPaid, calcItemPriceAED, getQty, parseDateRobust } from '@/lib/calculations';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { formatDate } from '@/lib/formatters';
import StatusBadge from '@/components/StatusBadge';
import FinancialsForm from './FinancialsForm';
import type { AccountBatch } from '@/lib/accountsLedger';
import { toast } from 'sonner';
import { useCompactMode } from '@/lib/compactMode';
import { fulfilmentStage } from '@/lib/fulfilment';
import CancelReasonField from '@/components/CancelReasonField';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface Props {
  minerName: string;
  records: DatabaseRowType[];
  batch: AccountBatch;
  title: string;
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}

function AccountsClientCard({ minerName, records, batch, title, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [statusResetKeys, setStatusResetKeys] = useState<Record<number, number>>({});
  const statusChangingRef = useRef<Record<number, boolean>>({});
  // Cancelled / Returned asks for a reason first (the liver sees it).
  const [pendingCancel, setPendingCancel] = useState<{ record: DatabaseRowType; status: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const applyStatus = useCallback(async (record: DatabaseRowType, newStatus: string, extra: Partial<DatabaseRowType> = {}) => {
    if (statusChangingRef.current[record.id]) return;
    statusChangingRef.current[record.id] = true;
    setStatusResetKeys(prev => ({ ...prev, [record.id]: (prev[record.id] || 0) + 1 }));
    try {
      // W4 FIX: Write audit trail on status change (mirrors AdminItemRow.tsx behavior)
      const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const existingTrail = record.auditTrail || '';
      const auditEntry = `[Accounts: ${record.status} → ${newStatus} on ${timestamp}]`;
      const newTrail = existingTrail ? `${existingTrail} ${auditEntry}` : auditEntry;
      await onUpdate(record.id, { status: newStatus, auditTrail: newTrail, ...extra });
      toast.success(`Status: ${newStatus}`);
    } catch {
      toast.error('Failed to update status');
    } finally {
      statusChangingRef.current[record.id] = false;
    }
  }, [onUpdate]);

  const handleStatusChange = useCallback(async (record: DatabaseRowType, newStatus: string) => {
    if (fulfilmentStage(newStatus) === 'excluded') {
      setStatusResetKeys(prev => ({ ...prev, [record.id]: (prev[record.id] || 0) + 1 }));
      setCancelReason('');
      setPendingCancel({ record, status: newStatus });
      return;
    }
    await applyStatus(record, newStatus);
  }, [applyStatus]);

  const copyRecord = useCallback((record: DatabaseRowType) => {
    const text = [
      record.itemDescription,
      record.grams ? `${record.grams}g` : '',
      `Item price: AED ${calcItemPriceAED(record).toFixed(2)}`,
      `Payment recorded here: AED ${calcTotalPaid(record).toFixed(2)}`,
    ].filter(Boolean).join(' · ');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(record.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const { isCompact } = useCompactMode();
  // Group records by Date → Liver → Status
  const grouped = useMemo(() => {
    const byDate: Record<string, Record<string, Record<string, DatabaseRowType[]>>> = {};
    for (const r of records) {
      const date = r.dateOfLive || 'No Date';
      const liver = r.liverName || 'Unknown Liver';
      const status = r.status || 'No Status';
      if (!byDate[date]) byDate[date] = {};
      if (!byDate[date][liver]) byDate[date][liver] = {};
      if (!byDate[date][liver][status]) byDate[date][liver][status] = [];
      byDate[date][liver][status].push(r);
    }
    return byDate;
  }, [records]);

  return (
    <div className="mb-3 rounded-xl border border-border bg-card overflow-hidden">

      <button type="button" aria-expanded={expanded} className="w-full text-left px-4 py-3 flex items-center justify-between" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground mt-1">{records.length} items · {Array.from(new Set(records.map(r => r.status))).join(' / ')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
            <span>Charges: AED {batch.charges.toFixed(2)}</span>
            <span>{batch.pending ? 'Estimated shipping included' : 'Shipping included'}: AED {batch.shipping.toFixed(2)}</span>
            <span>Payments: AED {batch.paid.toFixed(2)}</span>
            {batch.creditUsed > 0 && <span className="text-success">Credit applied: AED {batch.creditUsed.toFixed(2)}</span>}
            {batch.creditAdded > 0 && <span className="text-success">Credit carried forward: AED {batch.creditAdded.toFixed(2)}</span>}
            <span className={batch.due > 0 ? 'text-destructive font-semibold' : 'text-success'}>{batch.due > 0 ? 'Remaining: AED ' + batch.due.toFixed(2) : 'Paid / covered'}</span>
          </div>
          {batch.uncertain && <p className="text-xs text-warning mt-2">Legacy shipment: original dispatch details are incomplete. Check item history if this batch needs separating.</p>}
        </div>
        <ChevronDown className={'h-4 w-4 text-muted-foreground shrink-0 ml-2 transition-transform ' + (expanded ? 'rotate-180' : '')} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border pt-3">
          {/* Grouped by Date → Liver → Status */}
          {Object.entries(grouped).sort(([a], [b]) => (parseDateRobust(a)?.getTime() || 0) - (parseDateRobust(b)?.getTime() || 0)).map(([date, livers]) => (
            <div key={date} className="mb-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                📅 {formatDate(date)}
              </div>
              {Object.entries(livers).map(([liver, statuses]) => (
                <div key={liver} className="mb-2 ml-2">
                  <div className="text-xs font-medium text-primary/80 mb-1 px-1">🧑 {liver}</div>
                  {Object.entries(statuses).map(([status, items]) => (
                    <div key={status} className="mb-2 ml-2">
                      <div className="text-xs text-muted-foreground mb-1 px-1 flex items-center gap-1">
                        <StatusBadge status={status} /> <span className="ml-1">({items.length})</span>
                      </div>
                      {items.map(record => (
                        <div key={record.id} className="mb-2 rounded-lg border border-border/50 bg-secondary/20 overflow-hidden group/item">
                          <button
                            className="w-full text-left p-3 flex items-start justify-between"
                            onClick={() => setExpandedItem(expandedItem === record.id ? null : record.id)}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate mb-1">{record.itemDescription}</p>
                              {!isCompact && (
                                <div className="text-xs text-muted-foreground">
                                  {record.category} · {(record.category || '').toLowerCase().includes('screw type') ? `${getQty(record)} PCS` : (record.grams ? `${record.grams}g` : 'PC')} · {record.modeOfPayment}
                                </div>
                              )}
                              {!isCompact && (record.modeOfPayment || '').toLowerCase() === 'layaway' && (
                                <div className="mt-1">
                                  <LayawayAgingBadge dateStr={record.dateOfLive} />
                                </div>
                              )}

                              <div className="text-xs mt-1 text-muted-foreground">
                                <p>Item price: AED {calcItemPriceAED(record).toFixed(2)}</p>
                                <p className="text-foreground">Item payment recorded here: AED {calcTotalPaid({ ...record, shipmentPaymentAED: 0 }).toFixed(2)}</p>
                                {!!record.shipmentPaymentAED && <p className="text-success">Share of shipment payments: AED {record.shipmentPaymentAED.toFixed(2)}</p>}
                                {!isCompact && <p>{record.page} · {record.liverName} · Live {formatDate(record.dateOfLive)}</p>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-2 mt-0.5 shrink-0">
                              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedItem === record.id ? 'rotate-180' : ''}`} />
                            </div>
                          </button>

                          {expandedItem === record.id && (

                            <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                              <Button type="button" size="sm" variant="ghost" className="mb-2" onClick={() => copyRecord(record)}>
                                {copiedId === record.id ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />} Copy item summary
                              </Button>
                              <p className="text-xs text-muted-foreground mb-3">A payment entered on this item covers the batch above. Do not enter the same money again on another item.</p>
                              {record.auditTrail && <details className="text-xs mb-3"><summary className="cursor-pointer text-primary">Item audit trail</summary><p className="whitespace-pre-wrap break-words mt-2 text-muted-foreground">{record.auditTrail}</p></details>}

                              <div className="mb-2">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Change Status</p>
                                <Select
                                  key={`acc-status-${record.id}-${statusResetKeys[record.id] || 0}`}
                                  onValueChange={v => handleStatusChange(record, v)}
                                >
                                  <SelectTrigger className="h-7 text-xs w-full bg-background border-border">
                                    <SelectValue placeholder="Set status..." />
                                  </SelectTrigger>
                                  <SelectContent className="bg-popover border-border">
                                    {getEffectiveStatuses('accounts').map(s => (
                                      <SelectItem
                                        key={s}
                                        value={s}
                                        className={`text-xs font-medium ${/cancel/i.test(s) ? 'text-destructive' : 'text-foreground'}`}
                                      >
                                        {s}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              {/* CR5 FIX: key includes record fields hash to force re-mount on external updates */}
                              <FinancialsForm key={`fin-${record.id}-${record.remittanceStatus}-${record.downpayment}-${record.amountReceived}`} record={record} onUpdate={onUpdate} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!pendingCancel} onOpenChange={open => { if (!open) setPendingCancel(null); }}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Set to {pendingCancel?.status}?</AlertDialogTitle>
            <AlertDialogDescription>{pendingCancel?.record.itemDescription || 'This item'} of {minerName}.</AlertDialogDescription>
          </AlertDialogHeader>
          <CancelReasonField value={cancelReason} onChange={setCancelReason} />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                const p = pendingCancel;
                setPendingCancel(null);
                if (p) void applyStatus(p.record, p.status, { cancelReason: cancelReason.trim() });
              }}
            >
              Set to {pendingCancel?.status}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default memo(AccountsClientCard);
