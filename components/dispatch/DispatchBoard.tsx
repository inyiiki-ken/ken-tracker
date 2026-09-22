"use client";

import { useMemo, useState } from 'react';
import { ClipboardList, Package, Truck, Layout, Crown, BookOpen, XCircle, PauseCircle, ShieldCheck, CheckCircle2, AlertTriangle, Gem } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TabProps, DatabaseRowType } from '@/types';
import { applySearch, groupByPageDateMiner, formatDate } from '@/lib/formatters';
import CollapsibleGroup from '@/components/CollapsibleGroup';
import TabHeader from '@/components/TabHeader';
import DispatchClientCard from './DispatchClientCard';
import PulloutReport from './PulloutReport';
import { parseDateRobust } from '@/lib/calculations';

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

/** Normalize legacy 'Dispatch' status to 'For Pullout' for filtering/grouping only — never write back */
const ns = (s: string) => s === 'Dispatch' ? 'For Pullout' : s;

function hasDispatchReminders(records: DatabaseRowType[]): boolean {
  for (const r of records) {
    const s = r.status || '';
    if (s === 'Dispatched') {
      const h = r.dateOfLive ? Math.floor((Date.now() - (parseDateRobust(r.dateOfLive)?.getTime() || Date.now())) / (1000 * 60 * 60)) : 0;
      if (h >= 48) return true;
    }
    if (s === 'For Pullout' || s === 'Dispatch') {
      const h = r.dateOfLive ? Math.floor((Date.now() - (parseDateRobust(r.dateOfLive)?.getTime() || Date.now())) / (1000 * 60 * 60)) : 0;
      if (h >= 24) return true;
    }
  }
  return false;
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

export default function DispatchBoard({ records, searchQuery, onSearchChange, onUpdate, userEmail, clientMilestones }: TabProps) {
  const [showReport, setShowReport] = useState(false);
  const [showReminders, setShowReminders] = useState(true);

  const { forPullout, onHold, paymentVerif, dispatched, delivered, cancelled } = useMemo(() => {
    const filtered = records.filter(r => {
      const s = ns(r.status || '');
      if (!['For Pullout', 'Dispatched', 'Delivered', 'Given to Shop', 'Paid/DP but Item Hold', 'Payment for Verification', 'Cancelled'].includes(s)) return false;
      const mos = (r.modeOfSale || '').toLowerCase().trim();
      if (mos === 'in-store' || mos === 'walk-in' || mos === 'walk in') return false;
      return true;
    });
    const searched = applySearch(filtered, searchQuery);
    return {
      forPullout: groupByPageDateMiner(searched.filter(r => ns(r.status || '') === 'For Pullout')),
      onHold: groupByPageDateMiner(searched.filter(r => ns(r.status || '') === 'Paid/DP but Item Hold')),
      paymentVerif: groupByPageDateMiner(searched.filter(r => ns(r.status || '') === 'Payment for Verification')),
      dispatched: groupByPageDateMiner(searched.filter(r => ns(r.status || '') === 'Dispatched')),
      delivered: groupByPageDateMiner(searched.filter(r => ns(r.status || '') === 'Delivered' || ns(r.status || '') === 'Given to Shop')),
      cancelled: groupByPageDateMiner(searched.filter(r => ns(r.status || '') === 'Cancelled')),
    };
  }, [records, searchQuery]);

  const pulloutCount = useMemo(() => records.filter(r => ns(r.status || '') === 'For Pullout').length, [records]);

  /**
   * Fulfilment statuses that exist in THIS customer's data but aren't one of the
   * six built-in sections — the "Given to Courier …" values, Picked Up, Reseller.
   * They previously had nowhere to appear on this board.
   */
  const extraQueues = useMemo(() => {
    const BUILT_IN = new Set(['For Pullout', 'Dispatched', 'Delivered', 'Given to Shop', 'Paid/DP but Item Hold', 'Payment for Verification', 'Cancelled']);
    const counts = new Map<string, number>();
    for (const r of records) {
      const st = ns(r.status || '').trim();
      if (!st || BUILT_IN.has(st)) continue;
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));
  }, [records]);

  const extraGroups = useMemo(() => {
    const out = new Map<string, ReturnType<typeof groupByPageDateMiner>>();
    for (const { status } of extraQueues) {
      out.set(status, groupByPageDateMiner(applySearch(records.filter(r => ns(r.status || '') === status), searchQuery)));
    }
    return out;
  }, [records, extraQueues, searchQuery]);

  // Which queue the right-hand pane is showing.
  const [queue, setQueue] = useState<string>('For Pullout');

  const QUEUES: {
    key: string; label: string; group: Map<string, Map<string, Map<string, DatabaseRowType[]>>>;
    icon: React.ReactNode; urgent?: boolean; warnAfter?: number;
  }[] = [
    { key: 'For Pullout', label: 'For Pullout', group: forPullout, icon: <Package className="h-4 w-4" />, urgent: true },
    { key: 'Paid/DP but Item Hold', label: 'Paid/DP but On Hold', group: onHold, icon: <PauseCircle className="h-4 w-4" />, warnAfter: 72 },
    { key: 'Payment for Verification', label: 'Payment for Verification', group: paymentVerif, icon: <ShieldCheck className="h-4 w-4" />, warnAfter: 24 },
    { key: 'Dispatched', label: 'Dispatched', group: dispatched, icon: <Truck className="h-4 w-4" /> },
    { key: 'Delivered', label: 'Delivered', group: delivered, icon: <CheckCircle2 className="h-4 w-4" /> },
    { key: 'Cancelled', label: 'Cancelled', group: cancelled, icon: <XCircle className="h-4 w-4" /> },
  ];

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

  const renderGroupedRecords = (groupedData: Map<string, Map<string, Map<string, DatabaseRowType[]>>>, agingWarnHours = 0) => {
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
            {Array.from(dateMap.entries()).map(([date, minerMap]) => {
              const allItems = Array.from(minerMap.values()).flat();
              const maxAge = allItems.reduce((m, r) => Math.max(m, agingHours(r.dateOfLive)), 0);
              const isUrgent = agingWarnHours > 0 && maxAge >= agingWarnHours;
              const agingEl = agingWarnHours > 0 ? <AgingLabel dateStr={allItems[0]?.dateOfLive} warnAfterHours={agingWarnHours} /> : null;
              return (
                <CollapsibleGroup key={date} label={formatDate(date)} colorClass={isUrgent ? 'text-destructive' : 'text-muted-foreground'} lineClass={isUrgent ? 'bg-destructive/30' : 'bg-border/40'} indent defaultOpen={false} labelSuffix={agingEl}>
                  {Array.from(minerMap.entries()).map(([miner, items]) => (
                    <DispatchClientCard
                      key={miner}
                      minerName={miner}
                      records={items}
                      allRecords={records}
                      onUpdate={onUpdate}
                      userEmail={userEmail}
                      clientMilestones={clientMilestones}
                    />
                  ))}
                </CollapsibleGroup>
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
            {hasDispatchReminders(records) && (
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

          {extraQueues.length > 0 && (
            <>
              <div className="hidden md:block h-px bg-border my-2" />
              <p className="hidden md:block text-[10px] uppercase tracking-widest text-muted-foreground px-2 py-1.5">
                Couriers &amp; other
              </p>
              <div className="flex md:flex-col gap-1 min-w-max md:min-w-0 mt-1 md:mt-0">
                {extraQueues.map(({ status, count }) => (
                  <QueueButton
                    key={status}
                    active={queue === status}
                    label={status}
                    count={count}
                    onClick={() => setQueue(status)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Selected queue */}
        <div className="min-w-0">
          {(() => {
            const built = QUEUES.find(q => q.key === queue);
            const group = built ? built.group : extraGroups.get(queue);
            const total = group ? countItems(group) : 0;
            return (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-cinzel text-sm text-foreground truncate">{built ? built.label : queue}</h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {total} item{total !== 1 ? 's' : ''}
                  </span>
                </div>
                {group && total > 0 ? (
                  renderGroupedRecords(group, built?.warnAfter)
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

      {showReport && <PulloutReport records={records} onClose={() => setShowReport(false)} />}

      {/* Courier & Pullout Reminders Dialog */}
      {showReminders && (
        <DispatchRemindersDialog records={records} onClose={() => setShowReminders(false)} />
      )}
    </div>
  );
}

// ── Dispatch Reminders Dialog ──────────────────────────────────────────────────

/** One card per CLIENT (not per item) — groups a client's overdue items together
 * so the same name doesn't repeat dozens of times. */
interface ReminderGroup {
  name: string;
  items: DatabaseRowType[];
  oldestHours: number;
  page: string;
  date?: string;
}

function groupRemindersByClient(list: DatabaseRowType[]): ReminderGroup[] {
  const map = new Map<string, ReminderGroup>();
  for (const r of list) {
    const name = (r.minerName || '—').trim();
    const key = name.toLowerCase();
    const hrs = agingHours(r.dateOfLive);
    const g = map.get(key);
    if (g) {
      g.items.push(r);
      if (hrs > g.oldestHours) { g.oldestHours = hrs; g.date = r.dateOfLive; }
    } else {
      map.set(key, { name, items: [r], oldestHours: hrs, page: r.page || '', date: r.dateOfLive });
    }
  }
  // Most overdue client first
  return [...map.values()].sort((a, b) => b.oldestHours - a.oldestHours);
}

/** A grouped reminder card: client name once, all their items listed under it. */
function ReminderClientCard({ group, urgentAfterHours, accent }: {
  group: ReminderGroup;
  urgentAfterHours: number;
  accent: 'orange' | 'purple';
}) {
  const days = Math.floor(group.oldestHours / 24);
  const isUrgent = group.oldestHours >= urgentAfterHours;
  const accentCls = accent === 'orange'
    ? 'bg-warning/15 text-warning border-warning/30'
    : 'bg-hold/15 text-hold border-hold/30';
  return (
    <div className={`rounded-lg border p-3 ${isUrgent ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-secondary/20'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate">
            {group.name}
            <span className="text-muted-foreground font-normal ml-1.5">
              · {group.items.length} item{group.items.length !== 1 ? 's' : ''}
            </span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            {group.page || '—'} · oldest {group.date ? formatDate(group.date) : '—'}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {group.items.map((it) => (
              <li key={it.id} className="text-[10px] text-muted-foreground flex items-baseline gap-1.5">
                <span className="text-muted-foreground/60">•</span>
                <span className="truncate">{it.itemDescription || '—'}</span>
                <span className="ml-auto shrink-0 text-muted-foreground/70">
                  {Math.floor(agingHours(it.dateOfLive) / 24)}d
                </span>
              </li>
            ))}
          </ul>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${isUrgent ? 'bg-destructive/15 text-destructive border-destructive/30 animate-pulse' : accentCls}`}>
          {isUrgent ? 'ACTION NEEDED' : `${days}d ago`}
        </span>
      </div>
    </div>
  );
}

function DispatchRemindersDialog({ records, onClose }: { records: DatabaseRowType[]; onClose: () => void }) {
  const courierOverdue = records.filter(r => {
    if (r.status !== 'Dispatched') return false;
    const h = r.dateOfLive ? Math.floor((Date.now() - (parseDateRobust(r.dateOfLive)?.getTime() || Date.now())) / (1000 * 60 * 60)) : 0;
    return h >= 48;
  }).sort((a, b) => agingHours(a.dateOfLive) - agingHours(b.dateOfLive)).reverse();

  const pulloutOverdue = records.filter(r => {
    const s = ns(r.status || '');
    if (s !== 'For Pullout') return false;
    const h = r.dateOfLive ? Math.floor((Date.now() - (parseDateRobust(r.dateOfLive)?.getTime() || Date.now())) / (1000 * 60 * 60)) : 0;
    return h >= 24;
  }).sort((a, b) => agingHours(a.dateOfLive) - agingHours(b.dateOfLive)).reverse();

  // One card per client instead of one per item.
  const courierGroups = groupRemindersByClient(courierOverdue);
  const pulloutGroups = groupRemindersByClient(pulloutOverdue);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Courier & Pullout Reminders
          </DialogTitle>
        </DialogHeader>

        {courierOverdue.length === 0 && pulloutOverdue.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">✅ No overdue items. All clear!</p>
        )}

        {courierOverdue.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-warning uppercase tracking-wider flex items-center gap-2">
              <Truck className="h-3.5 w-3.5" /> Dispatched — Courier Follow-Up ({courierGroups.length} client{courierGroups.length !== 1 ? 's' : ''} · {courierOverdue.length} items)
            </h3>
            <p className="text-[10px] text-muted-foreground">Items dispatched but not yet delivered after 48+ hours.</p>
            {courierGroups.map(g => (
              <ReminderClientCard key={g.name} group={g} urgentAfterHours={72} accent="orange" />
            ))}
          </div>
        )}

        {pulloutOverdue.length > 0 && (
          <div className="space-y-2 mt-4">
            <h3 className="text-xs font-bold text-hold uppercase tracking-wider flex items-center gap-2">
              <Package className="h-3.5 w-3.5" /> For Pullout — Waiting 24h+ ({pulloutGroups.length} client{pulloutGroups.length !== 1 ? 's' : ''} · {pulloutOverdue.length} items)
            </h3>
            <p className="text-[10px] text-muted-foreground">Items marked for pullout but still waiting after 24+ hours.</p>
            {pulloutGroups.map(g => (
              <ReminderClientCard key={g.name} group={g} urgentAfterHours={72} accent="purple" />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
