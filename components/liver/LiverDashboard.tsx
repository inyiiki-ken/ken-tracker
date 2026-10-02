"use client";

import { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Package, Weight, DollarSign, Copy, Check, AlertTriangle, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabProps, DatabaseRowType } from '@/types';
import { customerKey, gramsLabel, groupByCustomer, pieceCount, sumGrams } from '@/lib/calculations';
import { applySearch, formatDate, formatDateShort } from '@/lib/formatters';
import TabHeader from '@/components/TabHeader';
import { StatCard } from '@/components/ui/dash';
import StatusBadge from '@/components/StatusBadge';
import { computeOverdue, dueFor, getReminderRules, lastPurchases } from '@/lib/reminders';
import RemindersDialog from '@/components/RemindersDialog';
import { PulloutPanel, CancelledItems } from './LiverPullout';
import { DeliveryPanel, recentlyRejected } from './LiverDeliveries';
import LiverCustomerSheet from './LiverCustomerSheet';
import { Highlight, NotesToggle, OutsourceTag, ShippedLine } from './LiverRowBits';
import {
  finishedAfterLoad, isOpenRequest, isOverdueRequest, isToPullOut, itemKey, itemsByKey, itemsFor, liverKey, pullOutOnLabel, todayISO,
  type PulloutRequest,
} from '@/lib/pulloutRequests';
import { requestTargetsLabel } from '@/lib/pulloutTargets';
import { dayKey, fulfilmentStage, isSold, soldDay } from '@/lib/fulfilment';
import { metalOf, type MetalKind } from '@/lib/metal';
import { aedLabel, collectForAED } from '@/lib/liverMoney';
import { isOpenReport, type DeliveryKind, type DeliveryReport } from '@/lib/deliveryReports';
import {
  DATE_RANGES, groupByDay, groupByStatus, inBounds, newestFirst, rangeBounds, statusOf, summariseLives,
  type DateRange, type StatusGroup,
} from '@/lib/liverSales';

/**
 * The overdue popup shows once per liver per day on this phone, even across
 * tabs, in-app browsers and relaunches (localStorage, not sessionStorage).
 */
function remindersSeenKey(liver: string): string {
  return `liverReminders:${liver}:${todayISO()}`;
}
// In-memory copy for when localStorage is blocked (private browsing).
const remindersSeenThisVisit = new Set<string>();
function remindersSeen(liver: string): boolean {
  const key = remindersSeenKey(liver);
  if (remindersSeenThisVisit.has(key)) return true;
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function markRemindersSeen(liver: string): void {
  const key = remindersSeenKey(liver);
  remindersSeenThisVisit.add(key);
  try {
    // Drop this liver's keys from earlier days so they don't pile up.
    const prefix = `liverReminders:${liver}:`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== key) localStorage.removeItem(k);
    }
    localStorage.setItem(key, '1');
  } catch { /* ignore */ }
}

/** Cancelled or returned: kept out of the KPIs and status groups (they have their own box). */
function isOut(r: DatabaseRowType): boolean {
  return fulfilmentStage(r.status) === 'excluded';
}

type MaterialFilter = 'all' | MetalKind;

const MATERIAL_FILTERS: { key: MaterialFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'gold', label: '🥇 Gold' },
  { key: 'silver', label: '🥈 Silver' },
  { key: 'other', label: 'Other' },
];

const LIVER_STORAGE_KEY = 'myDeals_selectedLiver';
// Rows shown at a time in a status group (phones stay quick).
const PAGE_ROWS = 30;
// "Due soon" on the Today card: due within this many hours.
const DUE_SOON_HOURS = 24;

/** "12.40g", plus "+ 2 pcs" when some items are sold by the piece. */
function weightLabel(rows: DatabaseRowType[]): string {
  const pcs = pieceCount(rows);
  return `${sumGrams(rows).toFixed(2)}g${pcs > 0 ? ` + ${pcs} pc${pcs !== 1 ? 's' : ''}` : ''}`;
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Status Section ───────────────────────────────────────────────────────────
function StatusSection({ group, open, onToggle, query, copyRow, copiedId, dueOf, onOpenCustomer, reported, customerRows }: {
  group: StatusGroup;
  open: boolean;
  onToggle: () => void;
  query: string;
  copyRow: (r: DatabaseRowType) => void;
  copiedId: number | null;
  dueOf: (r: DatabaseRowType) => Date | null;
  onOpenCustomer: (customer: string) => void;
  /** Items in an open delivery report, and what she reported. */
  reported: Map<number, DeliveryKind>;
  /** All her items per customer (customerKey), for Collect. */
  customerRows: Map<string, DatabaseRowType[]>;
}) {
  const [limit, setLimit] = useState(PAGE_ROWS);
  const rows = useMemo(() => newestFirst(group.items), [group.items]);
  // Back to the first rows only when the items change, not on every refresh.
  const idsKey = useMemo(() => group.items.map(r => r.id).join(','), [group.items]);
  useEffect(() => { setLimit(PAGE_ROWS); }, [idsKey]);
  const weight = weightLabel(rows);
  const now = Date.now();

  return (
    <div id={`liver-status-${group.key}`} className="rounded-xl border border-border bg-card overflow-hidden scroll-mt-24">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none hover:bg-secondary/20 transition-colors"
      >
        <StatusBadge status={group.label} />
        <span className="text-xs text-muted-foreground shrink-0">{rows.length} item{rows.length !== 1 ? 's' : ''}</span>
        <span className="text-xs text-muted-foreground">{weight}</span>
        <div className="h-px flex-1 bg-border/40" />
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/20 border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Ordered</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Client</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium hidden sm:table-cell">Item</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r, i) => {
                const due = dueOf(r);
                const collect = collectForAED([r], customerRows.get(customerKey(r)) ?? [r]);
                const rep = reported.get(r.id);
                return (
                  <tr key={r.id} className={`border-b border-border/30 align-top ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.dateOfLive ? formatDateShort(r.dateOfLive) : '—'}</td>
                    <td className="px-3 py-2 min-w-0 break-words">
                      <button type="button" className="font-medium text-left underline-offset-2 hover:underline" onClick={() => onOpenCustomer(customerKey(r))}>
                        <Highlight text={r.minerName || '—'} query={query} />
                      </button>
                      {/* On phones the Item column is hidden: what it is goes under the name. */}
                      <div className="text-[11px] text-muted-foreground sm:hidden">
                        <Highlight text={[r.itemDescription, r.orderId].filter(Boolean).join(' · ')} query={query} />
                      </div>
                      <OutsourceTag r={r} />
                      <ShippedLine r={r} />
                      {rep ? (
                        <div className="text-xs text-primary">Reported {rep.toLowerCase()} · waiting for Dispatch</div>
                      ) : due && (
                        <div className={`text-xs ${due.getTime() < now ? 'text-destructive font-semibold' : 'text-muted-foreground'}`}>
                          Due {formatDateShort(due.toISOString())}
                        </div>
                      )}
                      {collect > 0 && <div className="text-xs font-semibold text-attention">Collect {aedLabel(collect)}</div>}
                      <NotesToggle r={r} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground min-w-0 break-words hidden sm:table-cell">
                      <Highlight text={r.itemDescription || '—'} query={query} />
                      {r.orderId && <div className="text-[11px]"><Highlight text={r.orderId} query={query} /></div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{gramsLabel(r)}</td>
                    <td className="px-1 py-1 text-right w-10">
                      <button
                        onClick={() => copyRow(r)}
                        title="Copy row"
                        aria-label="Copy row"
                        className="h-9 w-9 inline-grid place-items-center rounded text-muted-foreground hover:bg-secondary"
                      >
                        {copiedId === r.id
                          ? <Check className="h-4 w-4 text-success" />
                          : <Copy className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-secondary/20 border-t border-border">
                <td colSpan={5} className="px-3 py-1.5 text-xs text-muted-foreground">
                  {rows.length > limit ? (
                    <button className="underline font-medium text-foreground py-1" onClick={() => setLimit(l => l + PAGE_ROWS)}>
                      Show {Math.min(PAGE_ROWS, rows.length - limit)} more · {limit} of {rows.length} shown
                    </button>
                  ) : (
                    <>{rows.length} items · {weight}</>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Sold by ship date ────────────────────────────────────────────────────────
function SoldBreakdown({ sold }: { sold: DatabaseRowType[] }) {
  const [show, setShow] = useState(false);
  const byDay = useMemo(() => groupByDay(sold, soldDay), [sold]);
  if (byDay.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setShow(v => !v)}
        aria-expanded={show}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none hover:bg-secondary/20 transition-colors"
      >
        <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">Sold by ship date</span>
        <div className="h-px flex-1 bg-border/40" />
        <span className="text-xs text-muted-foreground">{byDay.length} day{byDay.length !== 1 ? 's' : ''}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${show ? 'rotate-180' : ''}`} />
      </button>

      {show && (
        <div className="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/20 border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Shipped</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Items</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Grams</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map(([day, rows], i) => (
                <tr key={day} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{day === 'Unknown' ? 'No date' : formatDate(day)}</td>
                  <td className="px-3 py-2 text-right font-medium">{rows.length}</td>
                  <td className="px-3 py-2 text-right">{weightLabel(rows)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-secondary/30 border-t border-border font-semibold">
                <td className="px-3 py-1.5 text-xs text-muted-foreground">Totals</td>
                <td className="px-3 py-1.5 text-right text-xs">{sold.length}</td>
                <td className="px-3 py-1.5 text-right text-xs">{weightLabel(sold)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── My lives (one row per live) ─────────────────────────────────────────────
function MyLives({ rows }: { rows: DatabaseRowType[] }) {
  const [show, setShow] = useState(false);
  const lives = useMemo(() => summariseLives(rows), [rows]);
  if (lives.length === 0) return null;
  // The page only matters when she sold on more than one.
  const manyPages = new Set(lives.map(l => l.page)).size > 1;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setShow(v => !v)}
        aria-expanded={show}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none hover:bg-secondary/20 transition-colors"
      >
        <span className="text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">My lives</span>
        <div className="h-px flex-1 bg-border/40" />
        <span className="text-xs text-muted-foreground">{lives.length} live{lives.length !== 1 ? 's' : ''}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${show ? 'rotate-180' : ''}`} />
      </button>
      {show && (
        <ul className="border-t border-border divide-y divide-border/50">
          {lives.map(l => (
            <li key={`${l.day}|${l.page}`} className="px-4 py-2.5 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-sm">{l.day === 'Unknown' ? 'No live date' : `Live ${formatDate(l.day)}`}</span>
                {manyPages && l.page && <span className="text-muted-foreground">{l.page}</span>}
              </div>
              <p className="text-muted-foreground">
                {l.customers} customer{l.customers !== 1 ? 's' : ''} · {l.items} item{l.items !== 1 ? 's' : ''} · {l.grams.toFixed(2)}g
              </p>
              <p>
                <span className="text-success font-medium">Sold {l.soldItems} · {l.soldGrams.toFixed(2)}g</span>
                <span className="text-muted-foreground"> · Waiting {l.waiting}</span>
                {l.cancelled > 0 && <span className="text-destructive"> · Cancelled {l.cancelled}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LiverDashboard({ records, searchQuery, onSearchChange, lockedLiverName, defaultLiver, onRefresh, previewing, clientMilestones }: TabProps) {
  const [selectedLiver, setSelectedLiver] = useState<string>(() => {
    if (lockedLiverName) return liverKey(lockedLiverName);
    try { return liverKey(localStorage.getItem(LIVER_STORAGE_KEY)) || liverKey(defaultLiver); } catch { return liverKey(defaultLiver); }
  });
  const [range, setRange] = useState<DateRange>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [materialFilter, setMaterialFilter] = useState<MaterialFilter>('all');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showReminders, setShowReminders] = useState(false);
  const [showUndated, setShowUndated] = useState(false);
  // Status groups she opened (collapsed by default).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [pulloutOpen, setPulloutOpen] = useState<boolean | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  // Her pullout requests, as the panel loads them.
  const [requests, setRequests] = useState<PulloutRequest[]>([]);
  // Her delivery reports (Delivered / Picked up), as that card loads them.
  const [reports, setReports] = useState<DeliveryReport[]>([]);
  const [deliveriesOpen, setDeliveriesOpen] = useState<boolean | null>(null);
  // Which liver each list last answered for, and whether her data ever
  // arrived (ok) or every load failed. Tied to the liver, so switching liver
  // never reuses the previous one's answer.
  const [requestsLoaded, setRequestsLoaded] = useState<{ liver: string; ok: boolean } | null>(null);
  const [reportsLoaded, setReportsLoaded] = useState<{ liver: string; ok: boolean } | null>(null);
  useEffect(() => {
    setRequests([]); setReports([]);
  }, [selectedLiver]);
  const onRequestsLoaded = useCallback((ok: boolean) => setRequestsLoaded(prev => ({
    liver: selectedLiver, ok: ok || (prev?.liver === selectedLiver && prev.ok),
  })), [selectedLiver]);
  const onReportsLoaded = useCallback((ok: boolean) => setReportsLoaded(prev => ({
    liver: selectedLiver, ok: ok || (prev?.liver === selectedLiver && prev.ok),
  })), [selectedLiver]);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  // When her records last arrived: a Done request / Confirmed report locks its
  // items only until then (see finishedAfterLoad).
  const [recordsAt, setRecordsAt] = useState(() => Date.now());
  useEffect(() => { setRecordsAt(Date.now()); }, [records]);
  // "Now" for the date filters and overdue items, so a screen left open
  // overnight moves on (ticks every minute and when the app comes back).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const copyRow = useCallback((r: DatabaseRowType) => {
    const text = [r.minerName, r.itemDescription, r.orderId, gramsLabel(r), r.dateOfLive ? `Ordered ${formatDate(r.dateOfLive)}` : '']
      .filter(x => x && x !== '—').join(' · ');
    if (!navigator.clipboard) { toast.error("Couldn't copy"); return; }
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopiedId(r.id);
        setTimeout(() => setCopiedId(null), 1500);
      })
      .catch(() => toast.error("Couldn't copy"));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LIVER_STORAGE_KEY, selectedLiver); } catch { /* ignore */ }
  }, [selectedLiver]);

  const liverNames = useMemo(() => {
    return Array.from(new Set(records.map(r => liverKey(r.liverName)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [records]);

  useEffect(() => {
    if (lockedLiverName) setSelectedLiver(liverKey(lockedLiverName));
  }, [lockedLiverName]);

  useEffect(() => {
    if (lockedLiverName || liverNames.length === 0) return;
    if (selectedLiver && !liverNames.includes(selectedLiver)) {
      // Not a liver here (any more): fall back to her own name if she sells.
      const own = liverKey(defaultLiver);
      setSelectedLiver(own && liverNames.includes(own) ? own : '');
    }
  }, [liverNames, selectedLiver, lockedLiverName, defaultLiver]);

  // Every item of hers, whatever its status (no status = Waiting for Details).
  const byLiver = useMemo(() => {
    if (!selectedLiver) return [];
    return records.filter(r => liverKey(r.liverName) === selectedLiver);
  }, [records, selectedLiver]);

  const query = searchQuery.trim();
  const searched = useMemo(() => (query ? applySearch(byLiver, query) : byLiver), [byLiver, query]);
  const searchedIds = useMemo(() => (query ? new Set(searched.map(r => r.id)) : null), [searched, query]);

  // Recomputed when the day changes, not every minute (keeps the lists still).
  const nowDay = todayISO(new Date(now));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` only matters through nowDay
  const bounds = useMemo(() => rangeBounds(range, new Date(now), customStart, customEnd), [range, nowDay, customStart, customEnd]);
  const matches = useCallback((r: DatabaseRowType) => materialFilter === 'all' || metalOf(r) === materialFilter, [materialFilter]);
  const otherCount = useMemo(() => byLiver.filter(r => metalOf(r) === 'other').length, [byLiver]);
  useEffect(() => { if (materialFilter === 'other' && otherCount === 0) setMaterialFilter('all'); }, [materialFilter, otherCount]);

  // Lists: by order date. While searching, every date (she is looking for something).
  const filtered = useMemo(() => {
    const base = query ? searched : bounds ? byLiver.filter(r => inBounds(r.dateOfLive, bounds) === true) : byLiver;
    return base.filter(matches);
  }, [query, searched, bounds, byLiver, matches]);
  const live = useMemo(() => filtered.filter(r => !isOut(r)), [filtered]);
  const outInView = filtered.length - live.length;

  // KPIs never follow the search, so "grams sold" stays the agreed figure.
  // Sold counts on the day it shipped; in progress on the day it was ordered.
  const sold = useMemo(() => byLiver.filter(r =>
    matches(r) && isSold(r) && (!bounds || inBounds(soldDay(r), bounds) === true)), [byLiver, matches, bounds]);
  const inProgress = useMemo(() => byLiver.filter(r =>
    matches(r) && !isOut(r) && !isSold(r) && (!bounds || inBounds(r.dateOfLive, bounds) === true)), [byLiver, matches, bounds]);
  // With a period on, items whose date can't be read can't be placed in it.
  const undated = useMemo(() => (bounds
    ? byLiver.filter(r => matches(r) && !isOut(r) && !(isSold(r) ? soldDay(r) : dayKey(r.dateOfLive)))
    : []), [byLiver, matches, bounds]);

  const soldGold = sold.filter(r => metalOf(r) === 'gold');
  const soldSilver = sold.filter(r => metalOf(r) === 'silver');
  const soldOther = sold.filter(r => metalOf(r) === 'other');
  const soldPcs = pieceCount(sold);
  // "Sold by ship date" follows the search like the lists (every date while searching).
  const soldShown = useMemo(() => (query ? searched.filter(r => matches(r) && isSold(r)) : sold), [query, searched, matches, sold]);
  const customerRows = useMemo(() => groupByCustomer(byLiver), [byLiver]);

  const groups = useMemo(() => groupByStatus(live), [live]);
  // Searching opens every group with a match; clearing folds them again.
  useEffect(() => {
    setOpenGroups(query ? new Set(groups.map(g => g.key)) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the search changes
  }, [query]);
  const toggleGroup = (key: string) => setOpenGroups(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const openGroup = (key: string) => {
    setOpenGroups(prev => new Set(prev).add(key));
    setTimeout(() => scrollToId(`liver-status-${key}`), 50);
  };

  // Deadlines per row ("Due Oct 03").
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read the Settings deadlines on each refresh
  const rules = useMemo(() => getReminderRules(), [records]);
  const lastBuys = useMemo(() => lastPurchases(records), [records]);
  const dueOf = useCallback((r: DatabaseRowType) => dueFor(r, rules, lastBuys)?.due ?? null, [rules, lastBuys]);

  // Items in an open delivery report, and what she reported.
  const reported = useMemo(() => {
    const kinds = new Map<string, DeliveryKind>();
    for (const q of reports) if (isOpenReport(q)) for (const k of q.itemKeys) kinds.set(k, q.kind);
    const m = new Map<number, DeliveryKind>();
    for (const r of byLiver) { const k = kinds.get(itemKey(r)); if (k) m.set(r.id, k); }
    return m;
  }, [reports, byLiver]);

  // Not overdue while she's on it: items in an open request whose day hasn't
  // passed, and items she reported delivered / picked up (until Dispatch answers).
  const inRequest = useMemo(() => {
    const keys = new Set<string>();
    for (const q of requests) if (isOpenRequest(q) && !isOverdueRequest(q)) for (const k of q.itemKeys) keys.add(k);
    const ids = new Set(byLiver.filter(r => keys.has(itemKey(r))).map(r => r.id));
    reported.forEach((_, id) => ids.add(id));
    return ids;
  }, [requests, byLiver, reported]);

  // Her own overdue items (status deadlines) — pops up once when she opens the tab.
  const myOverdue = useMemo(
    () => computeOverdue(byLiver, rules, records)
      .map(sec => ({ ...sec, items: sec.items.filter(r => !inRequest.has(r.id)) }))
      .filter(sec => sec.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now`: re-check deadlines as time passes
    [byLiver, records, rules, inRequest, now],
  );
  // Both lists answered for her (or failed): until then nothing counts as
  // overdue, so the banner never lists items she already requested or
  // reported. A broken endpoint still shows the warnings, but the popup waits
  // for real data, so it never uses up the day on a wrong list.
  const listsAnswered = requestsLoaded?.liver === selectedLiver && reportsLoaded?.liver === selectedLiver;
  const listsOk = listsAnswered && !!requestsLoaded?.ok && !!reportsLoaded?.ok;
  const overdueCount = listsAnswered ? myOverdue.reduce((n, sec) => n + sec.items.length, 0) : 0;
  const mayBeCancelled = myOverdue.some(sec => sec.rule.cancelWhenOverdue);
  useEffect(() => {
    if (selectedLiver && listsOk && overdueCount > 0 && !remindersSeen(selectedLiver)) {
      setShowReminders(true);
      markRemindersSeen(selectedLiver);
    }
  }, [selectedLiver, listsOk, overdueCount]);

  // Today card.
  const dueSoon = useMemo(() => {
    const until = now + DUE_SOON_HOURS * 3600_000;
    return byLiver.filter(r => {
      if (isOut(r) || inRequest.has(r.id)) return false;
      const d = dueOf(r);
      return !!d && d.getTime() > now && d.getTime() <= until;
    });
  }, [byLiver, dueOf, inRequest, now]);
  const ready = requests.filter(q => q.status === 'Ready');
  const rejectedReports = useMemo(() => recentlyRejected(reports, byLiver, now), [reports, byLiver, now]);
  // Her items by key and every status, for where a Ready request's items go.
  const byKey = useMemo(() => itemsByKey(byLiver), [byLiver]);
  const statuses = useMemo(() => records.map(r => String(r.status ?? '')), [records]);
  const notRequested = useMemo(() => {
    const keys = new Set<string>();
    for (const q of requests) {
      if (isOpenRequest(q) || (q.status === 'Done' && finishedAfterLoad(q.updatedAt, recordsAt, now))) for (const k of q.itemKeys) keys.add(k);
    }
    return byLiver.filter(r => isToPullOut(r) && !keys.has(itemKey(r))).length;
  }, [requests, byLiver, recordsAt, now]);

  const openPullout = () => { setPulloutOpen(true); setTimeout(() => scrollToId('liver-pullout'), 50); };
  const openDeliveries = () => { setDeliveriesOpen(true); setTimeout(() => scrollToId('liver-deliveries'), 50); };
  const openCancelled = () => { setCancelledOpen(true); setTimeout(() => scrollToId('liver-cancelled'), 50); };
  // Due soon: open the groups holding those items, then go there.
  const openDueSoon = () => {
    const keys = new Set(dueSoon.map(r => statusOf(r).toLowerCase()));
    setOpenGroups(prev => new Set([...Array.from(prev), ...Array.from(keys)]));
    const first = groups.find(g => keys.has(g.key));
    setTimeout(() => scrollToId(first ? `liver-status-${first.key}` : 'liver-groups'), 50);
  };

  const rangeLabel = DATE_RANGES.find(x => x.key === range)?.label.toLowerCase() ?? '';
  const emptyText = (() => {
    const what = materialFilter === 'all' ? 'items' : `${materialFilter} items`;
    if (range === 'all') return `No ${what} yet.`;
    if (range === 'custom') return `No ${what} ordered in these dates.`;
    return `No ${what} ordered ${rangeLabel}.`;
  })();

  // Admins and bosses choose a liver; a liver sees only herself.
  const title = lockedLiverName ? 'My Sales' : selectedLiver ? `${selectedLiver}'s sales` : 'Liver sales';
  const sameFirstName = useMemo(() => {
    const first = selectedLiver.split(' ')[0];
    return first ? liverNames.filter(n => n !== selectedLiver && n.split(' ')[0] === first) : [];
  }, [liverNames, selectedLiver]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader title={title} subtitle={lockedLiverName ? 'Personal sales summary' : 'Sales and pullouts per liver'} searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <div className="px-4 pt-4 space-y-4">

        {/* Liver selector */}
        {lockedLiverName ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <span className="text-xs text-muted-foreground">Viewing as:</span>
            <span className="text-sm font-cinzel font-bold text-primary">{selectedLiver}</span>
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Choose a liver</p>
            <Select value={selectedLiver} onValueChange={setSelectedLiver}>
              <SelectTrigger className="h-9 text-sm bg-background border-border w-full max-w-xs">
                <SelectValue placeholder="Choose a liver..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {liverNames.map(name => (
                  <SelectItem key={name} value={name} className="text-sm text-foreground font-medium">{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Her name matches no orders: say what to check instead of showing zeros. */}
        {selectedLiver && byLiver.length === 0 && lockedLiverName && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground space-y-2">
            <p>No orders found under &quot;{selectedLiver}&quot; yet. If you have sold before, ask the admin to check your name in the Roles sheet matches the masterlist exactly.</p>
            {previewing && sameFirstName.length > 0 && (
              <p className="text-xs">Similar names in the masterlist: {sameFirstName.join(', ')}</p>
            )}
          </div>
        )}

        {selectedLiver && byLiver.length > 0 && (
          <>
            {/* One line on top: each part goes to its section. */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
              <button className="font-semibold text-success underline-offset-2 hover:underline py-1" onClick={() => scrollToId('liver-kpi')}>
                Sold {sumGrams(sold).toFixed(1)}g
              </button>
              <span className="text-muted-foreground">·</span>
              <button className="underline-offset-2 hover:underline py-1" onClick={() => scrollToId('liver-groups')}>
                {inProgress.length} in progress
              </button>
              <span className="text-muted-foreground">·</span>
              <button className="underline-offset-2 hover:underline py-1" onClick={openPullout}>
                {notRequested} to pull out
              </button>
            </div>

            {overdueCount > 0 && (
              <button
                onClick={() => setShowReminders(true)}
                className="w-full flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-left text-xs text-destructive"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="flex-1">
                  <b>{overdueCount} item{overdueCount !== 1 ? 's are' : ' is'}</b> waiting too long — please follow up with the customer
                  {mayBeCancelled ? ' — Dispatch may cancel them if there is no update.' : '.'}
                </span>
                <span className="underline">View</span>
              </button>
            )}

            {/* Today */}
            {(ready.length > 0 || rejectedReports.length > 0 || overdueCount > 0 || dueSoon.length > 0 || notRequested > 0) && (
              <div className="rounded-xl border border-primary/30 bg-card p-3 space-y-0.5 text-sm">
                <p className="flex items-center gap-2 text-xs font-cinzel font-bold text-primary/80 uppercase tracking-wide">
                  <CalendarClock className="h-4 w-4" /> Today
                </p>
                {ready.map(q => (
                  <button key={q.id} className="block w-full text-left text-success font-medium py-2" onClick={openPullout}>
                    Ready to collect: {q.itemKeys.length} item{q.itemKeys.length !== 1 ? 's' : ''} · {pullOutOnLabel(q.date).replace(/^Pull/, 'pull')} · {requestTargetsLabel(itemsFor(byKey, q.itemKeys), q.method, statuses)}
                  </button>
                ))}
                {rejectedReports.length > 0 && (
                  <button className="block w-full text-left text-destructive py-2" onClick={openDeliveries}>
                    Dispatch didn&apos;t confirm: {rejectedReports.length} delivery report{rejectedReports.length !== 1 ? 's' : ''} — see why
                  </button>
                )}
                {overdueCount > 0 && (
                  <button className="block w-full text-left text-destructive py-2" onClick={() => setShowReminders(true)}>
                    Overdue: {overdueCount} item{overdueCount !== 1 ? 's' : ''}
                  </button>
                )}
                {dueSoon.length > 0 && (
                  <button className="block w-full text-left text-warning py-2" onClick={openDueSoon}>
                    Due soon (next {DUE_SOON_HOURS}h): {dueSoon.length} item{dueSoon.length !== 1 ? 's' : ''}
                  </button>
                )}
                {notRequested > 0 && (
                  <button className="block w-full text-left py-2" onClick={openPullout}>
                    Not yet requested: {notRequested} item{notRequested !== 1 ? 's' : ''} to pull out
                  </button>
                )}
              </div>
            )}

            {query && (
              <p className="text-xs text-muted-foreground">
                {searched.length > 0
                  ? <>Searching all dates · <b className="text-foreground">{searched.length} item{searched.length !== 1 ? 's' : ''}</b> match &quot;{query}&quot;</>
                  : <>No items match &quot;{query}&quot;</>}
                {' · '}<button className="underline text-foreground py-1" onClick={() => onSearchChange('')}>Clear</button>
              </p>
            )}

            {/* What to pull out, pullout requests to Dispatch, and what was cancelled */}
            <div id="liver-pullout" className="scroll-mt-24">
              <PulloutPanel
                key={selectedLiver}
                liver={selectedLiver}
                records={byLiver}
                allRecords={records}
                recordsAt={recordsAt}
                onRefresh={onRefresh}
                previewing={previewing}
                visibleIds={searchedIds}
                query={query}
                onRequestsChange={setRequests}
                onLoaded={onRequestsLoaded}
                onOpenCustomer={setCustomer}
                open={pulloutOpen}
                onOpenChange={setPulloutOpen}
              />
            </div>
            <DeliveryPanel
              key={`d-${selectedLiver}`}
              liver={selectedLiver}
              records={byLiver}
              recordsAt={recordsAt}
              onRefresh={onRefresh}
              previewing={previewing}
              visibleIds={searchedIds}
              query={query}
              onReportsChange={setReports}
              onLoaded={onReportsLoaded}
              onOpenCustomer={setCustomer}
              open={deliveriesOpen}
              onOpenChange={setDeliveriesOpen}
            />
            <CancelledItems
              key={`c-${selectedLiver}`}
              records={searched}
              query={query}
              onOpenCustomer={setCustomer}
              open={cancelledOpen}
              onOpenChange={setCancelledOpen}
            />

            {/* Period */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">
                Period <span className="text-muted-foreground/80">· {query
                  ? 'lists show every date while searching; Sold and In progress still use this period'
                  : 'lists by order date, sold by ship date'}</span>
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {DATE_RANGES.map(r => (
                  <Button
                    key={r.key}
                    size="sm"
                    variant={range === r.key ? 'default' : 'outline'}
                    className={`text-xs h-9 ${range === r.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                    onClick={() => setRange(r.key)}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
              {range === 'custom' && (
                <div className="flex flex-wrap gap-2 mt-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">From</label>
                    <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-9 text-xs w-40 bg-background border-border" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground">To</label>
                    <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-9 text-xs w-40 bg-background border-border" />
                  </div>
                </div>
              )}
              {undated.length > 0 && (
                <div className="mt-2 text-xs text-warning">
                  <button className="underline py-1 text-left" onClick={() => setShowUndated(v => !v)}>
                    {undated.length} item{undated.length !== 1 ? 's have' : ' has'} no readable order date — ask Admin
                  </button>
                  {showUndated && (
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {undated.map(r => (
                        <li key={r.id}>{[r.minerName, r.itemDescription, r.orderId, r.dateOfLive ? `date "${r.dateOfLive}"` : 'no date'].filter(Boolean).join(' · ')}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Material Filter */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Material</p>
              <div className="flex gap-1.5 flex-wrap">
                {MATERIAL_FILTERS.filter(m => m.key !== 'other' || otherCount > 0).map(m => (
                  <Button
                    key={m.key}
                    size="sm"
                    variant={materialFilter === m.key ? 'default' : 'outline'}
                    className={`text-xs h-9 ${materialFilter === m.key ? 'bg-primary text-primary-foreground' : 'border-border'}`}
                    onClick={() => setMaterialFilter(m.key)}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* KPIs: grams sold is the headline */}
            <div id="liver-kpi" className="grid grid-cols-1 sm:grid-cols-2 gap-3 scroll-mt-24">
              <StatCard
                icon={<Weight className="h-3.5 w-3.5" />}
                accent="gold"
                label={range === 'all' ? 'Sold' : `Sold · ${range === 'custom' ? 'your dates' : rangeLabel}`}
                value={`${sumGrams(sold).toFixed(2)}g`}
                sub={[
                  `${sumGrams(soldGold).toFixed(2)}g gold`,
                  `${sumGrams(soldSilver).toFixed(2)}g silver`,
                  soldOther.length ? `${sumGrams(soldOther).toFixed(2)}g other` : '',
                  `${sold.length} item${sold.length !== 1 ? 's' : ''}`,
                  soldPcs ? `+ ${soldPcs} pc${soldPcs !== 1 ? 's' : ''}` : '',
                ].filter(Boolean).join(' · ')}
              />
              <StatCard
                icon={<Package className="h-3.5 w-3.5" />}
                accent="neutral"
                label={range === 'all' ? 'In progress' : `In progress · ordered ${range === 'custom' ? 'in your dates' : rangeLabel}`}
                value={<>{inProgress.length} <span className="text-sm font-normal">item{inProgress.length !== 1 ? 's' : ''}</span></>}
                sub={`${weightLabel(inProgress)} · not shipped yet`}
              />
            </div>

            {/* Status chips: each opens its group */}
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {groups.map(g => (
                  <button
                    key={g.key}
                    onClick={() => openGroup(g.key)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full bg-secondary border border-border text-muted-foreground hover:bg-secondary/70"
                  >
                    {g.label} <span className="text-foreground font-bold">{g.items.length}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Status Sections */}
            <div id="liver-groups" className="scroll-mt-24">
              {live.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-border rounded-xl space-y-2">
                  <p className="text-sm text-muted-foreground">{query ? `No items match "${query}".` : emptyText}</p>
                  {query && <Button size="sm" variant="outline" className="h-9 text-xs" onClick={() => onSearchChange('')}>Clear search</Button>}
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map(g => (
                    <StatusSection
                      key={g.key}
                      group={g}
                      open={openGroups.has(g.key)}
                      onToggle={() => toggleGroup(g.key)}
                      query={query}
                      copyRow={copyRow}
                      copiedId={copiedId}
                      dueOf={dueOf}
                      onOpenCustomer={setCustomer}
                      reported={reported}
                      customerRows={customerRows}
                    />
                  ))}
                </div>
              )}
              {outInView > 0 && (
                <button className="mt-2 text-xs text-muted-foreground underline py-1" onClick={openCancelled}>
                  See cancelled / returned items (the red box above)
                </button>
              )}
            </div>

            <SoldBreakdown sold={soldShown} />
            <MyLives rows={filtered} />
          </>
        )}

        {showReminders && (
          <RemindersDialog
            records={byLiver}
            allRecords={records}
            audience="liver"
            exclude={inRequest}
            title={`Reminders — ${selectedLiver}`}
            intro={`Your items that are waiting too long. Please follow up with the customer${mayBeCancelled ? ' — Dispatch may cancel them if there is no update' : ''}.`}
            onClose={() => setShowReminders(false)}
          />
        )}

        {customer && (
          <LiverCustomerSheet customer={customer} rows={byLiver} clientMilestones={clientMilestones} onClose={() => setCustomer(null)} />
        )}

        {!selectedLiver && (
          <div className="text-center py-16 border border-dashed border-border rounded-xl">
            <DollarSign className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {lockedLiverName ? 'Loading your sales…' : 'Choose a liver above to see their sales and pullouts.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
