"use client";

import { useState, memo, useMemo, useEffect } from 'react';
import { useCompactMode } from '@/lib/compactMode';
import { ChevronDown, FileText, MapPin, Upload, History, Copy, Check, AlertTriangle, Loader2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { DatabaseRowType } from '@/types';
import { isOverdue, calcItemPriceAED, calcRemainingBalance, calcTotalPaid } from '@/lib/calculations';
import { formatDate, MOP_OPTIONS, REGION_OPTIONS, getLocationFromRegion } from '@/lib/formatters';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { getOptions } from '@/lib/optionsConfig';

const TOG_OPTIONS = ['18K', 'VCA', '21K', '24K', 'S-925'];
import { getPhpRate, setPhpRate, getRatesForDate, setSilverSellRate, setSilverBrandedSellRate, hasRatesSnapshotForDate } from '@/lib/ratesStore';
import StatusBadge from '@/components/StatusBadge';
import AdminItemRow from './AdminItemRow';
import PhpRateDialog from './PhpRateDialog';
import InvoiceModal from '@/components/InvoiceModal';
import GroupDownpaymentSection from './GroupDownpaymentSection';
import CustomerHistoryModal from '@/components/CustomerHistoryModal';

interface Props {
  minerName: string;
  records: DatabaseRowType[];
  allRecords: DatabaseRowType[];
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
  onBulkUpdate?: (updates: { rowId: number; fields: Partial<DatabaseRowType> }[]) => Promise<void>;
  userEmail?: string;
}

function isPinasRecord(r: DatabaseRowType) {
  return r.locationOfMiner === 'Pinas' || r.currency === 'PHP';
}

function AdminClientCard({ minerName, records, allRecords, onUpdate, onBulkUpdate, userEmail }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [phpRateDialogDate, setPhpRateDialogDate] = useState<string | null>(null);
  const [phpRates, setPhpRates] = useState<Record<string, number>>({});
  const [copiedName, setCopiedName] = useState(false);
  const [bulkApplying, setBulkApplying] = useState<string | null>(null);
  const first = records[0];
  const overdueRecords = records.filter(isOverdue);
  const hasOverdue = overdueRecords.length > 0;

  const uniqueDates = useMemo(() => {
    const dates = [...new Set(records.map(r => r.dateOfLive).filter(Boolean) as string[])].sort();
    return dates;
  }, [records]);

  const dateLabel = uniqueDates.length === 1
    ? formatDate(uniqueDates[0])
    : uniqueDates.length > 1
      ? `${formatDate(uniqueDates[0])} – ${formatDate(uniqueDates[uniqueDates.length - 1])}`
      : '—';

  // Quick balance summary for the collapsed header
  const quickSummary = useMemo(() => {
    const activeRecords = records.filter(r => {
      const s = (r.status || '').toLowerCase();
      return s !== 'cancelled' && s !== 'completed' && s !== 'delivered';
    });
    if (activeRecords.length === 0) return null;
    const totalValue = activeRecords.reduce((s, r) => s + calcItemPriceAED(r), 0);
    const totalPaid = activeRecords.reduce((s, r) => s + calcTotalPaid(r), 0);
    const totalOwed = activeRecords.reduce((s, r) => s + Math.max(0, calcRemainingBalance(r)), 0);
    return { totalValue: Math.round(totalValue), totalPaid: Math.round(totalPaid), totalOwed: Math.round(totalOwed) };
  }, [records]);

  const grouped = useMemo(() => {
    const map: Record<string, Record<string, Record<string, DatabaseRowType[]>>> = {};
    for (const r of records) {
      const date = r.dateOfLive || 'Unknown Date';
      const liver = r.liverName?.trim().toUpperCase() || 'UNKNOWN LIVER';
      const status = r.status || 'No Status';
      if (!map[date]) map[date] = {};
      if (!map[date][liver]) map[date][liver] = {};
      if (!map[date][liver][status]) map[date][liver][status] = [];
      map[date][liver][status].push(r);
    }
    return map;
  }, [records]);

  // Newest date first
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const toggleDate = (date: string) =>
    setCollapsedDates(prev => ({ ...prev, [date]: !prev[date] }));

  const handleGroupUpdate = async (fields: Partial<DatabaseRowType>) => {
    // Build every row's patch first, then send them in ONE request (previously
    // this was a sequential loop with a 300ms pause per row).
    const updates = records.map((r) => ({ rowId: r.id, fields }));
    if (updates.length === 0) return;
    if (onBulkUpdate) {
      await onBulkUpdate(updates);
    } else {
      for (const u of updates) await onUpdate(u.rowId, u.fields);
    }
  };

  // Bulk-set a field on EVERY item in this client's card (unconditional overwrite).
  const bulkApplyAll = async (fields: Partial<DatabaseRowType>, label: string) => {
    if (bulkApplying) return;
    setBulkApplying(label);
    try {
      if (onBulkUpdate) {
        // One batched request for every row — no per-row round-trips or delays.
        await onBulkUpdate(records.map((r) => ({ rowId: r.id, fields })));
      } else {
        for (const r of records) await onUpdate(r.id, fields);
      }
      toast.success(`Set ${label} on all ${records.length} items.`);
    } catch {
      toast.error(`Could not set ${label} on all items — please try again.`);
    } finally {
      setBulkApplying(null);
    }
  };

  const handleCopyName = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(minerName).then(() => {
      setCopiedName(true);
      setTimeout(() => setCopiedName(false), 1500);
    });
  };

  useEffect(() => {
    if (!expanded) return;
    const hasPinas = records.some(isPinasRecord);
    if (!hasPinas) return;

    const loaded: Record<string, number> = {};
    for (const date of uniqueDates) {
      const r = getPhpRate(date);
      if (r !== null) loaded[date] = r;
    }
    setPhpRates(loaded);

    const pinasRecords = records.filter(isPinasRecord);
    const pinasDates = [...new Set(pinasRecords.map(r => r.dateOfLive).filter(Boolean) as string[])];
    const needsRate = pinasDates.find(d => !hasRatesSnapshotForDate(d));
    if (needsRate) setPhpRateDialogDate(needsRate);
  }, [expanded, records, uniqueDates]);

  const handleRateConfirm = (phpRate: number, silverRate?: number, silverBrandedRate?: number) => {
    if (!phpRateDialogDate) return;
    setPhpRate(phpRateDialogDate, phpRate);
    if (silverRate) setSilverSellRate(phpRateDialogDate, silverRate);
    if (silverBrandedRate) setSilverBrandedSellRate(phpRateDialogDate, silverBrandedRate);
    setPhpRates(prev => ({ ...prev, [phpRateDialogDate!]: phpRate }));
    setPhpRateDialogDate(null);
  };

  const invoicePhpRate = useMemo(() => {
    const pinasRecords = records.filter(isPinasRecord);
    if (pinasRecords.length === 0) return undefined;
    const date = pinasRecords[0].dateOfLive;
    if (!date) return undefined;
    return phpRates[date] ?? getPhpRate(date) ?? undefined;
  }, [records, phpRates]);

  // Liver/Admin remarks shown on the collapsed card so staff see the note
  // (e.g. "TABBY CARD, DUBAI, RIGGA APPROVED") without expanding.
  const remarksSummary = useMemo(() => {
    const all = records.map(r => (r.liverAdminRemarks || '').trim()).filter(Boolean);
    if (all.length === 0) return null;
    const unique = [...new Set(all)];
    return unique.length === 1 ? unique[0] : `${unique[0]} +${unique.length - 1} more`;
  }, [records]);

  const hasInvoiceNumber = first?.pureWeight && String(first.pureWeight).trim() !== '';
  const { isCompact } = useCompactMode();

  return (
    <div className={`kt-lift mb-3 border overflow-hidden brand-left-bar rounded-md bg-card ${hasOverdue ? 'border-destructive/30' : 'border-border'}`}>
      <button
        className="w-full text-left px-4 py-3 flex items-center justify-between"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-cinzel text-[13px] truncate text-primary">{minerName}</span>
            {/* Copy name button */}
            <button
              onClick={handleCopyName}
              className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
              title="Copy client name"
            >
              {copiedName ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            </button>
            {hasOverdue && (
              <span className="shrink-0 flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 animate-pulse rounded-md text-destructive bg-destructive/10 border border-destructive/30">
                <AlertTriangle className="h-2.5 w-2.5" />
                {overdueRecords.length > 1 ? `${overdueRecords.length} OVERDUE` : 'NEEDS ATTENTION'}
              </span>
            )}
            {first?.customerId && (
              <button
                className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                title="View Lifetime History"
                onClick={e => { e.stopPropagation(); setShowHistory(true); }}
              >
                <History className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {!isCompact && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{first?.locationOfMiner || '—'}</span>}
            {!isCompact && first?.liverName && <span className="flex items-center gap-1"><Upload className="h-3 w-3" />{first.liverName}</span>}
            <span>{records.length} item{records.length !== 1 ? 's' : ''}</span>
          </div>
          {remarksSummary && (
            <p className="text-[11px] italic text-muted-foreground truncate mt-0.5" title={remarksSummary}>
              🗨 {remarksSummary}
            </p>
          )}
          <div className="flex items-center gap-3 mt-0.5">
            {!isCompact && <div className="text-[11px] text-primary/70 font-semibold">📅 {dateLabel}</div>}
            {/* Quick balance summary when collapsed */}
            {!expanded && quickSummary && quickSummary.totalOwed > 0 && (
              <div className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-warning bg-warning/10 border border-warning/20">
                AED {quickSummary.totalOwed.toLocaleString()} owed
              </div>
            )}
            {!expanded && quickSummary && quickSummary.totalOwed === 0 && quickSummary.totalPaid > 0 && (
              <div className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-success bg-success/10 border border-success/20">
                ✓ Fully Paid
              </div>
            )}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 ml-2 transition-transform text-muted-foreground ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-border pt-3">
          {/* Bulk apply to all items in this client's card */}
          <div className="mb-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Layers className="h-3 w-3" /> Apply to all {records.length} items
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <BulkSelect label="Status" options={getEffectiveStatuses('admin')} disabled={!!bulkApplying}
                onPick={(v) => bulkApplyAll({ status: v }, 'status')} />
              <BulkSelect label="Mode of Payment" options={getOptions('modeOfPayment')} disabled={!!bulkApplying}
                onPick={(v) => bulkApplyAll({ modeOfPayment: v }, 'mode of payment')} />
              <BulkSelect label="Region" options={getOptions('region')} disabled={!!bulkApplying}
                onPick={(v) => bulkApplyAll({ regions: v, locationOfMiner: getLocationFromRegion(v) }, 'region')} />
              <BulkSelect label="T.O.G" options={getOptions('tog')} disabled={!!bulkApplying}
                onPick={(v) => bulkApplyAll({ tog: v }, 'T.O.G')} />
            </div>
            {bulkApplying ? (
              <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Setting {bulkApplying} on all items… please wait.
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-1.5">Sets the whole list at once. To change just one item, use its own controls below.</p>
            )}
          </div>

          {records.some(isPinasRecord) && invoicePhpRate && (
            <div className="flex items-center justify-between mb-2 px-2 py-1.5 rounded-lg bg-warning/10 border border-warning/20">
              <span className="text-xs text-warning font-medium">
                💱 1 AED = {invoicePhpRate} PHP
              </span>
              <button
                className="text-[10px] text-warning/70 underline"
                onClick={() => setPhpRateDialogDate(records.filter(isPinasRecord)[0]?.dateOfLive || null)}
              >
                Change
              </button>
            </div>
          )}

          {/* Balance summary when expanded */}
          {quickSummary && (
            <div className="flex items-center gap-3 mb-3 px-2 py-2 rounded-lg bg-secondary/40 border border-border/60 text-[10px]">
              <div className="flex flex-col items-center">
                <span className="text-muted-foreground">Value</span>
                <span className="font-bold text-foreground">AED {quickSummary.totalValue.toLocaleString()}</span>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="flex flex-col items-center">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-bold text-success">AED {quickSummary.totalPaid.toLocaleString()}</span>
              </div>
              <div className="h-6 w-px bg-border" />
              <div className="flex flex-col items-center">
                <span className="text-muted-foreground">Owed</span>
                <span className={`font-bold ${quickSummary.totalOwed > 0 ? 'text-warning' : 'text-success'}`}>
                  {quickSummary.totalOwed > 0 ? `AED ${quickSummary.totalOwed.toLocaleString()}` : '✓ Clear'}
                </span>
              </div>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              if (!hasInvoiceNumber) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              setShowInvoice(true);
            }}
            disabled={!hasInvoiceNumber}
            className={`w-full mb-3 text-xs font-cinzel uppercase tracking-wider ${!hasInvoiceNumber ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
            style={hasInvoiceNumber ? {} : { opacity: 0.5 }}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            {hasInvoiceNumber ? `Generate Invoice (${records.length} items)` : 'Click "Gen" on an item below to unlock'}
          </Button>

          {sortedDates.map(date => {
            const isDateCollapsed = collapsedDates[date];
            const dateAllItems = Object.values(grouped[date]).flatMap(s => Object.values(s)).flat();
            const dateRecordCount = dateAllItems.length;
            const dateHasOverdue = dateAllItems.some(isOverdue);

            // Updates EVERY item in this date group — used for invoice # assignment
            const handleDateGroupUpdate = async (fields: Partial<DatabaseRowType>) => {
              for (const r of dateAllItems) {
                await onUpdate(r.id, fields);
                await new Promise(res => setTimeout(res, 150));
              }
            };

            return (
              <div key={date} className="mb-3 rounded-lg border border-border/40 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 bg-secondary/30 text-left"
                  onClick={() => toggleDate(date)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-primary uppercase tracking-widest">
                      📅 {formatDate(date)}
                    </span>
                    {dateHasOverdue && (
                      <span className="text-[9px] font-bold text-destructive bg-destructive/10 border border-destructive/20 px-1 py-0.5 rounded">
                        OVERDUE
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{dateRecordCount} item{dateRecordCount !== 1 ? 's' : ''}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isDateCollapsed ? '' : 'rotate-180'}`} />
                  </div>
                </button>

                {!isDateCollapsed && (
                  <div className="px-3 pt-2 pb-2">
                    {Object.entries(grouped[date]).map(([liver, statuses]) => (
                      <div key={liver} className="mb-2">
                        <div className="text-[10px] font-semibold text-primary/70 uppercase tracking-wide mb-1 px-0.5">
                          🧑 {liver}
                        </div>
                        {Object.entries(statuses).map(([status, items]) => {
                          const groupHasDP = items.some(r => {
                            const v = String(r.downpayment || '').trim();
                            if (!v) return false;
                            if (v === 'acknowledged') return true;
                            // Handle CHARGE:CURR:AMT:DESC format from GroupDownpaymentSection
                            if (v.toUpperCase().startsWith('CHARGE:')) {
                              const amt = parseFloat(v.split(':')[2] || '0');
                              return amt > 0;
                            }
                            return parseFloat(v) > 0;
                          });
                          return (
                            <div key={status} className="mb-2 ml-2">
                              <div className="flex items-center gap-1.5 mb-1">
                                <StatusBadge status={status} />
                                <span className="text-[10px] text-muted-foreground">({items.length})</span>
                                <div className="h-px flex-1 bg-border/30" />
                              </div>
                              {status === 'Waiting for Downpayment' && (
                                <GroupDownpaymentSection items={items} onUpdate={onUpdate} />
                              )}
                              {items.map(record => (
                                <AdminItemRow
                                  key={record.id}
                                  record={record}
                                  onUpdate={onUpdate}
                                  onGroupUpdate={handleGroupUpdate}
                                  onDateGroupUpdate={handleDateGroupUpdate}
                                  groupHasDP={groupHasDP}
                                  userEmail={userEmail}
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {phpRateDialogDate && (
        <PhpRateDialog
          date={phpRateDialogDate}
          onConfirm={handleRateConfirm}
          onSkip={() => setPhpRateDialogDate(null)}
        />
      )}

      {showInvoice && (
        <InvoiceModal
          records={allRecords.filter(r => r.minerName?.trim().toLowerCase() === minerName.trim().toLowerCase())}
          onClose={() => setShowInvoice(false)}
        />
      )}

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

/** A reset-on-pick dropdown for the bulk-apply bar — shows the field name as its
 * placeholder and fires onPick when a value is chosen. */
function BulkSelect({
  label,
  options,
  onPick,
  disabled,
}: {
  label: string;
  options: string[];
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  const [key, setKey] = useState(0);
  return (
    <Select
      key={key}
      disabled={disabled}
      onValueChange={(v) => { onPick(v); setKey((k) => k + 1); }}
    >
      <SelectTrigger className="h-8 text-xs bg-background border-border">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="bg-popover border-border max-h-72">
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs text-foreground">{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default memo(AdminClientCard, (prev, next) => {
  if (prev.minerName !== next.minerName) return false;
  if (prev.records.length !== next.records.length) return false;
  for (let i = 0; i < prev.records.length; i++) {
    if (prev.records[i] !== next.records[i]) return false;
  }
  if (prev.allRecords !== next.allRecords) return false;
  if (prev.onBulkUpdate !== next.onBulkUpdate) return false;
  return true;
});
