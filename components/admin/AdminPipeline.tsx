"use client";

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Layout, Plus, Calendar, Clock, ShieldCheck, BarChart2, Merge, AlertTriangle, Package, Download, ListChecks } from 'lucide-react';
import { TabProps, DatabaseRowType } from '@/types';
import { applySearch, groupByMiner, groupByMinerName, formatDate } from '@/lib/formatters';
import { isOverdue } from '@/lib/calculations';
import { dayKey } from '@/lib/fulfilment';
import { todayLocalISO } from '@/lib/businessConfig';
import TabHeader from '@/components/TabHeader';
import AdminClientCard from './AdminClientCard';
import ReviewChasingCard from './ReviewChasingCard';
import AddClientModal from '@/components/accounts/AddClientModal';
import DailyRatesEditor from '@/components/admin/DailyRatesEditor';
import MergeClientsModal from '@/components/admin/MergeClientsModal';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { isFieldHidden } from '@/lib/appConfig';
import { getMasterlistTemplate, getDataOptions } from '@/lib/api';
import { getMasterlistMapping } from '@/lib/masterlistMapping';
import { masterlistTemplateBlob } from '@/lib/masterlistExport';
import { base64ToBlob, downloadBlob } from '@/lib/fileBase64';
import { XLSX_MIME } from '@/components/settings/MasterlistTemplateSettings';

// Statuses that all belong to the "waiting for the payment to be secured" phase,
// grouped under one section so the admin sees them together.
const WFDP_GROUP = ['Waiting for Downpayment', 'Pending for Tamara', 'Pending for Tabby'];
const WFDP_LABEL = 'Waiting for DP / Pending Tamara & Tabby';
const WFDP_LOWER = WFDP_GROUP.map(s => s.toLowerCase());

type AdminBucket = 'mined' | 'wfdp' | 'verif' | 'review' | 'hold';

/**
 * Which Admin section an item belongs in, or null when it isn't Admin's any
 * more. Statuses are compared without case or extra spaces, because they are
 * often typed straight into the sheet; a blank status is Waiting for Details.
 */
function adminBucket(r: DatabaseRowType, reviewHidden: boolean): AdminBucket | null {
  const s = String(r.status || '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!s || s === 'pending' || s === 'waiting for details') return 'mined';
  if (WFDP_LOWER.includes(s)) return 'wfdp';
  if (s === 'payment for verification') return 'verif';
  if (s === 'paid/dp but item hold') return 'hold';
  if (s === 'delivered') {
    if (reviewHidden) return null;
    return r.reviewChasing === 'Skipped' || r.reviewChasing === 'Completed' ? null : 'review';
  }
  return null;
}

const UNKNOWN_DATE = 'Unknown Date';

/** day → customer → items, newest day first. Same day typed two ways is one group. */
function groupByDay(items: DatabaseRowType[]): Map<string, Map<string, DatabaseRowType[]>> {
  const byDate = new Map<string, Map<string, DatabaseRowType[]>>();
  for (const r of items) {
    const date = dayKey(r.dateOfLive) || (r.dateOfLive ? String(r.dateOfLive).trim() : UNKNOWN_DATE);
    const miner = r.minerName?.trim() || 'Unknown Client';
    if (!byDate.has(date)) byDate.set(date, new Map());
    const byMiner = byDate.get(date)!;
    if (!byMiner.has(miner)) byMiner.set(miner, []);
    byMiner.get(miner)!.push(r);
  }
  const dated = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k);
  return new Map([...byDate.entries()].sort((a, b) => {
    if (dated(a[0]) !== dated(b[0])) return dated(a[0]) ? -1 : 1;
    return b[0].localeCompare(a[0]);
  }));
}

/** Literal class names per section (Tailwind only keeps classes it can see). */
const TONES = {
  primary: { text: 'text-primary', soft: 'bg-primary/10', line: 'bg-primary/20', border: 'border-primary/20', hover: 'hover:bg-primary/15', chip: 'bg-primary/20 text-primary' },
  warning: { text: 'text-warning', soft: 'bg-warning/10', line: 'bg-warning/20', border: 'border-warning/20', hover: 'hover:bg-warning/15', chip: 'bg-warning/20 text-warning' },
  info: { text: 'text-info', soft: 'bg-info/10', line: 'bg-info/20', border: 'border-info/20', hover: 'hover:bg-info/15', chip: 'bg-info/20 text-info' },
};
type Tone = keyof typeof TONES;

export default function AdminPipeline({ records, searchQuery, onSearchChange, onUpdate, onBulkUpdate, userEmail, userFirstName, onRefresh }: TabProps) {
  // Prefer this customer's own uploaded template (Settings → Masterlist
  // Template), which preserves their exact styling. Otherwise build a blank one
  // from THIS customer's import mapping and DATA'S lists. Never a file bundled
  // with the app: that was one customer's form and leaked to everyone else.
  const [exporting, setExporting] = useState(false);
  const handleExportMasterlist = async () => {
    if (exporting) return;
    setExporting(true);
    const filename = `Masterlist-Template-${todayLocalISO()}.xlsx`;
    try {
      const res = await getMasterlistTemplate({});
      if (res.dataUrl) {
        downloadBlob(base64ToBlob(res.dataUrl, XLSX_MIME), filename);
      } else {
        const options = await getDataOptions();
        downloadBlob(masterlistTemplateBlob(options, getMasterlistMapping()), filename);
      }
      toast.success('Masterlist template downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download template');
    } finally {
      setExporting(false);
    }
  };

  // Open/closed state of every collapsible header, keyed by section.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [showItemHold, setShowItemHold] = useState(false);

  const reviewHidden = isFieldHidden('reviewChasing');
  // While searching, everything starts open so the matches show straight away.
  const searching = !!searchQuery?.trim();
  const isOpen = (key: string) => open[key] ?? searching;
  const toggle = (key: string) => setOpen(prev => ({ ...prev, [key]: !isOpen(key) }));

  // Pipeline summary counts (global, across all pages)
  const pipelineSummary = useMemo(() => {
    const c = { pending: 0, wfdp: 0, verif: 0, reviewChasing: 0, itemHold: 0, needsAction: 0, total: 0 };
    for (const r of records) {
      const b = adminBucket(r, reviewHidden);
      if (!b) continue;
      if (b === 'mined') c.pending++;
      else if (b === 'wfdp') c.wfdp++;
      else if (b === 'verif') c.verif++;
      else if (b === 'review') c.reviewChasing++;
      else if (b === 'hold') c.itemHold++;
      if (b !== 'hold') c.total++;
      if (isOverdue(r)) c.needsAction++;
    }
    return c;
  }, [records, reviewHidden]);

  const pageGroups = useMemo(() => {
    const visible = applySearch(records, searchQuery).filter(r => {
      const b = adminBucket(r, reviewHidden);
      if (!b) return false;
      if (b === 'hold' && !showItemHold) return false;
      // "Needs Action": only overdue items
      if (needsActionOnly && !isOverdue(r)) return false;
      return true;
    });

    // One section per page. "Page A" and "page a " are the same page.
    const groups = new Map<string, { name: string; items: DatabaseRowType[] }>();
    for (const r of visible) {
      const name = String(r.page || '').trim().replace(/\s+/g, ' ') || 'Other';
      const key = name.toLowerCase();
      if (!groups.has(key)) groups.set(key, { name, items: [] });
      groups.get(key)!.items.push(r);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.name === 'Other') return 1; if (b.name === 'Other') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [records, searchQuery, needsActionOnly, showItemHold, reviewHidden]);

  const card = (name: string, items: DatabaseRowType[]) => (
    <AdminClientCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} userEmail={userEmail} />
  );

  /** Day headers (collapsible), each holding one card per customer. */
  const renderDays = (prefix: string, byDay: Map<string, Map<string, DatabaseRowType[]>>, tone: Tone) => {
    const t = TONES[tone];
    return Array.from(byDay.entries()).map(([date, minerMap]) => {
      const key = `${prefix}__${date}`;
      const dayOpen = isOpen(key);
      const totalItems = Array.from(minerMap.values()).reduce((s, v) => s + v.length, 0);
      return (
        <div key={date} className="mb-3">
          <button
            type="button"
            className={`w-full flex items-center gap-2 py-2 px-3 rounded-lg mb-2 border text-left transition-colors ${t.soft} ${t.border} ${t.hover}`}
            onClick={() => toggle(key)}
            aria-expanded={dayOpen}
          >
            <Calendar className={`h-3.5 w-3.5 shrink-0 ${t.text}`} />
            <span className={`text-xs font-bold uppercase tracking-widest ${t.text}`}>{date === UNKNOWN_DATE ? 'No live date' : formatDate(date)}</span>
            <span className="text-[10px] text-muted-foreground">{minerMap.size} client{minerMap.size !== 1 ? 's' : ''}</span>
            <div className={`h-px flex-1 ${t.line}`} />
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${t.chip}`}>{totalItems}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${t.text} ${dayOpen ? 'rotate-180' : ''}`} />
          </button>
          {dayOpen && (
            <div className="sm:pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
              {Array.from(minerMap.entries()).map(([name, items]) => card(name, items))}
            </div>
          )}
        </div>
      );
    });
  };

  /** A collapsible section title ("Payment for Verification", "Items on Hold"…). */
  const sectionHeader = (key: string, label: string, count: number, icon: ReactNode, textClass: string, lineClass: string, chipClass: string) => (
    <button type="button" className="w-full flex items-center gap-2 mb-3 text-left" onClick={() => toggle(key)} aria-expanded={isOpen(key)}>
      {icon}
      <span className={`text-[10px] font-black uppercase tracking-[0.2em] pl-1 ${textClass}`}>{label}</span>
      <div className={`h-px flex-1 ${lineClass}`} />
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${chipClass}`}>{count}</span>
      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${textClass} ${isOpen(key) ? 'rotate-180' : ''}`} />
    </button>
  );

  const renderPageSection = (pageName: string, pageRecords: DatabaseRowType[]) => {
    const pageKey = `page__${pageName}`;
    const isExpanded = isOpen(pageKey);
    const inBucket = (b: AdminBucket) => pageRecords.filter(r => adminBucket(r, reviewHidden) === b);
    const minedItems = inBucket('mined');
    const wfdpItems = inBucket('wfdp');
    const paymentVerifItems = inBucket('verif');
    const reviewChasingItems = inBucket('review');
    const itemHoldItems = inBucket('hold');

    const reviewChasingGroups = groupByMinerName(reviewChasingItems);
    const itemHoldGrouped = groupByMiner(itemHoldItems);

    // Mini status chips for page header
    const statusChips = [
      { label: 'Pending', count: minedItems.length, color: 'bg-primary/20 text-primary' },
      { label: 'WFDP', count: wfdpItems.length, color: 'bg-warning/20 text-warning' },
      { label: 'Verif', count: paymentVerifItems.length, color: 'bg-info/20 text-info' },
      { label: 'Review', count: reviewChasingItems.length, color: 'bg-attention/20 text-attention' },
      { label: 'On Hold', count: itemHoldItems.length, color: 'bg-hold/20 text-hold' },
    ].filter(c => c.count > 0);

    return (
      <div key={pageName} className="mb-6">
        <button
          type="button"
          className="w-full text-left flex items-center gap-2 sm:gap-3 py-2.5 px-3 sm:px-4 bg-secondary/40 rounded-xl mb-4 border border-primary/10 hover:bg-secondary/60 transition-colors"
          onClick={() => toggle(pageKey)}
          aria-expanded={isExpanded}
        >
          <Layout className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-cinzel text-sm sm:text-base font-bold text-primary tracking-widest uppercase truncate max-w-full">{pageName}</h2>
            <div className="flex items-center gap-1 flex-wrap">
              {statusChips.map(c => (
                <span key={c.label} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c.color}`}>
                  {c.label} {c.count}
                </span>
              ))}
            </div>
          </div>
          <span className="shrink-0 text-[10px] font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-md">{pageRecords.length}</span>
          <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {isExpanded && (
          <div className="sm:pl-4 space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
            {minedItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] pl-1">Mined Items</span>
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="text-[10px] font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-md">{minedItems.length}</span>
                </div>
                {renderDays(`mined__${pageName}`, groupByDay(minedItems), 'primary')}
              </div>
            )}

            {wfdpItems.length > 0 && (
              <div>
                {sectionHeader(`wfdp__${pageName}`, WFDP_LABEL, wfdpItems.length, <Clock className="h-3.5 w-3.5 shrink-0 text-warning" />, 'text-warning', 'bg-warning/20', 'bg-warning/20 text-warning')}
                {isOpen(`wfdp__${pageName}`) && (
                  <div className="sm:pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {renderDays(`wfdp__${pageName}`, groupByDay(wfdpItems), 'warning')}
                  </div>
                )}
              </div>
            )}

            {paymentVerifItems.length > 0 && (
              <div>
                {sectionHeader(`verif__${pageName}`, 'Payment for Verification', paymentVerifItems.length, <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-info" />, 'text-info', 'bg-info/20', 'bg-info/20 text-info')}
                {isOpen(`verif__${pageName}`) && (
                  <div className="sm:pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {renderDays(`verif__${pageName}`, groupByDay(paymentVerifItems), 'info')}
                  </div>
                )}
              </div>
            )}

            {reviewChasingGroups.size > 0 && (() => {
              const reviewKey = `review__${pageName}`;
              const chasedKey = `review__${pageName}__chased`;
              // Pending on top, Chased below (collapsible)
              const entries = Array.from(reviewChasingGroups.entries());
              const pendingEntries = entries.filter(([, items]) => (items[0]?.reviewChasing || 'Pending') !== 'Chased');
              const chasedEntries = entries.filter(([, items]) => items[0]?.reviewChasing === 'Chased');
              return (
                <div>
                  {sectionHeader(reviewKey, 'Review Chasing', reviewChasingGroups.size, <ListChecks className="h-3.5 w-3.5 shrink-0 text-attention" />, 'text-attention', 'bg-attention/20', 'bg-attention/20 text-attention')}
                  {isOpen(reviewKey) && (
                    <div className="space-y-3">
                      {pendingEntries.map(([name, items]) => (
                        <ReviewChasingCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} />
                      ))}
                      {chasedEntries.length > 0 && (
                        <div>
                          <button
                            type="button"
                            className="flex items-center gap-2 w-full text-left py-1"
                            onClick={() => toggle(chasedKey)}
                          >
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Chased ({chasedEntries.length})</span>
                            <div className="h-px flex-1 bg-border/40" />
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isOpen(chasedKey) ? 'rotate-180' : ''}`} />
                          </button>
                          {isOpen(chasedKey) && (
                            <div className="space-y-3 mt-2">
                              {chasedEntries.map(([name, items]) => (
                                <ReviewChasingCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {itemHoldGrouped.size > 0 && (
              <div>
                {sectionHeader(`hold__${pageName}`, 'Items on Hold', itemHoldItems.length, <Package className="h-3.5 w-3.5 shrink-0 text-hold" />, 'text-hold', 'bg-hold/20', 'bg-hold/20 text-hold')}
                {isOpen(`hold__${pageName}`) && Array.from(itemHoldGrouped.entries()).map(([name, items]) => card(name, items))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const chip = 'text-[10px] font-bold px-2 py-0.5 rounded-full border';

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader title="Admin Pipeline" subtitle="Active Tasks & Pipeline" searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <div className="px-3 sm:px-4 pt-4">
        <DailyRatesEditor date={todayLocalISO()} />

        {/* Pipeline Summary Strip */}
        {(pipelineSummary.total > 0 || pipelineSummary.itemHold > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3 p-3 rounded-xl bg-secondary/30 border border-border">
            <BarChart2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mr-1">Pipeline:</span>
            {pipelineSummary.pending > 0 && (
              <span className={`${chip} bg-primary/15 text-primary border-primary/20`}>Pending {pipelineSummary.pending}</span>
            )}
            {pipelineSummary.wfdp > 0 && (
              <span className={`${chip} bg-warning/15 text-warning border-warning/20`}>WFDP {pipelineSummary.wfdp}</span>
            )}
            {pipelineSummary.verif > 0 && (
              <span className={`${chip} bg-info/15 text-info border-info/20`}>Verif {pipelineSummary.verif}</span>
            )}
            {pipelineSummary.reviewChasing > 0 && (
              <span className={`${chip} bg-attention/15 text-attention border-attention/20`}>Review {pipelineSummary.reviewChasing}</span>
            )}
            {pipelineSummary.itemHold > 0 && (
              <button
                type="button"
                onClick={() => setShowItemHold(v => !v)}
                className={`${chip} transition-colors ${showItemHold ? 'bg-hold/30 text-hold border-hold/40' : 'bg-hold/15 text-hold border-hold/20'}`}
                aria-pressed={showItemHold}
              >
                <Package className="inline h-2.5 w-2.5 mr-0.5" />
                {showItemHold ? `Hide On Hold ${pipelineSummary.itemHold}` : `Show On Hold ${pipelineSummary.itemHold}`}
              </button>
            )}
            <div className="h-px flex-1" />
            <span className="text-[10px] font-bold text-muted-foreground">{pipelineSummary.total} total</span>
          </div>
        )}

        {/* Quick Filter Bar */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {pipelineSummary.needsAction > 0 && (
            <button
              type="button"
              onClick={() => setNeedsActionOnly(v => !v)}
              className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${
                needsActionOnly
                  ? 'bg-destructive text-destructive-foreground border-destructive shadow-sm'
                  : 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
              }`}
              aria-pressed={needsActionOnly}
            >
              <AlertTriangle className="h-3 w-3" />
              {needsActionOnly ? 'Showing Overdue Only' : `${pipelineSummary.needsAction} Needs Action`}
              {needsActionOnly && <span className="ml-1 opacity-70">✕</span>}
            </button>
          )}
          <div className="flex-1" />
          <div className="grid grid-cols-3 sm:flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={handleExportMasterlist} disabled={exporting} className="border-border text-xs h-9 px-2 sm:px-4">
              <Download className="h-4 w-4 mr-1 sm:mr-1.5 shrink-0" /> <span className="truncate">{exporting ? 'Exporting…' : <>Export<span className="hidden sm:inline"> Masterlist</span></>}</span>
            </Button>
            <Button variant="outline" onClick={() => setShowMergeModal(true)} className="border-border text-xs h-9 px-2 sm:px-4">
              <Merge className="h-4 w-4 mr-1 sm:mr-1.5 shrink-0" /> <span className="truncate">Merge<span className="hidden sm:inline"> Clients</span></span>
            </Button>
            <Button onClick={() => setShowAddModal(true)} className="text-xs h-9 px-2 sm:px-4 shadow-sm font-cinzel uppercase tracking-wider">
              <Plus className="h-4 w-4 mr-1 sm:mr-1.5 shrink-0" /> <span className="truncate">Add Client</span>
            </Button>
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-4">
        {needsActionOnly && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Filtered to {pipelineSummary.needsAction} overdue record{pipelineSummary.needsAction !== 1 ? 's' : ''}: items past their 24h follow-up window.
          </div>
        )}
        {pageGroups.length > 0
          ? pageGroups.map(g => renderPageSection(g.name, g.items))
          : (
            <div className="text-center py-24 border-2 border-dashed border-border rounded-2xl">
              {needsActionOnly
                ? <p className="text-sm text-success font-medium">✅ All clear, no overdue records!</p>
                : searching
                  ? <p className="text-sm text-muted-foreground font-medium">No records found matching your search.</p>
                  : <p className="text-sm text-muted-foreground font-medium">Nothing waiting in the Admin pipeline.</p>
              }
            </div>
          )}
      </div>
      {showAddModal && <AddClientModal onClose={() => setShowAddModal(false)} userFirstName={userFirstName} userEmail={userEmail} onRefresh={onRefresh} existingRecords={records} />}
      {showMergeModal && <MergeClientsModal onClose={() => setShowMergeModal(false)} onRefresh={onRefresh} records={records} />}
    </div>
  );
}
