"use client";

import { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Package, Weight, DollarSign, Copy, Check } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabProps, DatabaseRowType } from '@/types';
import { calcItemPriceAED, parseDateRobust } from '@/lib/calculations';
import { formatDate } from '@/lib/formatters';
import TabHeader from '@/components/TabHeader';
import { StatCard } from '@/components/ui/dash';
import StatusBadge from '@/components/StatusBadge';
import { startOfWeek, startOfMonth } from 'date-fns';

const ACTIVE_STATUSES = [
  'Delivered', 'Given to Shop',
  'Paid/DP but Item Hold', 'Payment for Verification',
  'Dispatched', 'For Pullout', 'Dispatch',
  'Pending', 'Waiting for Details', 'Waiting for Downpayment',
  'Cancelled',
];

function calcGrams(records: DatabaseRowType[]): number {
  return records.reduce((s, r) => {
    const cat = (r.category || '').toLowerCase();
    if (cat.includes('per pc') || cat.includes('screw type') || cat.includes('diamond')) return s;
    return s + (Number(r.grams) || 0);
  }, 0);
}

function isSilverItem(r: DatabaseRowType): boolean {
  return (r.category || '').toLowerCase().includes('silver');
}

type DateRange = 'all' | 'week' | 'month' | 'custom';
type MaterialFilter = 'all' | 'gold' | 'silver';

const RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
];

const MATERIAL_FILTERS: { key: MaterialFilter; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: '' },
  { key: 'gold', label: '🥇 Gold', color: 'text-attention' },
  { key: 'silver', label: '🥈 Silver', color: 'text-muted-foreground' },
];

const STATUS_ORDER = [
  'Pending', 'Waiting for Details', 'Waiting for Downpayment', 'Payment for Verification',
  'Paid/DP but Item Hold', 'For Pullout', 'Dispatch', 'Dispatched', 'Delivered', 'Given to Shop',
  'Cancelled',
];

const LIVER_STORAGE_KEY = 'myDeals_selectedLiver';

// ─── Status Section ───────────────────────────────────────────────────────────
function StatusSection({ status, items, copyRow, copiedId }: {
  status: string;
  items: DatabaseRowType[];
  copyRow: (r: DatabaseRowType) => void;
  copiedId: number | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const grams = calcGrams(items);
  const isCancelled = status === 'Cancelled';

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none hover:bg-secondary/20 transition-colors"
      >
        <StatusBadge status={status} />
        <span className="text-[10px] text-muted-foreground shrink-0">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        {grams > 0 && <span className="text-[10px] text-muted-foreground">{grams.toFixed(2)}g</span>}
        <div className="h-px flex-1 bg-border/40" />
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/20 border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Client</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Item</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.id} className={`border-b border-border/30 group ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.dateOfLive ? formatDate(r.dateOfLive) : '—'}</td>
                  <td className="px-3 py-2 font-medium max-w-[90px] truncate">{r.minerName || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate hidden sm:table-cell">{r.itemDescription || '—'}</td>
                  <td className="px-3 py-2 text-right">{r.grams ? `${r.grams}g` : '—'}</td>
                  <td className="px-2 py-2 text-right w-8">
                    <button
                      onClick={() => copyRow(r)}
                      title="Copy row"
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-secondary"
                    >
                      {copiedId === r.id
                        ? <Check className="h-3 w-3 text-success" />
                        : <Copy className="h-3 w-3 text-muted-foreground" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-secondary/20 border-t border-border">
                <td colSpan={3} className="px-3 py-1.5 text-[10px] text-muted-foreground">
                  {items.length} items{grams > 0 ? ` · ${grams.toFixed(2)}g` : ''}
                </td>
                <td className="px-3 py-1.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Delivered Date Breakdown ─────────────────────────────────────────────────
function DeliveredBreakdown({ breakdownByDate, filtered }: {
  breakdownByDate: [string, DatabaseRowType[]][];
  filtered: DatabaseRowType[];
}) {
  const [show, setShow] = useState(false);
  const delivered = filtered.filter(r => r.status === 'Delivered' || r.status === 'Given to Shop');
  if (breakdownByDate.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setShow(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none hover:bg-secondary/20 transition-colors"
      >
        <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Delivered Breakdown by Date</span>
        <div className="h-px flex-1 bg-border/40" />
        <span className="text-[10px] text-muted-foreground">{breakdownByDate.length} dates</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${show ? 'rotate-180' : ''}`} />
      </button>

      {show && (
        <div className="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/20 border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Items</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
              </tr>
            </thead>
            <tbody>
              {breakdownByDate.map(([date, rows], i) => (
                <tr key={date} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{date ? formatDate(date) : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{rows.length}</td>
                  <td className="px-3 py-2 text-right">{calcGrams(rows).toFixed(2)}g</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-secondary/30 border-t border-border font-semibold">
                <td className="px-3 py-1.5 text-[10px] text-muted-foreground">Totals</td>
                <td className="px-3 py-1.5 text-right text-[10px]">{delivered.length}</td>
                <td className="px-3 py-1.5 text-right text-[10px]">{calcGrams(delivered).toFixed(2)}g</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Gold/Silver Split Summary ────────────────────────────────────────────────
function MaterialSplit({ records }: { records: DatabaseRowType[] }) {
  const goldItems = records.filter(r => !isSilverItem(r));
  const silverItems = records.filter(r => isSilverItem(r));

  if (goldItems.length === 0 && silverItems.length === 0) return null;

  return (
    <div className="kt-stagger grid grid-cols-2 gap-3">
      <StatCard
        icon={<span className="text-xs">🥇</span>}
        accent="gold"
        label="Gold"
        value={<>{goldItems.length} <span className="text-sm font-normal">items</span></>}
        sub={`${calcGrams(goldItems).toFixed(2)}g`}
      />
      <StatCard
        icon={<span className="text-xs">🥈</span>}
        accent="silver"
        label="Silver"
        value={<>{silverItems.length} <span className="text-sm font-normal">items</span></>}
        sub={`${calcGrams(silverItems).toFixed(2)}g`}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LiverDashboard({ records, searchQuery, onSearchChange, lockedLiverName }: TabProps) {
  const [selectedLiver, setSelectedLiver] = useState<string>(() => {
    if (lockedLiverName) return lockedLiverName;
    try { return localStorage.getItem(LIVER_STORAGE_KEY) || ''; } catch { return ''; }
  });
  const [range, setRange] = useState<DateRange>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const copyRow = useCallback((r: DatabaseRowType) => {
    const text = [r.minerName, r.itemDescription, r.grams ? `${r.grams}g` : ''].filter(Boolean).join(' · ');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(r.id);
    setTimeout(() => setCopiedId(null), 1500);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LIVER_STORAGE_KEY, selectedLiver); } catch { /* ignore */ }
  }, [selectedLiver]);

  const liverNames = useMemo(() => {
    return Array.from(new Set(
      records.map(r => r.liverName?.toUpperCase().trim()).filter(Boolean) as string[]
    )).sort((a, b) => a.localeCompare(b));
  }, [records]);

  useEffect(() => {
    if (lockedLiverName) setSelectedLiver(lockedLiverName);
  }, [lockedLiverName]);

  useEffect(() => {
    if (!lockedLiverName && selectedLiver && liverNames.length > 0 && !liverNames.includes(selectedLiver)) {
      setSelectedLiver('');
    }
  }, [liverNames, selectedLiver, lockedLiverName]);

  const byLiver = useMemo(() => {
    if (!selectedLiver) return [];
    return records.filter(r =>
      r.liverName?.toUpperCase().trim() === selectedLiver &&
      ACTIVE_STATUSES.includes(r.status || '')
    );
  }, [records, selectedLiver]);

  const filtered = useMemo(() => {
    let base = byLiver;

    // Date range filter
    if (range !== 'all') {
      const now = new Date();
      let from: Date;
      let to: Date | undefined;
      if (range === 'week') from = startOfWeek(now, { weekStartsOn: 1 });
      else if (range === 'month') from = startOfMonth(now);
      else {
        from = customStart ? new Date(customStart) : new Date(0);
        to = customEnd ? new Date(customEnd) : undefined;
      }
      base = base.filter(r => {
        if (!r.dateOfLive) return false;
        const d = parseDateRobust(r.dateOfLive);
        if (!d) return false;
        if (d < from) return false;
        if (to) {
          const endOfDay = new Date(to);
          endOfDay.setHours(23, 59, 59, 999);
          if (d > endOfDay) return false;
        }
        return true;
      });
    }

    // Material filter
    if (materialFilter === 'gold') base = base.filter(r => !isSilverItem(r));
    else if (materialFilter === 'silver') base = base.filter(r => isSilverItem(r));

    return base;
  }, [byLiver, range, customStart, customEnd, materialFilter]);

  const totalItems = filtered.length;
  const totalGrams = calcGrams(filtered);
  const deliveredCount = filtered.filter(r => r.status === 'Delivered' || r.status === 'Given to Shop').length;

  const byStatus = useMemo(() => {
    const map = new Map<string, DatabaseRowType[]>();
    for (const r of filtered) {
      const s = r.status || 'Unknown';
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(r);
    }
    return new Map([...map.entries()].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a[0]);
      const bi = STATUS_ORDER.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }));
  }, [filtered]);

  const breakdownByDate = useMemo(() => {
    const deliveredRecords = filtered.filter(r => r.status === 'Delivered' || r.status === 'Given to Shop');
    const map = new Map<string, DatabaseRowType[]>();
    for (const r of deliveredRecords) {
      const key = r.dateOfLive || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader title="My Sales" subtitle="Personal sales summary" searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <div className="px-4 pt-4 space-y-4">

        {/* Liver selector */}
        {lockedLiverName ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-muted-foreground">Viewing as:</span>
            <span className="text-sm font-cinzel font-bold text-primary">{lockedLiverName}</span>
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Select your name</p>
            <Select value={selectedLiver} onValueChange={setSelectedLiver}>
              <SelectTrigger className="h-9 text-sm bg-background border-border w-full max-w-xs">
                <SelectValue placeholder="Select liver name..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {liverNames.map(name => (
                  <SelectItem key={name} value={name} className="text-sm text-foreground font-medium">{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedLiver && (
          <>
            {/* Date Range Filters */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Date range</p>
              <div className="flex gap-1.5 flex-wrap">
                {RANGES.map(r => (
                  <Button
                    key={r.key}
                    size="sm"
                    variant={range === r.key ? 'default' : 'outline'}
                    className={`text-xs h-7 ${range === r.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                    onClick={() => setRange(r.key)}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
              {range === 'custom' && (
                <div className="flex gap-2 mt-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted-foreground">Start Date</label>
                    <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 text-xs w-36 bg-background border-border" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-muted-foreground">End Date</label>
                    <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 text-xs w-36 bg-background border-border" />
                  </div>
                </div>
              )}
            </div>

            {/* Material Filter */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Material</p>
              <div className="flex gap-1.5">
                {MATERIAL_FILTERS.map(m => (
                  <Button
                    key={m.key}
                    size="sm"
                    variant={materialFilter === m.key ? 'default' : 'outline'}
                    className={`text-xs h-7 ${materialFilter === m.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                    onClick={() => setMaterialFilter(m.key)}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Gold / Silver Split (shown when All) */}
            {materialFilter === 'all' && <MaterialSplit records={filtered} />}

            {/* KPI Grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Package className="h-3.5 w-3.5" />}
                accent="primary"
                label="Total Items"
                value={totalItems}
                sub={`${deliveredCount} delivered`}
              />
              <StatCard
                icon={<Weight className="h-3.5 w-3.5" />}
                accent="neutral"
                label="Total Grams"
                value={`${totalGrams.toFixed(2)}g`}
                sub="Excl. PC / Screw / Diamond"
              />
            </div>

            {/* Status Summary Chips */}
            {byStatus.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {Array.from(byStatus.entries()).map(([status, items]) => (
                  <span key={status} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-secondary border border-border text-muted-foreground">
                    {status} <span className="text-foreground font-bold">{items.length}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Delivered Breakdown */}
            <DeliveredBreakdown breakdownByDate={breakdownByDate} filtered={filtered} />

            {/* Status Sections */}
            {filtered.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <p className="text-sm text-muted-foreground">No active items found for this period.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {Array.from(byStatus.entries()).map(([status, items]) => (
                  <StatusSection
                    key={status}
                    status={status}
                    items={items}
                    copyRow={copyRow}
                    copiedId={copiedId}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!selectedLiver && (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <DollarSign className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Select your name above to view your sales dashboard.</p>
          </div>
        )}
      </div>
    </div>
  );
}
