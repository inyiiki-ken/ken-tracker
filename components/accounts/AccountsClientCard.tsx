"use client";

import { useState, memo, useMemo, useCallback, useRef } from 'react';
import { ChevronDown, FileText, History, Pencil, Copy, Check, Clock, AlertTriangle } from 'lucide-react';

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
import { calcRemainingBalance, calcShippingFee, calcCCFee, calcItemPrice, calcDueDate, getQty, parseDateRobust } from '@/lib/calculations';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { formatDateObj, formatDate } from '@/lib/formatters';
import StatusBadge from '@/components/StatusBadge';
import InvoiceModal from '@/components/InvoiceModal';
import FinancialsForm from './FinancialsForm';
import CustomerHistoryModal from '@/components/CustomerHistoryModal';
import { toast } from 'sonner';
import { useCompactMode } from '@/lib/compactMode';

interface Props {
  minerName: string;
  records: DatabaseRowType[];
  allRecords: DatabaseRowType[];
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}

function AccountsClientCard({ minerName, records, allRecords, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [statusResetKeys, setStatusResetKeys] = useState<Record<number, number>>({});
  const statusChangingRef = useRef<Record<number, boolean>>({});

  const handleStatusChange = useCallback(async (record: DatabaseRowType, newStatus: string) => {
    if (statusChangingRef.current[record.id]) return;
    statusChangingRef.current[record.id] = true;
    setStatusResetKeys(prev => ({ ...prev, [record.id]: (prev[record.id] || 0) + 1 }));
    try {
      // W4 FIX: Write audit trail on status change (mirrors AdminItemRow.tsx behavior)
      const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const existingTrail = record.auditTrail || '';
      const auditEntry = `[Accounts: ${record.status} → ${newStatus} on ${timestamp}]`;
      const newTrail = existingTrail ? `${existingTrail} ${auditEntry}` : auditEntry;
      await onUpdate(record.id, { status: newStatus, auditTrail: newTrail });
      toast.success(`Status: ${newStatus}`);
    } catch {
      toast.error('Failed to update status');
    } finally {
      statusChangingRef.current[record.id] = false;
    }
  }, [onUpdate]);

  const copyRecord = useCallback((record: DatabaseRowType) => {
    const bal = calcRemainingBalance(record);
    const text = [
      record.itemDescription,
      record.grams ? `${record.grams}g` : '',
      `AED ${calcItemPrice(record).toFixed(2)}`,
      bal > 0 ? `Bal: AED ${bal.toFixed(2)}` : 'Paid',
    ].filter(Boolean).join(' · ');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(record.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const first = records[0];
  const dueDate = formatDateObj(calcDueDate(first?.dateOfLive));
  const { isCompact } = useCompactMode();
  const totalRemaining = records.reduce((sum, r) => sum + Math.max(0, calcRemainingBalance(r)), 0);

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
      <button className="w-full text-left px-4 py-3 flex items-center justify-between" onClick={() => setExpanded(e => !e)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-cinzel text-[13px] text-primary">{minerName}</span>
            {first?.customerId && (
              <button
                className="text-muted-foreground hover:text-primary transition-colors"
                title="View Lifetime History"
                onClick={e => { e.stopPropagation(); setShowHistory(true); }}
              >
                <History className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
            <span>{records.length} item{records.length !== 1 ? 's' : ''}</span>
            {!isCompact && <span>Due: {dueDate}</span>}
          </div>
          {totalRemaining > 0 && (
            <span className="text-xs font-medium text-destructive">Balance: AED {totalRemaining.toFixed(2)}</span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 ml-2 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border pt-3">
          {/* Generate Invoice at the TOP */}
          <Button
            variant="outline"
            size="sm"
            className="w-full mb-3 border-primary/40 text-primary text-xs"
            onClick={() => setShowInvoice(true)}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" /> Generate Invoice
          </Button>

          {/* Grouped by Date → Liver → Status */}
          {Object.entries(grouped).sort().map(([date, livers]) => (
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
                              {!isCompact && (
                                <div className="flex gap-3 text-xs mt-1">
                                  <span className="text-muted-foreground">Price: <span className="text-foreground">{record.currency || 'AED'} {calcItemPrice(record).toFixed(2)}</span></span>
                                  <span className="text-muted-foreground">SF: <span className="text-foreground">AED {calcShippingFee(record).toFixed(2)}</span></span>
                                  {calcCCFee(record) > 0 && <span className="text-muted-foreground">CC: <span className="text-foreground">AED {calcCCFee(record).toFixed(2)}</span></span>}
                                </div>
                              )}
                              <div className="text-xs mt-0.5">
                                <span className={`font-medium ${calcRemainingBalance(record) > 0 ? 'text-destructive' : 'text-success'}`}>
                                  Balance: AED {calcRemainingBalance(record).toFixed(2)}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-2 mt-0.5 shrink-0">
                              {/* Quick actions — visible on hover */}
                              <button
                                title="Copy item summary"
                                onClick={e => { e.stopPropagation(); copyRecord(record); }}
                                className="opacity-0 group-hover/item:opacity-100 transition-opacity p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                              >
                                {copiedId === record.id
                                  ? <Check className="h-3 w-3 text-success" />
                                  : <Copy className="h-3 w-3" />}
                              </button>
                              <button
                                title="Edit financials"
                                onClick={e => { e.stopPropagation(); setExpandedItem(expandedItem === record.id ? null : record.id); }}
                                className="opacity-0 group-hover/item:opacity-100 transition-opacity p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedItem === record.id ? 'rotate-180' : ''}`} />
                            </div>
                          </button>

                          {expandedItem === record.id && (
                            <div className="px-3 pb-3 animate-in fade-in slide-in-from-top-2 duration-200">
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
                                    {getEffectiveStatuses('accounts', record.status).map(s => (
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

      {showInvoice && <InvoiceModal records={records} onClose={() => setShowInvoice(false)} />}
      {showHistory && first?.customerId && (
        <CustomerHistoryModal
          customerId={first.customerId}
          minerName={minerName}
          allRecords={allRecords}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

export default memo(AccountsClientCard, (prev, next) => {
  if (prev.minerName !== next.minerName) return false;
  if (prev.records.length !== next.records.length) return false;
  for (let i = 0; i < prev.records.length; i++) {
    if (prev.records[i] !== next.records[i]) return false;
  }
  if (prev.allRecords !== next.allRecords) return false;
  return true;
});
