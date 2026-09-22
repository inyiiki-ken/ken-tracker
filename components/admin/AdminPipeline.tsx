"use client";

import { useMemo, useState } from 'react';
import { ChevronDown, Layout, Crown, BookOpen, Plus, Calendar, Clock, PauseCircle, ShieldCheck, BarChart2, Merge, AlertTriangle, Package, Gem, Download } from 'lucide-react';
import { TabProps, DatabaseRowType } from '@/types';
import { applySearch, groupByMiner, groupByMinerName, formatDate } from '@/lib/formatters';
import { isOverdue } from '@/lib/calculations';
import TabHeader from '@/components/TabHeader';
import AdminClientCard from './AdminClientCard';
import ReviewChasingCard from './ReviewChasingCard';
import AddClientModal from '@/components/accounts/AddClientModal';
import DailyRatesEditor from '@/components/admin/DailyRatesEditor';
import MergeClientsModal from '@/components/admin/MergeClientsModal';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { isFieldHidden } from '@/lib/appConfig';
import { getMasterlistTemplate } from '@/lib/api';
import { base64ToBlob, downloadBlob } from '@/lib/fileBase64';
import { XLSX_MIME } from '@/components/settings/MasterlistTemplateSettings';

// Statuses that all belong to the "waiting for the payment to be secured" phase,
// grouped under one section so the admin sees them together.
const WFDP_GROUP = ['Waiting for Downpayment', 'Pending for Tamara', 'Pending for Tabby'];
const WFDP_LABEL = 'Waiting for DP / Pending Tamara & Tabby';

export default function AdminPipeline({ records, searchQuery, onSearchChange, onUpdate, onBulkUpdate, userEmail, userFirstName, onRefresh }: TabProps) {
  // Prefer this customer's own uploaded template (Settings → Masterlist
  // Template); fall back to the bundled default. Preserves exact styling.
  const handleExportMasterlist = async () => {
    const filename = `Masterlist-Template-${new Date().toISOString().split('T')[0]}.xlsx`;
    try {
      const res = await getMasterlistTemplate({});
      if (res.dataUrl) {
        downloadBlob(base64ToBlob(res.dataUrl, XLSX_MIME), filename);
      } else {
        const f = await fetch('/masterlist-template.xlsx');
        if (!f.ok) throw new Error('Template file not found.');
        downloadBlob(await f.blob(), filename);
      }
      toast.success('Masterlist template downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download template');
    }
  };

  const [expandedPages, setExpandedPages] = useState<Record<string, boolean>>({});

  const [expandedReviewChasing, setExpandedReviewChasing] = useState<Record<string, boolean>>({});
  const [expandedWFDP, setExpandedWFDP] = useState<Record<string, boolean>>({});
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [showItemHold, setShowItemHold] = useState(false);

  // Pipeline summary counts (global, across all pages)
  const pipelineSummary = useMemo(() => {
    const active = records.filter(r => {
      const s = r.status || '';
      return ['Pending', 'Waiting for Details', ...WFDP_GROUP,
        'Payment for Verification', 'Delivered'].includes(s);
    });
    return {
      pending: active.filter(r => r.status === 'Pending' || r.status === 'Waiting for Details').length,
      wfdp: active.filter(r => WFDP_GROUP.includes(r.status || '')).length,
      verif: active.filter(r => r.status === 'Payment for Verification').length,

      reviewChasing: active.filter(r => r.status === 'Delivered' && r.reviewChasing !== 'Skipped' && r.reviewChasing !== 'Completed').length,
      itemHold: records.filter(r => r.status === 'Paid/DP but Item Hold').length,
      needsAction: records.filter(r => isOverdue(r)).length,
      total: active.length,
    };
  }, [records]);

  const pageGroups = useMemo(() => {
    const searched = applySearch(records, searchQuery);
    const activeAdminRecords = searched.filter(r => {
      const status = r.status || '';
      if (status === 'Pending' || status === 'Waiting for Details' || WFDP_GROUP.includes(status)) return true;

      if (status === 'Payment for Verification') return true;
      if (status === 'Delivered') {
        if (r.reviewChasing === 'Skipped' || r.reviewChasing === 'Completed') return false;
        return true;
      }
      if (showItemHold && status === 'Paid/DP but Item Hold') return true;
      return false;
    });

    // Apply "Needs Action" filter: only show overdue records
    const filtered = needsActionOnly ? activeAdminRecords.filter(r => isOverdue(r)) : activeAdminRecords;

    const groups: Record<string, DatabaseRowType[]> = {};
    filtered.forEach(r => {
      let pageKey = (r.page || 'Other').trim();
      if (pageKey.toUpperCase().includes('MYK')) pageKey = 'MYK';
      else if (pageKey.toUpperCase().includes('EMPIRE')) pageKey = 'Empire Gold By ETG';
      else if (pageKey.toUpperCase().includes('ALIYAH')) pageKey = "Aliyah's Sterling Silver Collection";
      if (!groups[pageKey]) groups[pageKey] = [];
      groups[pageKey].push(r);
    });

    return Object.keys(groups)
      .sort((a, b) => {
        if (a === 'MYK') return -1; if (b === 'MYK') return 1;
        if (a === 'Empire Gold By ETG') return -1; if (b === 'Empire Gold By ETG') return 1;
        if (a === "Aliyah's Sterling Silver Collection") return -1; if (b === "Aliyah's Sterling Silver Collection") return 1;
        return a.localeCompare(b);
      })
      .reduce((acc, key) => { acc[key] = groups[key]; return acc; }, {} as Record<string, DatabaseRowType[]>);
  }, [records, searchQuery, needsActionOnly, showItemHold]);

  const togglePage = (page: string) =>
    setExpandedPages(prev => ({ ...prev, [page]: !prev[page] }));

  const toggleDate = (key: string) =>
    setExpandedDates(prev => ({ ...prev, [key]: !prev[key] }));

  const groupMinedByDate = (minedItems: DatabaseRowType[]): Map<string, Map<string, DatabaseRowType[]>> => {
    const byDate = new Map<string, Map<string, DatabaseRowType[]>>();
    for (const r of minedItems) {
      const date = r.dateOfLive || 'Unknown Date';
      const miner = r.minerName?.trim() || 'Unknown Client';
      if (!byDate.has(date)) byDate.set(date, new Map());
      const byMiner = byDate.get(date)!;
      if (!byMiner.has(miner)) byMiner.set(miner, []);
      byMiner.get(miner)!.push(r);
    }
    return new Map([...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  };

  const renderPageSection = (pageName: string, pageRecords: DatabaseRowType[]) => {
    const isExpanded = expandedPages[pageName] === true;
    const minedItems = pageRecords.filter(r =>
      r.status === 'Pending' || r.status === 'Waiting for Details'
    );
    const wfdpItems = pageRecords.filter(r => WFDP_GROUP.includes(r.status || ''));

    const paymentVerifItems = pageRecords.filter(r => r.status === 'Payment for Verification');
    const paymentVerifByDate = groupMinedByDate(paymentVerifItems);
    const reviewChasingItems = pageRecords.filter(r => r.status === 'Delivered');
    const itemHoldItems = pageRecords.filter(r => r.status === 'Paid/DP but Item Hold');
    const minedByDate = groupMinedByDate(minedItems);
    const wfdpByDate = groupMinedByDate(wfdpItems);

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
        <div
          className="flex items-center gap-3 py-2.5 px-4 bg-secondary/40 rounded-xl cursor-pointer mb-4 border border-primary/10 hover:bg-secondary/60 transition-colors"
          onClick={() => togglePage(pageName)}
        >
          {pageName === 'MYK' ? <Crown className="h-5 w-5 text-attention" />
            : pageName === 'Empire Gold By ETG' ? <BookOpen className="h-5 w-5 text-primary" />
            : pageName === "Aliyah's Sterling Silver Collection" ? <Gem className="h-5 w-5 text-hold" />
            : <Layout className="h-5 w-5 text-muted-foreground" />}
          <h2 className="font-cinzel text-base font-bold text-primary tracking-widest uppercase">{pageName}</h2>
          <div className="flex items-center gap-1 flex-wrap">
            {statusChips.map(c => (
              <span key={c.label} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${c.color}`}>
                {c.label} {c.count}
              </span>
            ))}
          </div>
          <div className="h-px flex-1 bg-primary/10" />
          <span className="text-[10px] font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-md">{pageRecords.length}</span>
          <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>

        {isExpanded && (
          <div className="pl-2 sm:pl-4 space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
            {minedByDate.size > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] pl-1">Mined Items</span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
                {Array.from(minedByDate.entries()).map(([date, minerMap]) => {
                  const dateKey = `${pageName}__${date}`;
                  const isDateExpanded = expandedDates[dateKey] === true;
                  const totalItems = Array.from(minerMap.values()).reduce((s, v) => s + v.length, 0);
                  return (
                    <div key={date} className="mb-3">
                      <div
                        className="flex items-center gap-2 py-2 px-3 bg-primary/10 rounded-lg cursor-pointer mb-2 border border-primary/20 hover:bg-primary/15 transition-colors"
                        onClick={() => toggleDate(dateKey)}
                      >
                        <Calendar className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-bold text-primary uppercase tracking-widest">{formatDate(date)}</span>
                        <div className="h-px flex-1 bg-primary/20" />
                        <span className="text-[10px] font-bold bg-primary/20 text-primary px-2 py-0.5 rounded-md">{totalItems}</span>
                        <ChevronDown className={`h-4 w-4 text-primary transition-transform duration-200 ${isDateExpanded ? 'rotate-180' : ''}`} />
                      </div>
                      {isDateExpanded && (
                        <div className="pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          {Array.from(minerMap.entries()).map(([name, items]) => (
                            <AdminClientCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} userEmail={userEmail} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {wfdpByDate.size > 0 && (() => {
              const isWFDPExpanded = expandedWFDP[pageName] === true;
              const totalWFDP = wfdpItems.length;
              return (
                <div>
                  <div
                    className="flex items-center gap-2 mb-3 cursor-pointer"
                    onClick={() => setExpandedWFDP(prev => ({ ...prev, [pageName]: !prev[pageName] }))}
                  >
                    <Clock className="h-3.5 w-3.5 text-warning" />
                    <span className="text-[10px] font-black text-warning uppercase tracking-[0.2em] pl-1">{WFDP_LABEL}</span>
                    <div className="h-px flex-1 bg-warning/20" />
                    <span className="text-[10px] font-bold bg-warning/20 text-warning px-2 py-0.5 rounded-md">{totalWFDP}</span>
                    <ChevronDown className={`h-4 w-4 text-warning transition-transform duration-200 ${isWFDPExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {isWFDPExpanded && (
                    <div className="pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      {Array.from(wfdpByDate.entries()).map(([date, minerMap]) => {
                        const dateKey = `wfdp__${pageName}__${date}`;
                        const isDateExpanded = expandedDates[dateKey] === true;
                        const totalItems = Array.from(minerMap.values()).reduce((s, v) => s + v.length, 0);
                        return (
                          <div key={date} className="mb-3">
                            <div
                              className="flex items-center gap-2 py-2 px-3 bg-warning/10 rounded-lg cursor-pointer mb-2 border border-warning/20 hover:bg-warning/15 transition-colors"
                              onClick={() => toggleDate(dateKey)}
                            >
                              <Calendar className="h-3.5 w-3.5 text-warning" />
                              <span className="text-xs font-bold text-warning uppercase tracking-widest">{formatDate(date)}</span>
                              <div className="h-px flex-1 bg-warning/20" />
                              <span className="text-[10px] font-bold bg-warning/20 text-warning px-2 py-0.5 rounded-md">{totalItems}</span>
                              <ChevronDown className={`h-4 w-4 text-warning transition-transform duration-200 ${isDateExpanded ? 'rotate-180' : ''}`} />
                            </div>
                            {isDateExpanded && (
                              <div className="pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                {Array.from(minerMap.entries()).map(([name, items]) => (
                                  <AdminClientCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} userEmail={userEmail} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {paymentVerifByDate.size > 0 && (() => {
              const isVerifExpanded = expandedDates[`verif__${pageName}`] === true;
              const totalVerif = paymentVerifItems.length;
              return (
                <div>
                  <div
                    className="flex items-center gap-2 mb-3 cursor-pointer"
                    onClick={() => toggleDate(`verif__${pageName}`)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-info" />
                    <span className="text-[10px] font-black text-info uppercase tracking-[0.2em] pl-1">Payment for Verification</span>
                    <div className="h-px flex-1 bg-info/20" />
                    <span className="text-[10px] font-bold bg-info/20 text-info px-2 py-0.5 rounded-md">{totalVerif}</span>
                    <ChevronDown className={`h-4 w-4 text-info transition-transform duration-200 ${isVerifExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {isVerifExpanded && (
                    <div className="pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                      {Array.from(paymentVerifByDate.entries()).map(([date, minerMap]) => {
                        const dateKey = `verif__${pageName}__${date}`;
                        const isDateExpanded = expandedDates[dateKey] === true;
                        const totalItems = Array.from(minerMap.values()).reduce((s, v) => s + v.length, 0);
                        return (
                          <div key={date} className="mb-3">
                            <div
                              className="flex items-center gap-2 py-2 px-3 bg-info/10 rounded-lg cursor-pointer mb-2 border border-info/20 hover:bg-info/15 transition-colors"
                              onClick={() => toggleDate(dateKey)}
                            >
                              <Calendar className="h-3.5 w-3.5 text-info" />
                              <span className="text-xs font-bold text-info uppercase tracking-widest">{formatDate(date)}</span>
                              <div className="h-px flex-1 bg-info/20" />
                              <span className="text-[10px] font-bold bg-info/20 text-info px-2 py-0.5 rounded-md">{totalItems}</span>
                              <ChevronDown className={`h-4 w-4 text-info transition-transform duration-200 ${isDateExpanded ? 'rotate-180' : ''}`} />
                            </div>
                            {isDateExpanded && (
                              <div className="pl-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                {Array.from(minerMap.entries()).map(([name, items]) => (
                                  <AdminClientCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} userEmail={userEmail} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}



            {!isFieldHidden('reviewChasing') && reviewChasingGroups.size > 0 && (() => {
              const isReviewExpanded = expandedReviewChasing[pageName] === true;
              // Split: Pending on top, Chased below (collapsible)
              const pendingEntries = Array.from(reviewChasingGroups.entries()).filter(([, items]) => {
                const s = (items[0]?.reviewChasing || 'Pending');
                return s !== 'Chased' && s !== 'Skipped' && s !== 'Completed';
              });
              const chasedEntries = Array.from(reviewChasingGroups.entries()).filter(([, items]) => {
                const s = (items[0]?.reviewChasing || 'Pending');
                return s === 'Chased' || s === 'Skipped' || s === 'Completed';
              });
              const [chasedOpen, setChasedOpen] = expandedReviewChasing[`${pageName}__chased`] !== undefined
                ? [expandedReviewChasing[`${pageName}__chased`], (v: boolean) => setExpandedReviewChasing(prev => ({ ...prev, [`${pageName}__chased`]: v }))]
                : [false, (v: boolean) => setExpandedReviewChasing(prev => ({ ...prev, [`${pageName}__chased`]: v }))];
              return (
                <div>
                  <div
                    className="flex items-center gap-2 mb-4 cursor-pointer"
                    onClick={() => setExpandedReviewChasing(prev => ({ ...prev, [pageName]: prev[pageName] === undefined ? false : !prev[pageName] }))}
                  >
                    <span className="text-[10px] font-black text-attention uppercase tracking-[0.2em] pl-1">Review Chasing</span>
                    <div className="h-px flex-1 bg-attention/20" />
                    <span className="text-[10px] font-bold bg-attention/20 text-attention px-2 py-0.5 rounded-md">{reviewChasingGroups.size}</span>
                    <ChevronDown className={`h-4 w-4 text-attention transition-transform duration-200 ${isReviewExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {isReviewExpanded && (
                    <div className="space-y-3">
                      {/* Pending first */}
                      {pendingEntries.map(([name, items]) => (
                        <ReviewChasingCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} />
                      ))}
                      {/* Chased / done — collapsible */}
                      {chasedEntries.length > 0 && (
                        <div>
                          <button
                            className="flex items-center gap-2 w-full text-left py-1"
                            onClick={() => setChasedOpen(!chasedOpen)}
                          >
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Chased / Done ({chasedEntries.length})</span>
                            <div className="h-px flex-1 bg-border/40" />
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${chasedOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {chasedOpen && (
                            <div className="space-y-3 mt-2">
                              {chasedEntries.map(([name, items]) => (
                                <ReviewChasingCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} />
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

            {showItemHold && itemHoldGrouped.size > 0 && (() => {
              const isHoldExpanded = expandedDates[`hold__${pageName}`] === true;
              return (
                <div>
                  <div
                    className="flex items-center gap-2 mb-4 cursor-pointer"
                    onClick={() => toggleDate(`hold__${pageName}`)}
                  >
                    <Package className="h-3.5 w-3.5 text-hold" />
                    <span className="text-[10px] font-black text-hold uppercase tracking-[0.2em] pl-1">Items on Hold</span>
                    <div className="h-px flex-1 bg-hold/20" />
                    <span className="text-[10px] font-bold bg-hold/20 text-hold px-2 py-0.5 rounded-md">{itemHoldItems.length}</span>
                    <ChevronDown className={`h-4 w-4 text-hold transition-transform duration-200 ${isHoldExpanded ? 'rotate-180' : ''}`} />
                  </div>
                  {isHoldExpanded && Array.from(itemHoldGrouped.entries()).map(([name, items]) => (
                    <AdminClientCard key={name} minerName={name} records={items} allRecords={records} onUpdate={onUpdate} onBulkUpdate={onBulkUpdate} userEmail={userEmail} />
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader title="Admin Pipeline" subtitle="Active Tasks & Pipeline" searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <div className="px-4 pt-4">
        <DailyRatesEditor date={new Date().toISOString().split('T')[0]} />

        {/* Pipeline Summary Strip */}
        {pipelineSummary.total > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3 p-3 rounded-xl bg-secondary/30 border border-border">
            <BarChart2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mr-1">Pipeline:</span>
            {pipelineSummary.pending > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20">
                Pending {pipelineSummary.pending}
              </span>
            )}
            {pipelineSummary.wfdp > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/20">
                WFDP {pipelineSummary.wfdp}
              </span>
            )}
            {pipelineSummary.verif > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-info/15 text-info border border-info/20">
                Verif {pipelineSummary.verif}
              </span>
            )}

            {pipelineSummary.reviewChasing > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-attention/15 text-attention border border-attention/20">
                Review {pipelineSummary.reviewChasing}
              </span>
            )}
            {pipelineSummary.itemHold > 0 && (
              <button
                onClick={() => setShowItemHold(v => !v)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors ${showItemHold ? 'bg-hold/30 text-hold border-hold/40' : 'bg-hold/15 text-hold border-hold/20'}`}
                title="Toggle Items on Hold visibility"
              >
                <Package className="inline h-2.5 w-2.5 mr-0.5" />
                On Hold {pipelineSummary.itemHold}
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
              onClick={() => setNeedsActionOnly(v => !v)}
              className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${
                needsActionOnly
                  ? 'bg-destructive text-destructive-foreground border-destructive shadow-sm'
                  : 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
              }`}
            >
              <AlertTriangle className="h-3 w-3" />
              {needsActionOnly ? 'Showing Overdue Only' : `${pipelineSummary.needsAction} Needs Action`}
              {needsActionOnly && <span className="ml-1 opacity-70">✕</span>}
            </button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={handleExportMasterlist} className="border-border text-xs h-9">
            <Download className="h-4 w-4 mr-1.5" /> Export Masterlist
          </Button>
          <Button variant="outline" onClick={() => setShowMergeModal(true)} className="border-border text-xs h-9">
            <Merge className="h-4 w-4 mr-1.5" /> Merge Clients
          </Button>
          <Button onClick={() => setShowAddModal(true)} className="text-xs h-9 shadow-sm font-cinzel uppercase tracking-wider">
            <Plus className="h-4 w-4 mr-1.5" /> Add Client
          </Button>
        </div>
      </div>

      <div className="px-4">
        {needsActionOnly && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive font-medium flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Filtered to {pipelineSummary.needsAction} overdue record{pipelineSummary.needsAction !== 1 ? 's' : ''} — items past their 24h follow-up window.
          </div>
        )}
        {Object.keys(pageGroups).length > 0
          ? Object.keys(pageGroups).map(page => renderPageSection(page, pageGroups[page]))
          : (
            <div className="text-center py-24 border-2 border-dashed border-border rounded-2xl">
              {needsActionOnly
                ? <p className="text-sm text-success font-medium">✅ All clear — no overdue records!</p>
                : <p className="text-sm text-muted-foreground font-medium">No records found matching your search.</p>
              }
            </div>
          )}
      </div>
      {showAddModal && <AddClientModal onClose={() => setShowAddModal(false)} userFirstName={userFirstName} userEmail={userEmail} onRefresh={onRefresh} existingRecords={records} />}
      {showMergeModal && <MergeClientsModal onClose={() => setShowMergeModal(false)} onRefresh={onRefresh} records={records} />}
    </div>
  );
}
