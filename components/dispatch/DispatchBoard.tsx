"use client";

import { useMemo, useState } from 'react';
import { ClipboardList, Package, Truck, ShoppingBag, Layout, Crown, BookOpen, XCircle, CheckCircle2, AlertTriangle, Gem, Plane, Store } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TabProps, DatabaseRowType } from '@/types';
import { applySearch, groupByPageDateMiner, formatDate } from '@/lib/formatters';
import CollapsibleGroup from '@/components/CollapsibleGroup';
import TabHeader from '@/components/TabHeader';
import DispatchClientCard from './DispatchClientCard';
import PulloutReport from './PulloutReport';
import RemindersDialog from '@/components/RemindersDialog';
import { computeOverdue } from '@/lib/reminders';
import { parseDateRobust } from '@/lib/calculations';
import { ORDER_BOXES, OrderBox, orderBox, isStillWithAdmin, shipmentDay } from '@/lib/fulfilment';

/** Boxes of items still waiting to go out. */
const GOING_OUT = new Set<OrderBox>(['intl', 'cod', 'pickup', 'reseller']);

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
  const [showReminders, setShowReminders] = useState(() => computeOverdue(records).length > 0);

  // One queue per box (lib/fulfilment ORDER_BOXES), named like Crown's physical
  // boxes. Items still with Admin / Accounts (Pending, Waiting for…, on hold,
  // payment being verified) aren't in a box yet, so they stay off this board.
  const groups = useMemo(() => {
    const isWalkIn = (r: DatabaseRowType) => {
      const mos = (r.modeOfSale || '').toLowerCase().trim();
      return mos === 'in-store' || mos === 'walk-in' || mos === 'walk in';
    };
    const searched = applySearch(
      records.filter(r => String(r.status || '').trim() && !isWalkIn(r) && !isStillWithAdmin(r.status)),
      searchQuery,
    );
    const buckets = new Map<OrderBox, DatabaseRowType[]>(ORDER_BOXES.map(b => [b.key, []]));
    for (const r of searched) buckets.get(orderBox(r))!.push(r);
    return new Map(ORDER_BOXES.map(b => [
      b.key,
      // Shipped items are grouped by the day they shipped, not the live date.
      b.key === 'dispatched' || b.key === 'delivered'
        ? groupByPageDateMiner(buckets.get(b.key)!, shipmentDay)
        : groupByPageDateMiner(buckets.get(b.key)!),
    ]));
  }, [records, searchQuery]);

  // Items waiting to go out, i.e. what the Pullout Report prints.
  const pulloutCount = useMemo(
    () => records.filter(r => String(r.status || '').trim() && !isStillWithAdmin(r.status) && GOING_OUT.has(orderBox(r))).length,
    [records],
  );

  // Which queue the right-hand pane is showing.
  const [queue, setQueue] = useState<string>('intl');

  const BOX_ICONS: Record<OrderBox, React.ReactNode> = {
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
            {computeOverdue(records).length > 0 && (
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
                </div>
                {group && total > 0 ? (
                  renderGroupedRecords(group, built.warnAfter)
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
        <RemindersDialog records={records} title="Courier & Pullout Reminders" onClose={() => setShowReminders(false)} />
      )}
    </div>
  );
}
