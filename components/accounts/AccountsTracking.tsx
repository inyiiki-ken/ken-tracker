"use client";

import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { TabProps, DatabaseRowType } from '@/types';
import { applySearch, groupByPageDateMiner, formatDate } from '@/lib/formatters';
import CollapsibleGroup from '@/components/CollapsibleGroup';
import { calcRemainingBalance, parseDateRobust } from '@/lib/calculations';
import { startOfWeek, startOfMonth, subMonths } from 'date-fns';
import TabHeader from '@/components/TabHeader';
import AccountsClientCard from './AccountsClientCard';
import {
  ChevronDown, Plus, Calendar, TrendingDown, Package, Users,
  ShieldCheck, CheckCircle2, Clock, Truck,
} from 'lucide-react';
import AddClientModal from './AddClientModal';

// ─── ACCOUNTS SCOPE ───────────────────────────────────────────────────────────
const ACCOUNTS_STATUSES = [
  'Delivered', 'Given to Shop', 'Paid/DP but Item Hold',
  'Dispatched', 'Payment for Verification',
];

function isAccountsRelevant(r: DatabaseRowType): boolean {
  const status = r.status || '';
  if (status === 'Cancelled' || status === 'Returned Item') return false;
  if (ACCOUNTS_STATUSES.includes(status)) return true;
  return false;
}

type DateRange = 'all' | 'week' | 'month' | '3months' | 'custom';
const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' }, { key: '3months', label: '3 Mo' },
  { key: 'custom', label: 'Custom' },
];

// ─── Section header component ─────────────────────────────────────────────────
interface SectionHeaderProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  pages: number;
  balance?: number;
  expanded: boolean;
  onToggle: () => void;
  colorClass: string;
  borderClass: string;
  bgClass: string;
}

function SectionHeader({ icon, label, count, pages, balance, expanded, onToggle, colorClass, borderClass, bgClass }: SectionHeaderProps) {
  return (
    <button
      className={`flex w-full items-center gap-2 mb-3 p-3 rounded-lg border ${borderClass} ${bgClass} text-left focus:outline-none hover:opacity-90 transition-opacity`}
      onClick={onToggle}
    >
      <span className={`shrink-0 ${colorClass}`}>{icon}</span>
      <span className={`font-cinzel text-sm font-bold ${colorClass}`} style={{ letterSpacing: '0.15em' }}>{label}</span>
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${colorClass} bg-white/5 border-current/20`}>
        {pages > 1 ? `${pages} pages · ` : ''}{count} item{count !== 1 ? 's' : ''}
      </span>
      {balance !== undefined && balance > 0 && (
        <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full border border-destructive/20">
          AED {balance.toFixed(0)}
        </span>
      )}
      {/* Divider takes the section's own colour. This used to sniff the class
          string for "amber"/"orange"/etc., which silently broke the moment the
          palette changed — derive it instead. */}
      <div className={`h-px flex-1 opacity-40 bg-current ${colorClass}`} />
      <ChevronDown className={`h-4 w-4 shrink-0 ${colorClass} transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
  );
}

// ─── Group renderer ───────────────────────────────────────────────────────────
function RenderGroups({ groups, records, onUpdate }: {
  groups: Map<string, Map<string, Map<string, DatabaseRowType[]>>>;
  records: DatabaseRowType[];
  onUpdate: TabProps['onUpdate'];
}) {
  if (groups.size === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
        No records in this section.
      </div>
    );
  }
  return (
    <div>
      {Array.from(groups.entries()).map(([page, dateMap]) => (
        <CollapsibleGroup key={page} label={page} colorClass="text-primary/70" lineClass="bg-primary/10" defaultOpen={false}>
          {Array.from(dateMap.entries()).map(([date, minerMap]) => (
            <CollapsibleGroup key={date} label={formatDate(date)} colorClass="text-muted-foreground" lineClass="bg-border/40" indent defaultOpen={false}>
              <div className="space-y-3">
                {Array.from(minerMap.entries()).map(([minerName, items]) => (
                  <AccountsClientCard key={minerName} minerName={minerName} records={items} allRecords={records} onUpdate={onUpdate} />
                ))}
              </div>
            </CollapsibleGroup>
          ))}
        </CollapsibleGroup>
      ))}
    </div>
  );
}

const countItems = (g: Map<string, Map<string, Map<string, DatabaseRowType[]>>>) =>
  Array.from(g.values()).reduce((s, dm) =>
    s + Array.from(dm.values()).reduce((ss, mm) =>
      ss + Array.from(mm.values()).reduce((sss, v) => sss + v.length, 0), 0), 0);

const sumBalance = (records: DatabaseRowType[]) =>
  records.reduce((s, r) => s + Math.max(0, calcRemainingBalance(r)), 0);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AccountsTracking({ records, searchQuery, onSearchChange, onUpdate, userFirstName, userEmail, onRefresh }: TabProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [verifExpanded, setVerifExpanded] = useState(true);
  const [dispatchedExpanded, setDispatchedExpanded] = useState(true);
  const [onHoldExpanded, setOnHoldExpanded] = useState(true);
  const [deliveredExpanded, setDeliveredExpanded] = useState(true);
  const [liverFilter, setLiverFilter] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const liverNames = useMemo(() => {
    const names = Array.from(new Set(
      records.filter(isAccountsRelevant).map(r => r.liverName?.trim().toUpperCase()).filter(Boolean)
    )) as string[];
    return names.sort();
  }, [records]);

  const filteredRecords = useMemo(() => {
    let base = records.filter(isAccountsRelevant);
    if (liverFilter !== 'all') base = base.filter(r => r.liverName?.trim().toUpperCase() === liverFilter);
    if (dateRange !== 'all') {
      const now = new Date();
      let from: Date;
      if (dateRange === 'week') from = startOfWeek(now, { weekStartsOn: 1 });
      else if (dateRange === 'month') from = startOfMonth(now);
      else if (dateRange === '3months') from = subMonths(now, 3);
      else from = customFrom || new Date(0);
      const to = dateRange === 'custom' ? customTo : undefined;
      base = base.filter(r => {
        // For delivered items, attribute to delivery date; otherwise use live date
        const isDelivered = r.status === 'Delivered' || r.status === 'Given to Shop';
        const dateStr = (isDelivered && r.deliveredDate) ? r.deliveredDate : r.dateOfLive;
        if (!dateStr) return false;
        const d = parseDateRobust(dateStr);
        if (!d) return false;
        if (d.getTime() < from.getTime()) return false;
        if (to) { const end = new Date(to); end.setHours(23, 59, 59, 999); if (d.getTime() > end.getTime()) return false; }
        return true;
      });
    }
    return base;
  }, [records, liverFilter, dateRange, customFrom, customTo]);

  // ── Split into FIVE clearly separated status sections ──────────────────────
  const sections = useMemo(() => {
    const searched = applySearch(filteredRecords, searchQuery);
    const active: DatabaseRowType[] = [];
    const cleared: DatabaseRowType[] = [];

    searched.forEach(r => {
      const remStatus = (r.remittanceStatus || '').toLowerCase().trim();
      const remittanceConfirmed = remStatus.includes('secured') || remStatus.includes('received');
      const balanceZero = calcRemainingBalance(r) <= 0;
      const isPendingRemittance = remStatus === '' || remStatus === 'pending' || remStatus === 'n/a';
      const isCleared = remittanceConfirmed || (balanceZero && !isPendingRemittance);
      if (isCleared) cleared.push(r);
      else active.push(r);
    });

    // ── Section 1: Payment for Verification ──────────────────────────────
    const verif = active.filter(r => r.status === 'Payment for Verification');

    // ── Section 2: Dispatched (in transit, balance still outstanding) ─────
    const dispatched = active.filter(r => r.status === 'Dispatched');

    // ── Section 3: Paid/DP but Item Hold (layaway installments) ──────────
    const onHold = active.filter(r => r.status === 'Paid/DP but Item Hold');

    // ── Section 4: Delivered / Given to Shop ─────────────────────────────
    const delivered = active.filter(r => r.status === 'Delivered' || r.status === 'Given to Shop');

    return {
      verifGroups: groupByPageDateMiner(verif),
      dispatchedGroups: groupByPageDateMiner(dispatched),
      onHoldGroups: groupByPageDateMiner(onHold),
      deliveredGroups: groupByPageDateMiner(delivered),
      clearedGroups: groupByPageDateMiner(cleared),
      activeRecords: active,
      verifRecords: verif,
      dispatchedRecords: dispatched,
      onHoldRecords: onHold,
      deliveredRecords: delivered,
    };
  }, [filteredRecords, searchQuery]);

  const {
    verifGroups, dispatchedGroups, onHoldGroups, deliveredGroups, clearedGroups,
    activeRecords, verifRecords, dispatchedRecords, onHoldRecords, deliveredRecords,
  } = sections;

  const totalOutstanding = useMemo(() => sumBalance(activeRecords), [activeRecords]);
  const activeClientCount = useMemo(() => new Set(activeRecords.map(r => r.minerName || '').filter(Boolean)).size, [activeRecords]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader
        title="Accounts Tracking"
        subtitle={`${activeClientCount} clients · AED ${totalOutstanding.toFixed(0)} outstanding`}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
      />

      <div className="px-4 pt-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-3">
          <Select value={liverFilter} onValueChange={setLiverFilter}>
            <SelectTrigger className="h-8 text-xs w-40 bg-background border-border">
              <SelectValue placeholder="All Livers" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-xs">All Livers</SelectItem>
              {liverNames.map(name => (
                <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-1 flex-wrap">
            {DATE_RANGES.map(r => (
              <Button
                key={r.key} size="sm"
                variant={dateRange === r.key ? 'default' : 'outline'}
                className={`text-xs h-8 px-2.5 ${dateRange === r.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                onClick={() => setDateRange(r.key)}
              >
                {r.key === 'custom' && <Calendar className="h-3 w-3 mr-1" />}
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {dateRange === 'custom' && (
          <div className="flex gap-2 mb-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs border-border h-8">
                  {customFrom ? formatDate(customFrom.toISOString()) : 'From date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-card border-border">
                <CalendarComponent mode="single" selected={customFrom} onSelect={setCustomFrom} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs border-border h-8">
                  {customTo ? formatDate(customTo.toISOString()) : 'To date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-card border-border">
                <CalendarComponent mode="single" selected={customTo} onSelect={setCustomTo} />
              </PopoverContent>
            </Popover>
          </div>
        )}

        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowAddModal(true)} className="text-xs h-9 shadow-sm font-cinzel uppercase tracking-wider">
            <Plus className="h-4 w-4 mr-1.5" /> Add Client
          </Button>
        </div>

        <Tabs defaultValue="active">
          <TabsList className="w-full mb-4 bg-secondary">
            <TabsTrigger value="active" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Outstanding ({activeRecords.length})
            </TabsTrigger>
            <TabsTrigger value="cleared" className="flex-1 text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Cleared ({clearedGroups.size})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active">
            {/* Summary Strip */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              <div className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider font-medium">Clients</span>
                </div>
                <span className="text-base font-bold text-foreground font-cinzel">{activeClientCount}</span>
              </div>
              <div className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Package className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider font-medium">Items</span>
                </div>
                <span className="text-base font-bold text-foreground font-cinzel">{activeRecords.length}</span>
              </div>
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-destructive/70">
                  <TrendingDown className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider font-medium">Due</span>
                </div>
                <span className="text-sm font-bold text-destructive font-cinzel leading-tight">
                  {totalOutstanding > 0 ? `AED ${totalOutstanding.toFixed(0)}` : 'AED 0'}
                </span>
              </div>
            </div>

            {/* ── SECTION 1: PAYMENT FOR VERIFICATION ── */}
            {verifGroups.size > 0 && (
              <div className="mb-4">
                <SectionHeader
                  icon={<ShieldCheck className="h-4 w-4" />}
                  label="PAYMENT FOR VERIFICATION"
                  count={countItems(verifGroups)}
                  pages={verifGroups.size}
                  balance={sumBalance(verifRecords)}
                  expanded={verifExpanded}
                  onToggle={() => setVerifExpanded(v => !v)}
                  colorClass="text-warning"
                  borderClass="border-warning/30"
                  bgClass="bg-warning/5"
                />
                {verifExpanded && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <RenderGroups groups={verifGroups} records={records} onUpdate={onUpdate} />
                  </div>
                )}
              </div>
            )}

            {/* ── SECTION 2: DISPATCHED (in transit, balance outstanding) ── */}
            {dispatchedGroups.size > 0 && (
              <div className="mb-4">
                <SectionHeader
                  icon={<Truck className="h-4 w-4" />}
                  label="DISPATCHED — IN TRANSIT"
                  count={countItems(dispatchedGroups)}
                  pages={dispatchedGroups.size}
                  balance={sumBalance(dispatchedRecords)}
                  expanded={dispatchedExpanded}
                  onToggle={() => setDispatchedExpanded(v => !v)}
                  colorClass="text-warning"
                  borderClass="border-warning/30"
                  bgClass="bg-warning/5"
                />
                {dispatchedExpanded && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <RenderGroups groups={dispatchedGroups} records={records} onUpdate={onUpdate} />
                  </div>
                )}
              </div>
            )}

            {/* ── SECTION 3: ON HOLD (Paid/DP but Item Hold) ── */}
            {onHoldGroups.size > 0 && (
              <div className="mb-4">
                <SectionHeader
                  icon={<Clock className="h-4 w-4" />}
                  label="ON HOLD — PAID / DP RECEIVED"
                  count={countItems(onHoldGroups)}
                  pages={onHoldGroups.size}
                  balance={sumBalance(onHoldRecords)}
                  expanded={onHoldExpanded}
                  onToggle={() => setOnHoldExpanded(v => !v)}
                  colorClass="text-info"
                  borderClass="border-info/30"
                  bgClass="bg-info/5"
                />
                {onHoldExpanded && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <RenderGroups groups={onHoldGroups} records={records} onUpdate={onUpdate} />
                  </div>
                )}
              </div>
            )}

            {/* ── SECTION 4: DELIVERED / GIVEN TO SHOP ── */}
            {deliveredGroups.size > 0 && (
              <div className="mb-4">
                <SectionHeader
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="DELIVERED / GIVEN TO SHOP"
                  count={countItems(deliveredGroups)}
                  pages={deliveredGroups.size}
                  balance={sumBalance(deliveredRecords)}
                  expanded={deliveredExpanded}
                  onToggle={() => setDeliveredExpanded(v => !v)}
                  colorClass="text-success"
                  borderClass="border-success/20"
                  bgClass="bg-success/5"
                />
                {deliveredExpanded && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                    <RenderGroups groups={deliveredGroups} records={records} onUpdate={onUpdate} />
                  </div>
                )}
              </div>
            )}

            {activeRecords.length === 0 && (
              <div className="text-center py-16 border border-dashed border-border rounded-xl">
                <CheckCircle2 className="h-8 w-8 text-success/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground font-medium">All clear! No outstanding balances.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="cleared">
            {clearedGroups.size === 0 ? (
              <div className="text-center py-16 border border-dashed border-border rounded-xl">
                <p className="text-sm text-muted-foreground">No cleared records yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <RenderGroups groups={clearedGroups} records={records} onUpdate={onUpdate} />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {showAddModal && (
        <AddClientModal
          onClose={() => setShowAddModal(false)}
          userFirstName={userFirstName}
          userEmail={userEmail}
          onRefresh={onRefresh}
          existingRecords={records}
        />
      )}
    </div>
  );
}
