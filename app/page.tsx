"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getMyRoles, getRecords, getRoles, getRatesConfig, getPricingConfig, getTabConfig, getBusinessConfig, getLabelConfig, getAppConfig, getMasterlistMapping, getOptionsConfig, getCustomToggles, updateRecord, bulkUpdateRecords } from '@/lib/api';
import { applyPricingConfig } from '@/lib/pricingConfig';
import { trimAudit } from '@/lib/auditTrim';
import { setDevAccess } from '@/lib/devAccess';
import { applyBusinessConfig } from '@/lib/businessConfig';
import { applyLabelConfig } from '@/lib/labelConfig';
import { applyAppConfig } from '@/lib/appConfig';
import { setKnownStatuses } from '@/lib/statusRegistry';
import { setKnownOptions } from '@/lib/dataDerivedOptions';
import { applyOptionsConfig, setDiscoveredOptions } from '@/lib/optionsConfig';
import { applyCustomToggles } from '@/lib/customToggles';
import { ensureTenantScope } from '@/lib/tenantStorage';
import { applyMotionToDom } from '@/lib/motionPref';
import { applyMasterlistMapping } from '@/lib/masterlistMapping';
import { applyTabConfig, getTabLabel, isTabHidden, orderConfigurableKeys, CONFIGURABLE_TAB_KEYS, type ConfigurableTabKey } from '@/lib/tabConfig';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { LogOut, Minimize2, Maximize2, Crown, LayoutDashboard, Truck, Calculator, BarChart2, Radio, ShoppingBag, FileText, Scale, Settings as SettingsIcon } from 'lucide-react';
import { getMyContext } from '@/lib/tenancy';
import type { MyContext } from '@/lib/tenancy-types';
import GodModePanel from '@/components/godmode/GodModePanel';
import { CompactModeProvider, useCompactMode } from '@/lib/compactMode';
import { getUserRole, isLiverOnly, EMAIL_TO_LIVER_NAME } from '@/config/roles';
import { applyRatesConfig } from '@/lib/ratesStore';
import { computeClientMilestones } from '@/lib/milestones';
import { DatabaseRowType } from '@/types';
import { brandInitials } from '@/lib/brandSettings';
import { BrandThemeLoader, useBrand } from '@/components/BrandThemeLoader';

import WelcomeScreen from '@/components/WelcomeScreen';
import AccessDenied from '@/components/AccessDenied';
import LoadingSkeleton from '@/components/LoadingSkeleton';
import AdminPipeline from '@/components/admin/AdminPipeline';
import DispatchBoard from '@/components/dispatch/DispatchBoard';
import AccountsTracking from '@/components/accounts/AccountsTracking';
import BossingDashboard from '@/components/bossing/BossingDashboard';
import LiverDashboard from '@/components/liver/LiverDashboard';
import InvoicingTab from '@/components/invoicing/InvoicingTab';
import PurchasingTab from '@/components/purchasing/PurchasingTab';
import LiveSellersTab from '@/components/liveSellers/LiveSellersTab';
import DesignSettings from '@/components/settings/DesignSettings';
import UploadMasterlistFAB from '@/components/UploadMasterlistFAB';
import PreviewAsUser from '@/components/PreviewAsUser';
import RateCalculatorWidget from '@/components/RateCalculatorWidget';
import { autoStageDates, fulfilmentStage } from '@/lib/fulfilment';
import { shipmentIdentityFor } from '@/lib/calculations';
import { liverKey } from '@/lib/pulloutRequests';
type TabKey = 'admin' | 'dispatch' | 'accounts' | 'bossing' | 'liver' | 'purchasing' | 'invoicing' | 'livesellers' | 'settings' | 'godmode';

/** The tab a user lands on: the first of these they can see. */
const DEFAULT_TAB_PRIORITY: TabKey[] = ['admin', 'dispatch', 'accounts', 'bossing', 'liver', 'purchasing', 'invoicing', 'livesellers'];

function getVisibleTabs(roles: string[]): Set<TabKey> {
  if (roles.includes('super_admin')) {
    return new Set<TabKey>(['admin', 'dispatch', 'accounts', 'bossing', 'liver', 'purchasing', 'invoicing', 'livesellers', 'settings']);
  }
  const visible = new Set<TabKey>();
  if (roles.includes('admin')) { visible.add('admin'); visible.add('invoicing'); visible.add('livesellers'); }
  if (roles.includes('livesellers')) visible.add('livesellers');
  if (roles.includes('dispatch')) visible.add('dispatch');
  if (roles.includes('accounts')) visible.add('accounts');
  if (roles.includes('bossing')) visible.add('bossing');
  if (roles.includes('liver')) visible.add('liver');
  if (roles.includes('purchasing')) visible.add('purchasing');
  return visible;
}

/**
 * An item brought back from Cancelled / Returned loses its old cancel reason,
 * so a later cancel never shows the reason from before.
 */
function clearedCancelReason(before: Partial<DatabaseRowType> | undefined, fields: Partial<DatabaseRowType>): Partial<DatabaseRowType> {
  if (fields.status === undefined || fields.cancelReason !== undefined) return {};
  if (!String(before?.cancelReason ?? '').trim()) return {};
  const wasOut = fulfilmentStage(before?.status) === 'excluded';
  return wasOut && fulfilmentStage(fields.status) !== 'excluded' ? { cancelReason: '' } : {};
}

function AppContent() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const { settings: brandSettings, headerLogo } = useBrand();
  const { isCompact, toggle: toggleCompact } = useCompactMode();

  // Apply the saved motion preference before anything renders.
  useEffect(() => { applyMotionToDom(); }, []);

  const [records, setRecords] = useState<DatabaseRowType[]>([]);
  // When the server read them (its clock), for the Liver tab's item locks.
  const [recordsReadAt, setRecordsReadAt] = useState(0);
  const recordsRef = useRef<DatabaseRowType[]>([]);
  useEffect(() => { recordsRef.current = records; }, [records]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('admin');
  const [searchQueries, setSearchQueries] = useState<Record<TabKey, string>>({
    admin: '', dispatch: '', accounts: '', bossing: '', liver: '', purchasing: '', invoicing: '', livesellers: '', settings: '', godmode: '',
  });
  const [dynamicRoles, setDynamicRoles] = useState<any[] | null>(null);
  const [previewEmail, setPreviewEmail] = useState<string | null>(null);
  const [devContext, setDevContext] = useState<MyContext | null>(null);
  const [devReady, setDevReady] = useState(false);
  // Roles the SERVER gives this user (developer ⇒ super_admin). Backup for when
  // the God Mode probe fails, so the developer is never shown "Access denied".
  const [serverRoles, setServerRoles] = useState<string[]>([]);
  useEffect(() => {
    if (!user) return;
    getMyRoles({}).then(setServerRoles).catch(() => {});
  }, [user]);
  // The signed-in user's own roles, worked out during render (not in an effect)
  // so the first frame never shows a tab they can't open. If the Roles tab
  // couldn't be read, fall back to the roles the server gave them.
  const roles = useMemo<string[]>(
    () => (dynamicRoles ? getUserRole(user?.email || '', dynamicRoles) : serverRoles),
    [user?.email, dynamicRoles, serverRoles],
  );
  // The tab actually on screen (set during render, below). Kept in a ref so the
  // search box and the tab sync below always use the tab the user can see.
  const shownTabRef = useRef<TabKey | null>(null);
  // Bumped after the per-tenant tab config loads, to re-render the nav with the
  // customer's labels/visibility.
  const [tabConfigVersion, setTabConfigVersion] = useState(0);

  const fetchData = useCallback(async (quiet?: unknown) => {
    if (!user) return;
    // quiet === true: refresh data in the background without the loading screen.
    if (quiet !== true) setLoading(true);
    try {
      const [recordsRes, rolesRes, ratesRes, pricingRes, tabRes, bizRes, labelRes, appRes, mlmRes, optRes, tglRes] = await Promise.all([
        // Not all-or-nothing: when the records (or the Roles tab behind them)
        // can't be read, keep what's loaded and still apply the settings below.
        getRecords({ tailOnly: false }).catch((e) => { console.error('Failed to load records:', e); return null; }),
        getRoles({}).catch(() => null),
        getRatesConfig({}).catch(() => ({ config: '' })),
        getPricingConfig({}).catch(() => null),
        getTabConfig({}).catch(() => null),
        getBusinessConfig({}).catch(() => ({ config: '' })),
        getLabelConfig({}).catch(() => ({ config: '' })),
        getAppConfig({}).catch(() => null),
        getMasterlistMapping({}).catch(() => ({ config: '' })),
        getOptionsConfig({}).catch(() => null),
        getCustomToggles({}).catch(() => ({ config: '' })),
      ]);
      if (recordsRes) {
        const loaded = recordsRes.records as DatabaseRowType[];
        setRecords(loaded);
        setRecordsReadAt(Date.parse(recordsRes.readAt) || Date.now());
        setKnownStatuses(loaded);
        setKnownOptions(loaded);
        setDiscoveredOptions(loaded);
      } else {
        // Server error text is hidden in production builds, so say it here.
        toast.error("Couldn't load your account. Tap Refresh to try again.");
      }
      if (rolesRes) setDynamicRoles(rolesRes as any[]);
      if (ratesRes?.config) applyRatesConfig(ratesRes.config);
      if (pricingRes) applyPricingConfig(pricingRes.config);
      applyBusinessConfig(bizRes?.config || '');
      applyLabelConfig(labelRes?.config || '');
      // Only when the read worked: a failed read keeps what's already loaded.
      if (appRes) applyAppConfig(appRes.config || '');
      applyMasterlistMapping(mlmRes?.config || '');
      if (optRes) applyOptionsConfig(optRes.config || '');
      applyCustomToggles(tglRes?.config || '');
      if (tabRes) applyTabConfig(tabRes.config || '');
      setTabConfigVersion(v => v + 1);
    } catch (err) {
      console.error('Failed to load data:', err);
      toast.error('Failed to load data. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) fetchData(); }, [user, fetchData]);

  // Resolve developer / tenant context (God Mode). Safe no-op in single-tenant mode.
  // devReady flips true once the probe finishes (success OR failure) so the UI
  // never waits forever on it.
  useEffect(() => {
    if (!user) return;
    getMyContext()
      .then((ctx) => {
        setDevContext(ctx);
        // Wipe any cached config/rates belonging to a DIFFERENT customer, then
        // reload so money is never computed with another workspace's numbers.
        // Full reload (not just fetchData): settings live in memory too, and a
        // customer who never saved a setting would otherwise inherit the
        // previous customer's value.
        if (ensureTenantScope(ctx?.activeTenant?.tenantId)) window.location.reload();
      })
      .catch(() => setDevContext(null))
      .finally(() => setDevReady(true));
  }, [user, fetchData]);

  // Move the selected tab only when the user can't see it (first load, a role
  // or tab switched off, preview). A refresh no longer throws anyone back to
  // their default tab.
  useEffect(() => {
    const shown = shownTabRef.current;
    if (shown && shown !== activeTab) setActiveTab(shown);
  });

  const handleUpdate = useCallback(async (rowId: number, fields: Partial<DatabaseRowType>) => {
    // Mirror the server's change-history line locally, so reminders count a new
    // status from now without waiting for a refresh.
    const before = recordsRef.current.find(r => r.id === rowId);
    // Re-picking the SAME status isn't a change — don't restart its deadline clock.
    if (fields.status !== undefined && before && fields.status === before.status) {
      const { status: _same, ...rest } = fields;
      void _same;
      fields = rest;
      if (Object.keys(fields).length === 0) return;
    }
    // Shipping statuses fill in Dispatch / Delivered dates automatically.
    if (fields.status !== undefined && fields.status !== before?.status) {
      const stage = fulfilmentStage(fields.status);
      if (before && !before.shipmentId && !before.dispatchDate && !before.deliveredDate && (stage === 'dispatched' || stage === 'delivered')) {
        fields = { ...fields, shipmentId: shipmentIdentityFor(before, recordsRef.current, new Date().toISOString()) };
      }
      const stamps = autoStageDates({ ...before, ...fields }, fields.status!);
      if (Object.keys(stamps).length) fields = { ...fields, ...stamps };
      fields = { ...fields, ...clearedCancelReason(before, fields) };
    }
    const localAudit = fields.status !== undefined && fields.status !== before?.status
      ? trimAudit([...String(before?.auditTrail ?? '').split('\n').filter(Boolean), `${new Date().toISOString()} | ${user?.email || 'unknown'} | Updated: ${Object.keys(fields).join(', ')}`], 20).join('\n')
      : undefined;
    setRecords(prev => prev.map(r => r.id === rowId ? { ...r, ...fields, ...(localAudit ? { auditTrail: localAudit } : {}) } : r));
    try {
      // Read from the ref so this callback keeps a STABLE identity — otherwise
      // every edit re-renders every memoized card.
      const existing = recordsRef.current.find(r => r.id === rowId);
      await updateRecord({
        rowId,
        fields: fields as Record<string, unknown>,
        existingRecord: existing as Record<string, unknown>,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
      fetchData(true);
    }
  }, [fetchData, user?.email]);

  /** Batched update: optimistic local state for every row, then ONE server call. */
  const handleBulkUpdate = useCallback(async (updates: { rowId: number; fields: Partial<DatabaseRowType> }[]) => {
    if (updates.length === 0) return;
    // Shipping statuses fill in Dispatch / Delivered dates automatically.
    const now = new Date().toISOString();
    updates = updates.map(u => {
      const existing = recordsRef.current.find(r => r.id === u.rowId);
      if (u.fields.status === undefined || u.fields.status === existing?.status) return u;
      const stage = fulfilmentStage(u.fields.status);
      if (existing && !existing.shipmentId && !existing.dispatchDate && !existing.deliveredDate && (stage === 'dispatched' || stage === 'delivered')) {
        u = { ...u, fields: { ...u.fields, shipmentId: shipmentIdentityFor(existing, recordsRef.current, now) } };
      }
      const stamps = { ...autoStageDates({ ...existing, ...u.fields }, u.fields.status!, now), ...clearedCancelReason(existing, u.fields) };
      return Object.keys(stamps).length ? { ...u, fields: { ...u.fields, ...stamps } } : u;
    });
    const byId = new Map(updates.map(u => [u.rowId, u.fields]));
    setRecords(prev => prev.map(r => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r)));
    try {
      // Attach each row's stable key so the write can't land on the wrong row
      // if the sheet was sorted/edited since these records were loaded.
      const stamp = new Date().toISOString();
      const keyed = updates.map(u => {
        const existing = recordsRef.current.find(r => r.id === u.rowId);
        let fields = u.fields;
        // Record status changes in the change history too, so status deadlines
        // (For COD 3 days, Reseller 3 weeks…) count from the day it was set.
        if (fields.status !== undefined && fields.status !== existing?.status && fields.auditTrail === undefined) {
          const lines = String(existing?.auditTrail ?? '').split('\n').filter(Boolean);
          lines.push(`${stamp} | ${user?.email || 'unknown'} | Updated: status (bulk)`);
          fields = { ...fields, auditTrail: trimAudit(lines, 20).join('\n') };
        }
        return { ...u, fields, rowKey: existing?.rowKey };
      });
      const audited = new Map(keyed.filter(k => k.fields.auditTrail !== undefined).map(k => [k.rowId, k.fields.auditTrail]));
      if (audited.size) setRecords(prev => prev.map(r => (audited.has(r.id) ? { ...r, auditTrail: audited.get(r.id) } : r)));
      // Server caps each request; chunk so very large selections still work.
      const CHUNK = 200;
      for (let i = 0; i < keyed.length; i += CHUNK) {
        await bulkUpdateRecords({ updates: keyed.slice(i, i + CHUNK) });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed');
      fetchData(true);
    }
  }, [fetchData, user?.email]);

  const handleSearchChange = useCallback((query: string) => {
    const tab = shownTabRef.current ?? activeTab;
    setSearchQueries(prev => ({ ...prev, [tab]: query }));
  }, [activeTab]);

  const clientMilestones = useMemo(() => computeClientMilestones(records), [records]);

  // Share "developer / previewing" with every component (rates editor etc.).
  useEffect(() => {
    const dev = !!devContext?.isDeveloper;
    const canPrev = dev || getUserRole(user?.email || '', dynamicRoles).includes('super_admin');
    const prev = canPrev && !!previewEmail;
    setDevAccess({
      isDeveloper: dev,
      previewing: prev,
      previewRoles: prev ? getUserRole(previewEmail!, dynamicRoles) : [],
    });
  }, [devContext, previewEmail, dynamicRoles, user?.email]);

  // The user's own liver name (the "name" column in the Roles tab). A liver's
  // "My Sales" is locked to it, so she only ever sees her own sales — never
  // other livers'. When previewing, the previewed user's name instead.
  const ownLiverName = useMemo(() => {
    const email = (previewEmail || user?.email || '').toLowerCase().trim();
    if (!email) return undefined;
    // Listed on more than one row: the first row that has a name.
    const fromRoles = dynamicRoles?.find((r: any) => String(r?.email ?? '').toLowerCase().trim() === email && String(r?.name ?? '').trim());
    const name = fromRoles?.name ? liverKey(fromRoles.name) : '';
    if (name) return name;
    // Fallback to the (usually empty) static map for backwards compatibility.
    const entry = Object.entries(EMAIL_TO_LIVER_NAME).find(([k]) => k.toLowerCase() === email);
    return entry ? liverKey(entry[1]) : undefined;
  }, [previewEmail, user?.email, dynamicRoles]);

  if (authLoading) return <LoadingSkeleton />;
  if (!user) return <WelcomeScreen />;
  if (loading) return <LoadingSkeleton />;

  // Developers (God Mode) always get in, even if their email isn't in a
  // customer's Roles sheet. Wait for the dev-context probe before denying so a
  // developer never briefly sees Access Denied.
  const developerFlag = (devContext?.isDeveloper ?? false) || serverRoles.includes('super_admin');
  if (!developerFlag && roles.length === 0 && serverRoles.length === 0) {
    if (!devReady) return <LoadingSkeleton />;
    return <AccessDenied email={user.email} />;
  }

  // Developers see everything; otherwise use the roles from the Roles sheet.
  const realRoles = developerFlag ? ['super_admin', ...roles] : roles;
  // Only a developer or a real super-admin may preview as someone else.
  const canPreview = developerFlag || roles.includes('super_admin');
  const previewing = canPreview && !!previewEmail;
  // When previewing, render EXACTLY the target user's roles (from the Roles tab).
  const effectiveRoles = previewing ? getUserRole(previewEmail!, dynamicRoles) : realRoles;
  const isSuperAdmin = effectiveRoles.includes('super_admin');
  // Admin, Bossing and Accounts choose any liver on My Sales (their own name
  // preselected if they sell); everyone else is locked to their own name.
  const picksLiver = effectiveRoles.some(r => r === 'super_admin' || r === 'admin' || r === 'bossing' || r === 'accounts');
  const lockedLiverName = picksLiver ? undefined : ownLiverName;
  const visibleTabKeys = getVisibleTabs(effectiveRoles);

  // Labels come from the per-tenant tab config (getTabLabel falls back to the
  // default). tabConfigVersion forces this to recompute after the config loads.
  void tabConfigVersion;
  const allTabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'admin', label: getTabLabel('admin'), icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    { key: 'dispatch', label: getTabLabel('dispatch'), icon: <Truck className="h-3.5 w-3.5" /> },
    { key: 'accounts', label: getTabLabel('accounts'), icon: <Calculator className="h-3.5 w-3.5" /> },
    { key: 'bossing', label: getTabLabel('bossing'), icon: <BarChart2 className="h-3.5 w-3.5" /> },
    { key: 'liver', label: getTabLabel('liver'), icon: <Radio className="h-3.5 w-3.5" /> },
    { key: 'purchasing', label: getTabLabel('purchasing'), icon: <ShoppingBag className="h-3.5 w-3.5" /> },
    { key: 'invoicing', label: getTabLabel('invoicing'), icon: <FileText className="h-3.5 w-3.5" /> },
    { key: 'livesellers', label: getTabLabel('livesellers'), icon: <Scale className="h-3.5 w-3.5" /> },
    { key: 'settings', label: 'Settings', icon: <SettingsIcon className="h-3.5 w-3.5" /> },
  ];

  const isDeveloper = devContext?.isDeveloper ?? false;
  // Role-permitted AND not hidden by the customer's tab config. Settings stays
  // available so the config itself can always be edited.
  // The developer sees every tab, even ones switched off for this customer
  // (marked "hidden"), so nothing is ever out of reach.
  const devSeesAll = isDeveloper && !previewing;
  const visibleTabs = allTabs
    .filter(t => visibleTabKeys.has(t.key) && (t.key === 'settings' || devSeesAll || !isTabHidden(t.key)))
    .map(t => (devSeesAll && t.key !== 'settings' && isTabHidden(t.key) ? { ...t, label: `${t.label} (hidden)` } : t));
  if (isDeveloper && !previewing) {
    visibleTabs.push({ key: 'godmode', label: 'God Mode', icon: <Crown className="h-3.5 w-3.5" /> });
  }
  // Apply the customer's custom tab order to the business tabs; system tabs
  // (settings, god mode) stay at the end.
  const tabOrder = orderConfigurableKeys(CONFIGURABLE_TAB_KEYS);
  const orderIndex = (k: TabKey): number => {
    const i = tabOrder.indexOf(k as ConfigurableTabKey);
    return i === -1 ? 100 : i;
  };
  visibleTabs.sort((a, b) => orderIndex(a.key) - orderIndex(b.key));

  // Render only a tab this user may see; anything else falls back to their
  // default tab (so a liver never lands on the Admin board, even for a frame).
  const firstVisible = DEFAULT_TAB_PRIORITY.find(k => visibleTabs.some(t => t.key === k)) ?? visibleTabs[0]?.key ?? null;
  const shownTab: TabKey | null = visibleTabs.some(t => t.key === activeTab) ? activeTab : firstVisible;
  shownTabRef.current = shownTab;
  // The server sends a liver-only user just her own items (by her real roles,
  // not the previewed ones).
  const liverOnly = isLiverOnly(realRoles);
  // Roles tab couldn't be read: we can't tell whose items are whose.
  const rolesFailed = dynamicRoles === null;

  const activeWorkspace = devContext?.activeTenant?.displayName ?? null;
  const initials = (user.firstName?.[0] || user.email[0]).toUpperCase();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="kt-appbar sticky top-0 z-40 border-b border-border bg-card">
        <div className="brand-gradient-bar" />
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2.5">
            {headerLogo ? (
              <img src={headerLogo} alt={brandSettings.companyName} className="w-8 h-8 rounded-lg object-contain bg-primary" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="font-cinzel text-xs text-primary-foreground font-bold">{brandInitials(brandSettings.companyName)}</span>
              </div>
            )}
            <div>
              <h1 className="kt-brandname font-cinzel text-[11px] text-primary tracking-widest">{brandSettings.companyName.toUpperCase()}</h1>
              <p className="kt-brandsub text-[9px] truncate max-w-[160px] text-muted-foreground">
                {activeWorkspace ? <span className="text-primary">{activeWorkspace}</span> : user.email}
                {isDeveloper && <Crown className="inline h-2.5 w-2.5 ml-1 text-primary" />}
                {!isDeveloper && isSuperAdmin && <Crown className="inline h-2.5 w-2.5 ml-1 text-primary" />}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Livers never see the gold rate (owner decision 2; pending Ken's confirmation). */}
            <RateCalculatorWidget hideGold={liverOnly} />
            <button onClick={toggleCompact} className="p-1.5 transition-colors hover:bg-accent text-muted-foreground" title={isCompact ? 'Expand view' : 'Compact view'}>
              {isCompact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
            {canPreview && dynamicRoles && (
              <PreviewAsUser users={dynamicRoles} value={previewEmail} onChange={setPreviewEmail} />
            )}
            {(effectiveRoles.includes('super_admin') || effectiveRoles.includes('admin')) && <UploadMasterlistFAB onRefresh={fetchData} records={records} />}
            <button
              onClick={() => logout({ returnTo: window.location.origin })}
              className="kt-avatar flex items-center justify-center w-7 h-7 font-cinzel text-[10px] border border-border rounded-md transition-colors hover:bg-accent text-primary"
              title="Sign out"
            >
              {initials}
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="kt-tabs flex px-2 pb-0 gap-0.5 overflow-x-auto no-scrollbar">
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              data-active={shownTab === tab.key ? "true" : undefined}
              className={`kt-tab flex items-center gap-1 px-3 py-2 font-cinzel text-[10px] uppercase whitespace-nowrap transition-all relative ${
                shownTab === tab.key
                  ? 'border-b-2 border-primary text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-primary'
              }`}
              style={{ letterSpacing: '0.2em' }}
            >
              {tab.icon}
              <span>{tab.label}</span>

            </button>
          ))}
        </div>
        {previewing && (
          <div className="flex items-center justify-between px-3 py-1 bg-primary/15 border-t border-primary/30">
            <span className="text-[10px] font-medium text-primary">
              Previewing as {previewEmail} — {effectiveRoles.length ? effectiveRoles.join(', ') : 'no role in Roles tab'}
            </span>
            <button onClick={() => setPreviewEmail(null)} className="text-[10px] font-cinzel uppercase tracking-widest hover:underline text-primary">
              Exit preview
            </button>
          </div>
        )}
      </div>

      {/* Record count */}
      <div className="kt-statusbar flex items-center justify-between px-3 py-1 border-b border-border bg-muted/50">
        <span className="text-[10px] font-medium text-muted-foreground">
          {liverOnly ? `${records.length.toLocaleString()} of your items` : `${records.length.toLocaleString()} records loaded`}
        </span>
        <button onClick={() => fetchData(true)} className="text-[10px] font-cinzel uppercase tracking-widest hover:underline text-primary">
          Refresh
        </button>
      </div>

      {/* Tab Content */}
      {!shownTab && (
        <div className="px-4 py-16 text-center text-sm text-muted-foreground">
          No tabs are switched on for your account — ask the admin.
        </div>
      )}
      {shownTab === 'admin' && (
        <AdminPipeline onBulkUpdate={handleBulkUpdate} records={records} searchQuery={searchQueries.admin} onSearchChange={handleSearchChange} onUpdate={handleUpdate} userEmail={user.email} userFirstName={user.firstName} onRefresh={fetchData} />
      )}
      {shownTab === 'dispatch' && (
        <DispatchBoard onBulkUpdate={handleBulkUpdate} records={records} searchQuery={searchQueries.dispatch} onSearchChange={handleSearchChange} onUpdate={handleUpdate} userEmail={user.email} clientMilestones={clientMilestones} onRefresh={() => fetchData(true)} />
      )}
      {shownTab === 'accounts' && (
        <AccountsTracking records={records} searchQuery={searchQueries.accounts} onSearchChange={handleSearchChange} onUpdate={handleUpdate} userEmail={user.email} userFirstName={user.firstName} onRefresh={fetchData} />
      )}
      {shownTab === 'bossing' && (
        <BossingDashboard records={records} searchQuery={searchQueries.bossing} onSearchChange={handleSearchChange} onUpdate={handleUpdate} />
      )}
      {shownTab === 'liver' && !lockedLiverName && !picksLiver && (
        <div className="px-4 py-16 text-center text-sm text-muted-foreground">
          {rolesFailed ? (
            <>Couldn&apos;t load your account — tap <b>Refresh</b>.</>
          ) : (
            <>Your liver name isn&apos;t set yet. Ask the admin to put your name in the <b>Roles</b> sheet (column &quot;name&quot;), exactly as it appears in the masterlist.</>
          )}
        </div>
      )}
      {/* A liver-only user has only her own rows, so loyalty counts would be short: no badge. */}
      {shownTab === 'liver' && (lockedLiverName || picksLiver) && (
        <LiverDashboard records={records} searchQuery={searchQueries.liver} onSearchChange={handleSearchChange} onUpdate={handleUpdate} lockedLiverName={lockedLiverName} defaultLiver={picksLiver ? ownLiverName : undefined} onRefresh={() => fetchData(true)} previewing={previewing} clientMilestones={liverOnly ? undefined : clientMilestones} recordsReadAt={recordsReadAt} />
      )}
      {shownTab === 'purchasing' && (
        <PurchasingTab userEmail={user.email} />
      )}
      {shownTab === 'invoicing' && (
        <InvoicingTab records={records} searchQuery={searchQueries.invoicing} onSearchChange={handleSearchChange} onUpdate={handleUpdate} onRefresh={() => fetchData(true)} />
      )}
      {shownTab === 'livesellers' && (devSeesAll || !isTabHidden('livesellers')) && (
        <LiveSellersTab records={records} onRecordsChanged={() => fetchData(true)} canEditSettings={effectiveRoles.includes('super_admin') || effectiveRoles.includes('admin')} />
      )}
      {shownTab === 'settings' && <DesignSettings />}
      {shownTab === 'godmode' && <GodModePanel />}
    </div>
  );
}

export default function App() {
  return (
    <BrandThemeLoader>
      <CompactModeProvider>
        <AppContent />
        <Toaster />
      </CompactModeProvider>
    </BrandThemeLoader>
  );
}
