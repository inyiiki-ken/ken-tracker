"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Package, Truck, Handshake, CheckSquare, ShoppingBag, Layout, Crown, BookOpen, XCircle, CheckCircle2, AlertTriangle, Gem, Plane, Store, Printer } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TabProps, DatabaseRowType } from '@/types';
import { applySearch, groupByPageDateMiner, formatDate } from '@/lib/formatters';
import CollapsibleGroup from '@/components/CollapsibleGroup';
import TabHeader from '@/components/TabHeader';
import DispatchClientCard from './DispatchClientCard';
import PulloutReport from './PulloutReport';
import CancelReport from './CancelReport';
import PulloutRequestsPanel from './PulloutRequestsPanel';
import DeliveryReportsPanel from './DeliveryReportsPanel';
import CancelReasonField from '@/components/CancelReasonField';
import RemindersDialog from '@/components/RemindersDialog';
import { computeOverdue } from '@/lib/reminders';
import { parseDateRobust } from '@/lib/calculations';
import { ORDER_BOXES, OrderBox, orderBox, isStillWithAdmin, shipmentDay, cancelDay, outsourceName, fulfilmentStage } from '@/lib/fulfilment';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { liverKey } from '@/lib/pulloutRequests';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

/** Boxes of items still waiting to go out. */
const GOING_OUT = new Set<OrderBox>(['intl', 'cod', 'pickup', 'reseller']);
// Outsource queue: joins the liver and the date in one group key.
const LIVER_SEP = '\u0001';

function agingHours(dateStr?: string): number {
  if (!dateStr) return 0;
  const d = parseDateRobust(dateStr);
  if (!d) return 0;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60));
}

function AgingLabel({ dateStr, warnAfterHours }: { dateStr?: string; warnAfterHours: number }) {
  const hours = agingHours(dateStr);
  const days = Math.floor(hours / 24);
  const isUrgent = hours >= warnAfterHours;
  if (!dateStr) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 border ml-1 rounded ${isUrgent ? 'text-destructive bg-destructive/10 border-destructive/40' : 'text-muted-foreground bg-muted border-border'}`}>
      {isUrgent && <AlertTriangle className="h-2.5 w-2.5" />}
      {days === 0 ? 'today' : `${days}d`}
    </span>
  );
}

const customerKey = (r: DatabaseRowType) => (r.minerName || '').trim().toLowerCase();

/** Each customer's most recent live date within a list of items. */
function latestLiveDateByCustomer(list: DatabaseRowType[]): Map<string, string | undefined> {
  const best = new Map<string, { t: number; date?: string }>();
  for (const r of list) {
    const t = r.dateOfLive ? (parseDateRobust(r.dateOfLive)?.getTime() ?? 0) : 0;
    const k = customerKey(r);
    const cur = best.get(k);
    if (!cur || t > cur.t) best.set(k, { t, date: r.dateOfLive });
  }
  return new Map([...best].map(([k, v]) => [k, v.date]));
}

/** One row in the work-queue list. */
function QueueButton({
  active, label, count, icon, urgent, onClick,
}: {
  active: boolean; label: string; count: number;
  icon?: React.ReactNode; urgent?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors shrink-0 md:w-full ${
        active ? 'bg-primary/15 text-primary' : 'text-foreground hover:bg-muted'
      }`}
    >
      {icon && <span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>}
      <span className="text-xs flex-1 truncate">{label}</span>
      <span className={`text-[10px] font-bold tabular-nums ${active ? 'text-primary' : 'text-muted-foreground'}`}>
        {count}
      </span>
      {urgent && count > 0 && (
        <span className="kt-attention h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
      )}
    </button>
  );
}

export default function DispatchBoard({ records, searchQuery, onSearchChange, onUpdate, onBulkUpdate, userEmail, clientMilestones, onRefresh }: TabProps) {
  const [showReport, setShowReport] = useState(false);
  const [onlyPullout, setOnlyPullout] = useState(false);
  const [showCancelReport, setShowCancelReport] = useState(false);
  const [showReminders, setShowReminders] = useState(false);
  // Items a liver reported delivered / picked up: not overdue while Dispatch checks.
  const [reportedIds, setReportedIds] = useState<Set<number>>(new Set());
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const onOpenReportsChange = useCallback((ids: Set<number>) => {
    setReportedIds(ids);
    setReportsLoaded(true);
  }, []);
  const anyOverdue = computeOverdue(records).some(sec => sec.items.some(r => !reportedIds.has(r.id)));
  // The reminders pop up once, after the delivery reports loaded (so reported items don't count).
  const remindersAutoShown = useRef(false);
  useEffect(() => {
    if (!reportsLoaded || remindersAutoShown.current) return;
    remindersAutoShown.current = true;
    if (anyOverdue) setShowReminders(true);
  }, [reportsLoaded, anyOverdue]);

  // One queue per box (lib/fulfilment ORDER_BOXES), named like Crown's physical
  // boxes. Items still with Admin / Accounts (Pending, Waiting for…, on hold,
  // payment being verified) aren't in a box yet, so they stay off this board.
  const groups = useMemo(() => {
    const isWalkIn = (r: DatabaseRowType) => {
      const mos = (r.modeOfSale || '').toLowerCase().trim();
      return mos === 'in-store' || mos === 'walk-in' || mos === 'walk in';
    };
    const searched = applySearch(
      records.filter(r => String(r.status || '').trim() && !isWalkIn(r) && !isStillWithAdmin(r.status)
        && (!onlyPullout || /\bpull\s?out\b/i.test(r.status || ''))),
      searchQuery,
    );
    const buckets = new Map<OrderBox, DatabaseRowType[]>(ORDER_BOXES.map(b => [b.key, []]));
    for (const r of searched) buckets.get(orderBox(r))!.push(r);
    return new Map(ORDER_BOXES.map(b => {
      const list = buckets.get(b.key)!;
      // Shipped items are grouped by the day they shipped, not the live date.
      if (b.key === 'dispatched' || b.key === 'delivered') return [b.key, groupByPageDateMiner(list, shipmentDay)];
      // Cancelled / Returned: by the day it was cancelled.
      if (b.key === 'cancelled') return [b.key, groupByPageDateMiner(list, cancelDay)];
      // Waiting boxes: one card per customer with all their items (they go out
      // together, on one invoice), filed under the customer's latest live date.
      const latest = latestLiveDateByCustomer(list);
      const dateOf = (r: DatabaseRowType) => latest.get(customerKey(r));
      // Outsource: the outsource (e.g. JOLAI) first, then its liver, then the date.
      if (b.key === 'outsource') {
        const byOutsource = groupByPageDateMiner(list, r => `${liverKey(r.liverName) || 'No liver name'}${LIVER_SEP}${dateOf(r) ?? ''}`, outsourceName);
        for (const [out, dateMap] of byOutsource) {
          byOutsource.set(out, new Map([...dateMap.entries()].sort((x, y) => {
            const [lx, dx] = x[0].split(LIVER_SEP), [ly, dy] = y[0].split(LIVER_SEP);
            // Newest first; the sheet mixes date formats, so compare real dates (unknown last).
            const t = (d: string) => (d ? parseDateRobust(d)?.getTime() : undefined) ?? -Infinity;
            return lx.localeCompare(ly) || (t(dy) - t(dx) || 0);
          })));
        }
        return [b.key, byOutsource];
      }
      return [b.key, groupByPageDateMiner(list, dateOf)];
    }));
  }, [records, searchQuery, onlyPullout]);

  // Items waiting to go out, i.e. what the Pullout Report prints.
  const pulloutCount = useMemo(
    () => records.filter(r => String(r.status || '').trim() && !isStillWithAdmin(r.status) && GOING_OUT.has(orderBox(r))).length,
    [records],
  );

  // Which queue the right-hand pane is showing.
  const [queue, setQueue] = useState<string>('intl');

  // ─── Multi-select: tick items (or a whole card / queue) and set one status for all.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  // Cancelling asks for a reason first (the liver sees it on their tab).
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkCancelReason, setBulkCancelReason] = useState('');
  const toggleSelect = useCallback((ids: number[], on: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);
  const applyBulkStatus = async (cancelReason?: string) => {
    if (!bulkStatus || selected.size === 0) return;
    // Cancelled or returned: the reason is asked for first (the liver sees it).
    const cancelling = fulfilmentStage(bulkStatus) === 'excluded';
    if (cancelling && cancelReason === undefined) {
      setBulkCancelReason('');
      setBulkCancelOpen(true);
      return;
    }
    setBulkCancelOpen(false);
    const fields: Partial<DatabaseRowType> = cancelling
      ? { status: bulkStatus, cancelReason: (cancelReason ?? '').trim() }
      : { status: bulkStatus };
    const updates = [...selected].map(rowId => ({ rowId, fields }));
    setBulkSaving(true);
    try {
      if (onBulkUpdate) await onBulkUpdate(updates);
      else for (const u of updates) await onUpdate(u.rowId, u.fields);
      toast.success(`${updates.length} item${updates.length !== 1 ? 's' : ''} set to ${bulkStatus}`);
      setSelected(new Set());
      setBulkStatus('');
    } catch {
      toast.error('Could not update all items — please try again.');
    } finally {
      setBulkSaving(false);
    }
  };

  const BOX_ICONS: Record<OrderBox, React.ReactNode> = {
    outsource: <Handshake className="h-4 w-4" />,
    intl: <Plane className="h-4 w-4" />,
    cod: <Package className="h-4 w-4" />,
    pickup: <Store className="h-4 w-4" />,
    reseller: <ShoppingBag className="h-4 w-4" />,
    dispatched: <Truck className="h-4 w-4" />,
    delivered: <CheckCircle2 className="h-4 w-4" />,
    cancelled: <XCircle className="h-4 w-4" />,
  };
  const QUEUES = ORDER_BOXES.map(b => ({
    key: b.key as string,
    label: b.label,
    group: groups.get(b.key)!,
    icon: BOX_ICONS[b.key],
    urgent: GOING_OUT.has(b.key) && b.key !== 'reseller',
    warnAfter: undefined as number | undefined,
  }));

  const countItems = (g: Map<string, Map<string, Map<string, DatabaseRowType[]>>>) =>
    Array.from(g.values()).reduce((s, dm) =>
      s + Array.from(dm.values()).reduce((ss, mm) =>
        ss + Array.from(mm.values()).reduce((sss, v) => sss + v.length, 0), 0), 0);

  const getPageIcon = (page: string) => {
    if (page === 'MYK') return <Crown className="h-4 w-4 text-attention" />;
    if (page === 'Empire Gold By ETG') return <BookOpen className="h-4 w-4 text-primary" />;
    if (page === "Aliyah's Sterling Silver Collection") return <Gem className="h-4 w-4 text-hold" />;
    return <Layout className="h-4 w-4 text-muted-foreground" />;
  };

  // datePrefix says what the header date is: when it shipped, or the customer's latest order.
  const renderGroupedRecords = (groupedData: Map<string, Map<string, Map<string, DatabaseRowType[]>>>, agingWarnHours = 0, datePrefix = 'Latest order:') => {
    if (groupedData.size === 0) {
      return <p className="text-xs text-muted-foreground px-1 py-2">No items in this category.</p>;
    }
    return Array.from(groupedData.entries()).map(([page, dateMap]) => {
      const totalItems = Array.from(dateMap.values()).reduce((s, m) => s + Array.from(m.values()).reduce((ss, v) => ss + v.length, 0), 0);
      return (
        <div key={page} className="mb-4">
          <div className="flex items-center gap-2 mb-2 py-1.5 px-3 bg-muted/50 border border-border rounded">
            {getPageIcon(page)}
            <h3 className="font-cinzel text-xs tracking-wide uppercase text-primary">{page}</h3>
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-bold px-2 py-0.5 bg-primary/10 text-primary rounded">{totalItems}</span>
          </div>
          <div className="pl-2 sm:pl-3 space-y-1.5">
            {Array.from(dateMap.entries()).map(([dateKey, minerMap], i, all) => {
              // Outsource queue: the date key also carries the liver; her name
              // heads her dates.
              const [liver, date] = dateKey.includes(LIVER_SEP) ? dateKey.split(LIVER_SEP) : ['', dateKey];
              const newLiver = !!liver && (i === 0 || !all[i - 1][0].startsWith(liver + LIVER_SEP));
              const allItems = Array.from(minerMap.values()).flat();
              const maxAge = allItems.reduce((m, r) => Math.max(m, agingHours(r.dateOfLive)), 0);
              const isUrgent = agingWarnHours > 0 && maxAge >= agingWarnHours;
              const agingEl = agingWarnHours > 0 ? <AgingLabel dateStr={allItems[0]?.dateOfLive} warnAfterHours={agingWarnHours} /> : null;
              return (
                <Fragment key={`${dateKey}-${searchQuery ? 'search' : ''}`}>
                {newLiver && (
                  <p className="pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                    <span className="font-normal normal-case text-muted-foreground">Liver </span>{liver}
                  </p>
                )}
                <CollapsibleGroup label={!date || date === 'Unknown Date' ? 'Unknown Date' : `${datePrefix} ${formatDate(date)}`} colorClass={isUrgent ? 'text-destructive' : 'text-muted-foreground'} lineClass={isUrgent ? 'bg-destructive/30' : 'bg-border/40'} indent defaultOpen={!!searchQuery.trim()} labelSuffix={agingEl}>
                  {Array.from(minerMap.entries()).map(([miner, items]) => (
                    <DispatchClientCard
                      key={miner}
                      minerName={miner}
                      records={items}
                      allRecords={records}
                      onUpdate={onUpdate}
                      userEmail={userEmail}
                      onRefresh={onRefresh}
                      clientMilestones={clientMilestones}
                      selectedIds={selected}
                      onSelect={toggleSelect}
                      highlight={searchQuery}
                    />
                  ))}
                </CollapsibleGroup>
                </Fragment>
              );
            })}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader
        title="Dispatch Board"
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        rightContent={
          <div className="flex items-center gap-2">
            {anyOverdue && (
              <Button
                variant="outline"
                size="sm"
                className="border-warning/50 text-warning text-xs h-8 relative"
                onClick={() => setShowReminders(true)}
                title="Courier & Pullout Reminders"
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                Reminders
                <span className="kt-attention absolute -top-1 -right-1 h-2.5 w-2.5 bg-destructive rounded-full" />
              </Button>
            )}
            <Button variant="outline" size="sm" className="text-xs h-8 font-cinzel uppercase tracking-wider" onClick={() => setShowReport(true)}>
              <ClipboardList className="h-3.5 w-3.5 mr-1" />
              Report ({pulloutCount})
            </Button>
          </div>
        }
      />

      <PulloutRequestsPanel records={records} onRefresh={onRefresh} />
      <DeliveryReportsPanel records={records} onRefresh={onRefresh} onOpenReportsChange={onOpenReportsChange} />
      <div className="px-4 pt-4">
        <Button size="sm" variant={onlyPullout ? 'default' : 'outline'} aria-pressed={onlyPullout}
          onClick={() => { setOnlyPullout(v => !v); setSelected(new Set()); }}>
          {onlyPullout ? 'For Pullout only — show all' : 'Filter: For Pullout'}
        </Button>
        {onlyPullout && <p className="text-xs text-muted-foreground mt-2">Pullout items stay in their delivery boxes. Choose a box to prepare collection.</p>}
      </div>

      {/* Work queue: pick a queue on the left, work it on the right. Replaces the
          six stacked accordions — one click instead of expand/collapse, and the
          customer's courier statuses finally have somewhere to live. */}
      <div className="px-4 pt-4 grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)] gap-4 items-start">

        {/* Queue list — horizontal scroller on phones, sidebar on desktop */}
        <div className="md:sticky md:top-24 rounded-xl border border-border bg-card p-2 overflow-x-auto">
          <p className="hidden md:block text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-1.5">
            Work queue
          </p>
          <div className="kt-stagger flex md:flex-col gap-1 min-w-max md:min-w-0">
            {QUEUES.map(q => (
              <QueueButton
                key={q.key}
                active={queue === q.key}
                icon={q.icon}
                label={q.label}
                count={countItems(q.group)}
                urgent={q.urgent}
                onClick={() => setQueue(q.key)}
              />
            ))}
          </div>

        </div>

        {/* Selected queue */}
        <div className="min-w-0">
          {(() => {
            const built = QUEUES.find(q => q.key === queue) ?? QUEUES[0];
            const group = built.group;
            const total = group ? countItems(group) : 0;
            return (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-cinzel text-sm text-foreground truncate">{built.label}</h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {total} item{total !== 1 ? 's' : ''}
                  </span>
                  {built.key === 'cancelled' && (
                    <Button variant="outline" size="sm" className="h-7 text-xs ml-auto" onClick={() => setShowCancelReport(true)}>
                      <Printer className="h-3.5 w-3.5 mr-1" />Print report
                    </Button>
                  )}
                  {total > 0 && (() => {
                    const ids = Array.from(group.values()).flatMap(dm => Array.from(dm.values()).flatMap(mm => Array.from(mm.values()).flat())).map(r => r.id);
                    const allOn = ids.every(id => selected.has(id));
                    return (
                      <Button variant="ghost" size="sm" className={`h-7 text-xs ${built.key === 'cancelled' ? '' : 'ml-auto'}`} onClick={() => toggleSelect(ids, !allOn)}>
                        <CheckSquare className="h-3.5 w-3.5 mr-1" />{allOn ? 'Unselect all' : 'Select all'}
                      </Button>
                    );
                  })()}
                </div>
                {group && total > 0 ? (
                  renderGroupedRecords(group, built.warnAfter, built.key === 'dispatched' || built.key === 'delivered' ? 'Shipped' : built.key === 'cancelled' ? 'Cancelled' : 'Latest order:')
                ) : (
                  <div className="text-center py-16 border border-dashed border-border rounded-xl">
                    <p className="text-sm text-muted-foreground">Nothing in this queue.</p>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Bulk status bar — shows while items are ticked */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-card shadow-lg px-3 py-2 max-w-[calc(100vw-2rem)]">
          <span className="text-xs font-semibold text-primary">{selected.size} selected</span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Set status to…" /></SelectTrigger>
            <SelectContent>
              {getEffectiveStatuses('dispatch').map(st => <SelectItem key={st} value={st} className="text-xs">{st}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 text-xs" disabled={!bulkStatus || bulkSaving} onClick={() => applyBulkStatus()}>
            {bulkSaving ? 'Saving…' : 'Apply'}
          </Button>
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Dialog open={bulkCancelOpen} onOpenChange={setBulkCancelOpen}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>{/^cancel/i.test(bulkStatus) ? 'Cancel' : `Set to ${bulkStatus}:`} {selected.size} item{selected.size !== 1 ? 's' : ''}?</DialogTitle>
          </DialogHeader>
          <CancelReasonField value={bulkCancelReason} onChange={setBulkCancelReason} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setBulkCancelOpen(false)}>Keep them</Button>
            <Button size="sm" className="bg-destructive text-destructive-foreground" onClick={() => applyBulkStatus(bulkCancelReason)}>
              {/^cancel/i.test(bulkStatus) ? 'Cancel items' : `Set to ${bulkStatus}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {showReport && <PulloutReport records={records} exclude={reportedIds} onClose={() => setShowReport(false)} />}
      {showCancelReport && <CancelReport records={records} onClose={() => setShowCancelReport(false)} />}

      {/* Courier & Pullout Reminders Dialog */}
      {showReminders && (
        <RemindersDialog records={records} exclude={reportedIds} title="Courier & Pullout Reminders" onClose={() => setShowReminders(false)} />
      )}
    </div>
  );
}
