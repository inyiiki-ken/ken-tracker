"use client";

import { useMemo, useState } from 'react';
import { Calendar, ChevronDown, Printer, History, TrendingUp, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { TabProps, DatabaseRowType } from '@/types';
import {
  calcProfitAED,
  calcRemainingBalance,
  parseDateRobust,
  calcItemPriceAED,
  calcItemCostAED,
} from '@/lib/calculations';
import { formatDate, applySearch } from '@/lib/formatters';
import { recordsToCsv, downloadCsv, reportFilename } from '@/lib/reporting';
import TabHeader from '@/components/TabHeader';
import { StatCard } from '@/components/ui/dash';
import KpiCard from './KpiCard';
import StatusBadge from '@/components/StatusBadge';
import { startOfWeek, startOfMonth, subMonths } from 'date-fns';
import CustomerHistoryModal from '@/components/CustomerHistoryModal';

type DateRange = 'all' | 'week' | 'month' | '3months' | 'custom';
type Metal = 'Gold' | 'Silver' | 'Other';

function getMetal(record: DatabaseRowType): Metal {
  const cat = (record.category || '').toLowerCase();
  const src = (record.source || '').toLowerCase();
  const item = (record.itemDescription || '').toLowerCase();
  if (cat.includes('silver') || src.includes('silver') || item.includes('silver')) return 'Silver';
  if (cat.includes('gold') || src.includes('gold') || item.includes('gold')) return 'Gold';
  return 'Other';
}

const METAL_ORDER: Metal[] = ['Gold', 'Silver', 'Other'];
const METAL_COLORS: Record<Metal, string> = {
  Gold: 'text-primary',
  Silver: 'text-muted-foreground',
  Other: 'text-foreground',
};
const METAL_BG: Record<Metal, string> = {
  Gold: 'bg-primary/10 border-primary/30',
  Silver: 'bg-secondary/30 border-border',
  Other: 'bg-muted/20 border-border/50',
};

const STATUS_SORT: Record<string, number> = {
  'Delivered': 1,
  'Given to Shop': 2,
  'Dispatched': 3,
  'Payment for Verification': 4,
  'Paid/DP but Item Hold': 5,
  'For Pullout': 6,
  'Dispatch': 7,

  'Pending': 9,
  'Waiting for Details': 10,
  'Waiting for Downpayment': 11,
  'Returned Item': 12,
  'Cancelled': 13,
};

const DEAD_STATUSES = new Set(['Cancelled', 'Returned Item']);

const RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: '3months', label: '3 Months' },
  { key: 'custom', label: 'Custom' },
];

/** For Delivered/Given to Shop items, attribute the sale to the delivery date (not live date). */
function getSaleDate(r: DatabaseRowType): string | undefined {
  if ((r.status === 'Delivered' || r.status === 'Given to Shop') && r.deliveredDate) {
    return r.deliveredDate;
  }
  return r.dateOfLive;
}

function calcGrams(record: DatabaseRowType): number {
  const cat = (record.category || '').toLowerCase();
  if (cat.includes('per pc') || cat.includes('screw type') || cat.includes('diamond')) return 0;
  return Number(record.grams) || 0;
}

export default function BossingDashboard({ records, searchQuery, onSearchChange }: TabProps) {
  const [range, setRange] = useState<DateRange>('all');
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedStatuses, setExpandedStatuses] = useState<Record<string, boolean>>({});
  const [collapsedDates, setCollapsedDates] = useState<Record<string, boolean>>({});
  const [liverFilter, setLiverFilter] = useState('all');
  const [statusLiverFilters, setStatusLiverFilters] = useState<Record<string, string>>({});
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [selectedPrintStatuses, setSelectedPrintStatuses] = useState<Set<string>>(new Set());
  const [printMetalFilter, setPrintMetalFilter] = useState<'both' | 'gold' | 'silver'>('both');
  const [historyCustomer, setHistoryCustomer] = useState<{ id: string, name: string } | null>(null);

  const liverNames = useMemo(() => {
    const names = Array.from(new Set(records.map(r => r.liverName?.trim().toUpperCase()).filter(Boolean))) as string[];
    return names.sort();
  }, [records]);

  const dateFiltered = useMemo(() => {
    if (range === 'all') return records;
    const now = new Date();
    let from: Date;
    if (range === 'week') from = startOfWeek(now, { weekStartsOn: 1 });
    else if (range === 'month') from = startOfMonth(now);
    else if (range === '3months') from = subMonths(now, 3);
    else from = customFrom || new Date(0);
    const to = range === 'custom' ? customTo : undefined;
    return records.filter(r => {
      const saleDate = getSaleDate(r);
      if (!saleDate) return false;
      const d = parseDateRobust(saleDate);
      if (!d) return false;
      const t = d.getTime();
      if (t < from.getTime()) return false;
      if (to) {
        const end = new Date(to); end.setHours(23, 59, 59, 999);
        if (t > end.getTime()) return false;
      }
      return true;
    });
  }, [records, range, customFrom, customTo]);

  const filtered = useMemo(() => {
    let base = applySearch(dateFiltered, searchQuery);
    if (liverFilter !== 'all') {
      base = base.filter(r => r.liverName?.trim().toUpperCase() === liverFilter);
    }
    return base;
  }, [dateFiltered, searchQuery, liverFilter]);

  const kpis = useMemo(() => {
    const activeRecords = filtered.filter(r => !DEAD_STATUSES.has(r.status || ''));
    const deliveredRecords = filtered.filter(r => r.status === 'Delivered' || r.status === 'Given to Shop');

    const totalProfit = activeRecords.reduce((sum, r) => sum + calcProfitAED(r), 0);
    const confirmedProfit = deliveredRecords.reduce((sum, r) => sum + calcProfitAED(r), 0);
    const totalSold = deliveredRecords.length;
    const outstanding = activeRecords.reduce((sum, r) => sum + Math.max(0, calcRemainingBalance(r)), 0);

    const goldGrams = activeRecords.filter(r => getMetal(r) === 'Gold').reduce((s, r) => s + calcGrams(r), 0);
    const silverGrams = activeRecords.filter(r => getMetal(r) === 'Silver').reduce((s, r) => s + calcGrams(r), 0);
    const totalGrams = activeRecords.reduce((s, r) => s + calcGrams(r), 0);

    const goldProfit = activeRecords.filter(r => getMetal(r) === 'Gold').reduce((s, r) => s + calcProfitAED(r), 0);
    const silverProfit = activeRecords.filter(r => getMetal(r) === 'Silver').reduce((s, r) => s + calcProfitAED(r), 0);

    return { totalProfit, confirmedProfit, totalSold, outstanding, activeCount: activeRecords.length, totalGrams, goldGrams, silverGrams, goldProfit, silverProfit };
  }, [filtered]);

  const statusGroups = useMemo(() => {
    const grouped = new Map<string, DatabaseRowType[]>();
    for (const r of filtered) {
      const status = r.status || 'Unknown';
      if (!grouped.has(status)) grouped.set(status, []);
      grouped.get(status)!.push(r);
    }
    return grouped;
  }, [filtered]);

  const sortedStatusEntries = useMemo(() =>
    [...statusGroups.entries()].sort((a, b) => {
      const ao = STATUS_SORT[a[0]] ?? 99;
      const bo = STATUS_SORT[b[0]] ?? 99;
      return ao - bo;
    }),
    [statusGroups]
  );

  const toggleStatus = (status: string) =>
    setExpandedStatuses(prev => ({ ...prev, [status]: !prev[status] }));

  const toggleDate = (key: string) =>
    setCollapsedDates(prev => ({ ...prev, [key]: !prev[key] }));

  const openPrintDialog = () => {
    setSelectedPrintStatuses(new Set(statusGroups.keys()));
    setPrintMetalFilter('both');
    setShowPrintDialog(true);
  };

  const togglePrintStatus = (status: string) => {
    setSelectedPrintStatuses(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const handleExportCsv = () => {
    if (filtered.length === 0) {
      toast.error('Nothing to export for this filter.');
      return;
    }
    downloadCsv(recordsToCsv(filtered), reportFilename());
    toast.success(`Exported ${filtered.length} record(s) to CSV.`);
  };

  const handlePrintReport = () => {
    setShowPrintDialog(false);
    const win = window.open('', '_blank');
    if (!win) return;
    const dateRangeLabel = RANGES.find(r => r.key === range)?.label || 'Custom';
    const metalLabel = printMetalFilter === 'gold' ? 'Gold Only' : printMetalFilter === 'silver' ? 'Silver Only' : 'Gold & Silver';

    let html = `<html><head><title>Executive Report</title>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #111; background: #fff; margin: 0; padding: 20px; font-size: 11px; }
        .font-cinzel { font-family: 'Cinzel', serif; font-weight: 700; }
        h1 { margin: 0 0 4px; font-size: 22px; }
        .summary { margin-bottom: 20px; padding: 12px 16px; background: #f9f9f9; border-radius: 6px; border: 1px solid #ddd; display: flex; flex-wrap: wrap; gap: 12px 32px; }
        .summary-item { font-size: 12px; }
        .summary-item span { font-weight: bold; }
        .profit-pos { color: #16a34a; }
        .profit-neg { color: #dc2626; }
        .gold { color: #C9A84C; }
        .silver { color: #888; }
        .meta { font-size: 10px; color: #888; margin-bottom: 20px; }
        .status-section { margin-bottom: 28px; break-inside: avoid; }
        .status-header { font-size: 15px; color: #C9A84C; border-bottom: 2px solid #C9A84C; padding-bottom: 4px; margin: 0 0 10px; }
        .status-totals { font-size: 11px; color: #555; margin-bottom: 10px; }
        .metal-header { font-size: 13px; font-weight: bold; padding: 4px 8px; border-radius: 4px; margin: 12px 0 6px; }
        .metal-gold { background: #FDF6E3; border-left: 3px solid #C9A84C; color: #7a6020; }
        .metal-silver { background: #F5F5F5; border-left: 3px solid #888; color: #444; }
        .brand-block { margin-bottom: 16px; }
        .brand-header { font-size: 12px; font-weight: bold; background: #222; color: #fff; padding: 5px 10px; border-radius: 4px; margin-bottom: 6px; }
        .client-header { background: #444; color: #fff; padding: 5px 10px; font-size: 11px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }
        .client-meta { font-size: 9px; font-weight: normal; color: #ccc; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 0; page-break-inside: auto; }
        thead tr { background: #444; color: #fff; }
        th { padding: 6px 8px; text-align: left; font-size: 10px; font-weight: bold; white-space: nowrap; }
        td { padding: 5px 8px; vertical-align: top; font-size: 10px; }
        tbody tr:nth-child(even) { background: #f5f5f5; }
        tbody tr:nth-child(odd) { background: #fff; }
        tr.subtotal-row { background: #e8e8e8 !important; border-top: 2px solid #111; font-weight: bold; }
        .r { text-align: right; }
      </style></head><body>
      <h1 class="font-cinzel">EXECUTIVE SUMMARY REPORT</h1>
      <p class="meta">Date Range: ${dateRangeLabel} &nbsp;|&nbsp; Metal: ${metalLabel} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p>
      <div class="summary">
        <div class="summary-item">Confirmed Profit (Delivered): <span class="profit-pos">AED ${kpis.confirmedProfit.toFixed(2)}</span></div>
        <div class="summary-item">Total Expected Profit: <span class="profit-pos">AED ${kpis.totalProfit.toFixed(2)}</span></div>
        <div class="summary-item">Items Delivered: <span>${kpis.totalSold}</span></div>
        <div class="summary-item">Outstanding: <span>AED ${kpis.outstanding.toFixed(2)}</span></div>
        <div class="summary-item">Gold Grams: <span class="gold">${kpis.goldGrams.toFixed(2)}g</span></div>
        <div class="summary-item">Silver Grams: <span class="silver">${kpis.silverGrams.toFixed(2)}g</span></div>
      </div>
      `;

    [...statusGroups.entries()]
      .filter(([status]) => selectedPrintStatuses.has(status))
      .sort((a, b) => (STATUS_SORT[a[0]] ?? 99) - (STATUS_SORT[b[0]] ?? 99))
      .forEach(([status, rawItems]) => {
        const items = rawItems.filter(r => {
          const m = getMetal(r);
          if (printMetalFilter === 'gold') return m === 'Gold';
          if (printMetalFilter === 'silver') return m === 'Silver';
          return true;
        });
        if (items.length === 0) return;
        const isDead = DEAD_STATUSES.has(status);
        const statusProfit = items.reduce((s, r) => s + calcProfitAED(r), 0);
        const statusPrice = items.reduce((s, r) => s + calcItemPriceAED(r), 0);
        const statusCost = items.reduce((s, r) => s + calcItemCostAED(r), 0);

        html += `<div class="status-section">`;
        html += `<h2 class="font-cinzel status-header">${status.toUpperCase()} &nbsp; <small style="font-size:12px;font-weight:normal;">(${items.length} items)</small></h2>`;
        if (!isDead) {
          html += `<p class="status-totals">Price: AED ${statusPrice.toFixed(2)} &nbsp;|&nbsp; Cost: AED ${statusCost.toFixed(2)} &nbsp;|&nbsp; <strong class="${statusProfit >= 0 ? 'profit-pos' : 'profit-neg'}">Profit: AED ${statusProfit.toFixed(2)}</strong></p>`;
        }

        // Group by metal → brand → client
        const allowedMetals = printMetalFilter === 'gold' ? ['Gold'] : printMetalFilter === 'silver' ? ['Silver'] : METAL_ORDER;
        for (const metal of allowedMetals as Metal[]) {
          const metalItems = items.filter(r => getMetal(r) === metal);
          if (metalItems.length === 0) continue;
          const mGrams = metalItems.reduce((s, r) => s + calcGrams(r), 0);
          const mProfit = metalItems.reduce((s, r) => s + calcProfitAED(r), 0);
          html += `<div class="metal-header metal-${metal.toLowerCase()}">${metal === 'Gold' ? '🥇' : metal === 'Silver' ? '🥈' : '📦'} ${metal} — ${metalItems.length} items · ${mGrams.toFixed(2)}g${!isDead ? ` · Profit: AED ${mProfit.toFixed(2)}` : ''}</div>`;

          const byBrand = new Map<string, DatabaseRowType[]>();
          for (const r of metalItems) {
            let pk = (r.page || 'Other').trim();
            if (pk.toUpperCase().includes('MYK')) pk = 'MYK';
            else if (pk.toUpperCase().includes('EMPIRE')) pk = 'Empire Gold By ETG';
            else if (pk.toUpperCase().includes('ALIYAH')) pk = "Aliyah's Sterling Silver Collection";
            if (!byBrand.has(pk)) byBrand.set(pk, []);
            byBrand.get(pk)!.push(r);
          }
          [...byBrand.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([brand, brandRows]) => {
            const bGrams = brandRows.reduce((s, r) => s + calcGrams(r), 0);
            const bProfit = brandRows.reduce((s, r) => s + calcProfitAED(r), 0);
            html += `<div class="brand-block"><div class="brand-header">${brand} &nbsp; <span style="font-weight:normal;font-size:10px;">${brandRows.length} items · ${bGrams.toFixed(2)}g</span></div>`;
            const colCount = isDead ? 4 : 5;
            const profitTh = isDead ? '' : `<th class="r">Profit</th>`;
            html += `<table><thead><tr><th>Client</th><th>Item</th><th class="r">Grams</th><th class="r">Price</th><th class="r">Cost</th>${profitTh}</tr></thead><tbody>`;
            // Group by date for separator rows
            const byDate = new Map<string, typeof brandRows>();
            for (const r of brandRows) {
              const dk = r.dateOfLive || '—';
              if (!byDate.has(dk)) byDate.set(dk, []);
              byDate.get(dk)!.push(r);
            }
            const formatPrintDate = (raw: string): string => {
              try {
                const d = new Date(raw);
                if (isNaN(d.getTime())) return raw;
                const m = String(d.getUTCMonth() + 1).padStart(2, '0');
                const day = String(d.getUTCDate()).padStart(2, '0');
                const y = d.getUTCFullYear();
                return `${m}/${day}/${y}`;
              } catch { return raw; }
            };
            [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([dk, dateRows]) => {
              const formattedDate = dk === '—' ? '—' : formatPrintDate(dk);
              html += `<tr style="background:#ddd !important;"><td colspan="${colCount}" style="padding:4px 8px;font-size:10px;font-weight:bold;color:#333;">📅 ${formattedDate}</td></tr>`;
              dateRows.forEach(r => {
                const gr = calcGrams(r);
                const grStr = gr > 0 ? `${gr.toFixed(2)}g` : 'PC';
                const pr = calcProfitAED(r);
                const pCell = isDead ? '' : `<td class="r ${pr >= 0 ? 'profit-pos' : 'profit-neg'}">${pr.toFixed(2)}</td>`;
                html += `<tr><td>${r.minerName || '—'}</td><td>${r.itemDescription || '—'}</td><td class="r">${grStr}</td><td class="r">${calcItemPriceAED(r).toFixed(2)}</td><td class="r">${calcItemCostAED(r).toFixed(2)}</td>${pCell}</tr>`;
              });
            });
            const brandProfitCell = isDead ? '' : `<td class="r ${bProfit >= 0 ? 'profit-pos' : 'profit-neg'}">${bProfit.toFixed(2)}</td>`;
            html += `<tr class="subtotal-row"><td colspan="2">${brand} Total</td><td class="r">${bGrams.toFixed(2)}g</td><td class="r">${brandRows.reduce((s,r)=>s+calcItemPriceAED(r),0).toFixed(2)}</td><td class="r">${brandRows.reduce((s,r)=>s+calcItemCostAED(r),0).toFixed(2)}</td>${brandProfitCell}</tr>`;
            html += `</tbody></table></div>`;
          });
        }
        html += `</div>`;
      });

    html += `</body></html>`;
    win.document.write(html);
    win.document.close();
    win.print();
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader title="Bossing Dashboard" subtitle="Executive summary — AED" searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <div className="px-4 pt-4">

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex gap-1 flex-wrap flex-1">
            {RANGES.map(r => (
              <Button
                key={r.key}
                size="sm"
                variant={range === r.key ? 'default' : 'outline'}
                className={`text-xs h-7 ${range === r.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                onClick={() => setRange(r.key)}
              >
                {r.key === 'custom' && <Calendar className="h-3 w-3 mr-1" />}
                {r.label}
              </Button>
            ))}
          </div>
          <Select value={liverFilter} onValueChange={setLiverFilter}>
            <SelectTrigger className="h-7 text-xs w-36 bg-background border-border">
              <SelectValue placeholder="All Livers" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-xs">All Livers</SelectItem>
              {liverNames.map(name => (
                <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {range === 'custom' && (
          <div className="flex gap-2 mb-4">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs border-border h-8">
                  {customFrom ? formatDate(customFrom.toISOString()) : 'From date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-card border-border">
                <CalendarComponent mode="single" selected={customFrom} onSelect={d => { setCustomFrom(d); setPickerOpen(false); }} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs border-border h-8">
                  {customTo ? formatDate(customTo.toISOString()) : 'To date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-card border-border">
                <CalendarComponent mode="single" selected={customTo} onSelect={d => setCustomTo(d)} />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* KPI Grid — airy dashboard style (low-density screen) */}
        <div className="kt-stagger grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard
            className="col-span-2 lg:col-span-4"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            accent="primary"
            label="Confirmed Profit (Delivered)"
            value={`AED ${kpis.confirmedProfit.toFixed(2)}`}
            sub={`${kpis.totalSold} items delivered · All-active: AED ${kpis.totalProfit.toFixed(2)}`}
          />
          <StatCard
            icon={<span className="text-xs">🥇</span>}
            accent="gold"
            label="Gold Grams"
            value={`${kpis.goldGrams.toFixed(2)}g`}
            sub={`Profit AED ${kpis.goldProfit.toFixed(2)}`}
          />
          <StatCard
            icon={<span className="text-xs">🥈</span>}
            accent="silver"
            label="Silver Grams"
            value={`${kpis.silverGrams.toFixed(2)}g`}
            sub={`Profit AED ${kpis.silverProfit.toFixed(2)}`}
          />
          <StatCard
            accent="orange"
            label="Outstanding"
            value={`AED ${kpis.outstanding.toFixed(0)}`}
            sub="Remaining receivables"
          />
          <StatCard
            accent="neutral"
            label="Total Grams"
            value={`${kpis.totalGrams.toFixed(2)}g`}
            sub="All active items"
          />
        </div>

        {/* Detailed Breakdown header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-cinzel text-base text-primary">Breakdown by Status</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs border-primary/40 text-primary" onClick={handleExportCsv}>
              <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs border-primary/40 text-primary" onClick={openPrintDialog}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Report
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {sortedStatusEntries.map(([status, items]) => {
            const isDead = DEAD_STATUSES.has(status);
            const totalProfit = items.reduce((sum, r) => sum + calcProfitAED(r), 0);
            const groupGrams = items.reduce((s, r) => s + calcGrams(r), 0);
            const isExpanded = expandedStatuses[status];

            return (
              <div key={status} className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => toggleStatus(status)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none hover:bg-secondary/20 transition-colors"
                >
                  <StatusBadge status={status} />
                  <span className="text-[10px] text-muted-foreground shrink-0">{items.length} items</span>
                  {groupGrams > 0 && (
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">{groupGrams.toFixed(2)}g</span>
                  )}
                  <div className="h-px flex-1 bg-border/40" />
                  {!isDead && (
                    <span className={`text-xs font-bold shrink-0 ${totalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      AED {totalProfit.toFixed(0)}
                    </span>
                  )}
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && (() => {
                  const statusLiver = statusLiverFilters[status] || 'all';
                  const statusLiverNames = [...new Set(items.map(r => r.liverName?.trim().toUpperCase()).filter(Boolean) as string[])].sort();
                  const visibleItems = statusLiver === 'all' ? items : items.filter(r => r.liverName?.trim().toUpperCase() === statusLiver);

                  return (
                    <div className="px-4 pb-4 border-t border-border pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
                      {statusLiverNames.length > 1 && (
                        <div className="mb-3">
                          <Select value={statusLiver} onValueChange={v => setStatusLiverFilters(prev => ({ ...prev, [status]: v }))}>
                            <SelectTrigger className="h-7 text-xs w-40 bg-background border-border">
                              <SelectValue placeholder="All Livers" />
                            </SelectTrigger>
                            <SelectContent className="bg-popover border-border">
                              <SelectItem value="all" className="text-xs">All Livers</SelectItem>
                              {statusLiverNames.map(name => (
                                <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Metal sections: Gold → Silver → Other */}
                      <div className="space-y-5">
                        {METAL_ORDER.map(metal => {
                          const metalItems = visibleItems.filter(r => getMetal(r) === metal);
                          if (metalItems.length === 0) return null;
                          const metalGrams = metalItems.reduce((s, r) => s + calcGrams(r), 0);
                          const metalProfit = metalItems.reduce((s, r) => s + calcProfitAED(r), 0);

                          // Group by page → date
                          const byPage = new Map<string, Map<string, DatabaseRowType[]>>();
                          for (const r of metalItems) {
                            let pk = (r.page || 'Other').trim();
                            if (pk.toUpperCase().includes('MYK')) pk = 'MYK';
                            else if (pk.toUpperCase().includes('EMPIRE')) pk = 'Empire Gold By ETG';
                            else if (pk.toUpperCase().includes('ALIYAH')) pk = "Aliyah's Sterling Silver Collection";
                            const d = getSaleDate(r) || 'Unknown Date';
                            if (!byPage.has(pk)) byPage.set(pk, new Map());
                            const bd = byPage.get(pk)!;
                            if (!bd.has(d)) bd.set(d, []);
                            bd.get(d)!.push(r);
                          }
                          const sortedPages = [...byPage.entries()].sort((a, b) => {
                            if (a[0] === 'MYK') return -1; if (b[0] === 'MYK') return 1;
                            if (a[0] === 'Empire Gold By ETG') return -1; if (b[0] === 'Empire Gold By ETG') return 1;
                            if (a[0] === "Aliyah's Sterling Silver Collection") return -1; if (b[0] === "Aliyah's Sterling Silver Collection") return 1;
                            return a[0].localeCompare(b[0]);
                          });

                          return (
                            <div key={metal}>
                              {/* Metal header */}
                              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border mb-3 ${METAL_BG[metal]}`}>
                                <span className={`text-xs font-bold uppercase tracking-widest ${METAL_COLORS[metal]}`}>
                                  {metal === 'Gold' ? '🥇' : metal === 'Silver' ? '🥈' : '📦'} {metal}
                                </span>
                                <span className="text-xs text-muted-foreground">{metalItems.length} items</span>
                                {metalGrams > 0 && <span className="text-xs text-muted-foreground">{metalGrams.toFixed(2)}g</span>}
                                {!isDead && (
                                  <span className={`text-xs font-semibold ml-auto ${metalProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                                    AED {metalProfit.toFixed(2)}
                                  </span>
                                )}
                              </div>

                              <div className="space-y-4 ml-2">
                                {sortedPages.map(([page, dateMap]) => {
                                  const sortedDates = [...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]));
                                  return (
                                    <div key={page}>
                                      <div className="flex items-center gap-2 mb-2">
                                        <span className="text-[10px] font-bold text-primary/70 uppercase tracking-widest">📄 {page}</span>
                                        <div className="h-px flex-1 bg-border/50" />
                                        <span className="text-[10px] text-muted-foreground">{Array.from(dateMap.values()).reduce((s, v) => s + v.length, 0)}</span>
                                      </div>
                                      <div className="space-y-2 ml-2">
                                        {sortedDates.map(([date, dateItems]) => {
                                          const dateKey = `${status}__${metal}__${page}__${date}`;
                                          const isDateCollapsed = collapsedDates[dateKey];
                                          const dg = dateItems.reduce((s, r) => s + calcGrams(r), 0);
                                          const dp = dateItems.reduce((s, r) => s + calcProfitAED(r), 0);

                                          return (
                                            <div key={date} className="rounded-lg border border-border/50 overflow-hidden">
                                              <button
                                                onClick={() => toggleDate(dateKey)}
                                                className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/60 transition-colors text-left focus:outline-none"
                                              >
                                                <div className="flex items-center gap-2">
                                                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">📅 {formatDate(date)}</span>
                                                  <span className="text-[9px] text-muted-foreground bg-border/50 px-1.5 py-0.5 rounded-full">
                                                    {dateItems.length} item{dateItems.length !== 1 ? 's' : ''}{dg > 0 ? ` · ${dg.toFixed(2)}g` : ''}
                                                  </span>
                                                  {!isDead && (
                                                    <span className={`text-[9px] font-semibold ${dp >= 0 ? 'text-success' : 'text-destructive'}`}>
                                                      AED {dp.toFixed(2)}
                                                    </span>
                                                  )}
                                                </div>
                                                <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isDateCollapsed ? '' : 'rotate-180'}`} />
                                              </button>

                                              {!isDateCollapsed && (
                                                <div className="px-3 py-2 space-y-2">
                                                  {dateItems.map(record => {
                                                    const profit = calcProfitAED(record);
                                                    const gramsDisplay = calcGrams(record) > 0 ? `${Number(record.grams).toFixed(2)}g` : 'PC';
                                                    return (
                                                      <div key={record.id} className="flex justify-between items-start border-b border-border/40 pb-2 last:border-0 last:pb-0">
                                                        <div className="flex-1 pr-2">
                                                          <div className="flex items-center gap-1.5">
                                                            <p className="text-sm font-medium">{record.minerName || 'Unknown'}</p>
                                                            {record.customerId && (
                                                              <button
                                                                onClick={e => { e.stopPropagation(); setHistoryCustomer({ id: record.customerId!, name: record.minerName || '' }); }}
                                                                className="text-muted-foreground hover:text-primary transition-colors"
                                                                title="View Lifetime History"
                                                              >
                                                                <History className="h-3.5 w-3.5" />
                                                              </button>
                                                            )}
                                                          </div>
                                                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{record.itemDescription}</p>
                                                        </div>
                                                        <div className="text-right shrink-0 space-y-0.5">
                                                          <p className="text-[10px] font-semibold text-muted-foreground">{gramsDisplay}</p>
                                                          {!isDead && (
                                                            <>
                                                              <p className={`text-sm font-medium ${profit >= 0 ? 'text-foreground' : 'text-destructive'}`}>AED {profit.toFixed(2)}</p>
                                                              <p className="text-[10px] text-muted-foreground">Profit</p>
                                                            </>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {statusGroups.size === 0 && (
            <div className="text-center py-12 border border-dashed border-border rounded-xl">
              <p className="text-sm text-muted-foreground">No records found for this period.</p>
            </div>
          )}
        </div>
      </div>

      {/* Print Dialog */}
      <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
        <DialogContent className="bg-card border-border max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-cinzel text-primary text-base">Select Statuses to Print</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Metal filter */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-muted-foreground font-medium">Metal:</span>
              {(['both', 'gold', 'silver'] as const).map(opt => (
                <Button
                  key={opt}
                  size="sm"
                  variant={printMetalFilter === opt ? 'default' : 'outline'}
                  className={`text-xs h-7 ${printMetalFilter === opt ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                  onClick={() => setPrintMetalFilter(opt)}
                >
                  {opt === 'both' ? '🥇🥈 Both' : opt === 'gold' ? '🥇 Gold Only' : '🥈 Silver Only'}
                </Button>
              ))}
            </div>
            <div className="border-t border-border pt-3 flex gap-2 mb-2">
              <Button size="sm" variant="outline" className="text-xs h-7 border-border" onClick={() => setSelectedPrintStatuses(new Set(statusGroups.keys()))}>Select All</Button>
              <Button size="sm" variant="outline" className="text-xs h-7 border-border" onClick={() => setSelectedPrintStatuses(new Set())}>Clear All</Button>
            </div>
            {sortedStatusEntries.map(([status, items]) => (
              <div key={status} className="flex items-center gap-3">
                <Checkbox id={`print-${status}`} checked={selectedPrintStatuses.has(status)} onCheckedChange={() => togglePrintStatus(status)} />
                <Label htmlFor={`print-${status}`} className="text-sm cursor-pointer flex-1">
                  {status}
                  <span className="text-xs text-muted-foreground ml-2">({items.length} items)</span>
                </Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs border-border" onClick={() => setShowPrintDialog(false)}>Cancel</Button>
            <Button size="sm" className="text-xs bg-primary text-primary-foreground" disabled={selectedPrintStatuses.size === 0} onClick={handlePrintReport}>
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {historyCustomer && (
        <CustomerHistoryModal
          customerId={historyCustomer.id}
          minerName={historyCustomer.name}
          allRecords={records}
          onClose={() => setHistoryCustomer(null)}
        />
      )}
    </div>
  );
}
