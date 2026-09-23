"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getRecords, getRoles, getRatesConfig, getPricingConfig, getTabConfig, getBusinessConfig, getLabelConfig, getAppConfig, getMasterlistMapping, getOptionsConfig, getCustomToggles, updateRecord, bulkUpdateRecords } from '@/lib/api';
import { applyPricingConfig } from '@/lib/pricingConfig';
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
import { LogOut, Minimize2, Maximize2, Crown, LayoutDashboard, Truck, Calculator, BarChart2, Radio, ShoppingBag, FileText, Settings as SettingsIcon } from 'lucide-react';
import { getMyContext } from '@/lib/tenancy';
import type { MyContext } from '@/lib/tenancy-types';
import GodModePanel from '@/components/godmode/GodModePanel';
import { CompactModeProvider, useCompactMode } from '@/lib/compactMode';
import { getUserRole, EMAIL_TO_LIVER_NAME } from '@/config/roles';
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
import DesignSettings from '@/components/settings/DesignSettings';
import UploadMasterlistFAB from '@/components/UploadMasterlistFAB';
import PreviewAsUser from '@/components/PreviewAsUser';
import RateCalculatorWidget from '@/components/RateCalculatorWidget';
type TabKey = 'admin' | 'dispatch' | 'accounts' | 'bossing' | 'liver' | 'purchasing' | 'invoicing' | 'settings' | 'godmode';

function getVisibleTabs(roles: string[]): Set<TabKey> {
  if (roles.includes('super_admin')) {
    return new Set<TabKey>(['admin', 'dispatch', 'accounts', 'bossing', 'liver', 'purchasing', 'invoicing', 'settings']);
  }
  const visible = new Set<TabKey>();
  if (roles.includes('admin')) { visible.add('admin'); visible.add('invoicing'); }
  if (roles.includes('dispatch')) visible.add('dispatch');
  if (roles.includes('accounts')) visible.add('accounts');
  if (roles.includes('bossing')) visible.add('bossing');
  if (roles.includes('liver')) visible.add('liver');
  if (roles.includes('purchasing')) visible.add('purchasing');
  return visible;
}

function AppContent() {
  const { user, isLoading: authLoading, logout } = useAuth();
  const { settings: brandSettings, headerLogo } = useBrand();
  const { isCompact, toggle: toggleCompact } = useCompactMode();

  // Apply the saved motion preference before anything renders.
  useEffect(() => { applyMotionToDom(); }, []);

  const [records, setRecords] = useState<DatabaseRowType[]>([]);
  const recordsRef = useRef<DatabaseRowType[]>([]);
  useEffect(() => { recordsRef.current = records; }, [records]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('admin');
  const [searchQueries, setSearchQueries] = useState<Record<TabKey, string>>({
    admin: '', dispatch: '', accounts: '', bossing: '', liver: '', purchasing: '', invoicing: '', settings: '', godmode: '',
  });
  const [roles, setRoles] = useState<string[]>([]);
  const [dynamicRoles, setDynamicRoles] = useState<any[] | null>(null);
  const [previewEmail, setPreviewEmail] = useState<string | null>(null);
  const [devContext, setDevContext] = useState<MyContext | null>(null);
  const [devReady, setDevReady] = useState(false);
  // Bumped after the per-tenant tab config loads, to re-render the nav with the
  // customer's labels/visibility.
  const [tabConfigVersion, setTabConfigVersion] = useState(0);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [recordsRes, rolesRes, ratesRes, pricingRes, tabRes, bizRes, labelRes, appRes, mlmRes, optRes, tglRes] = await Promise.all([
        getRecords({ tailOnly: false }),
        getRoles({}).catch(() => null),
        getRatesConfig({}).catch(() => ({ config: '' })),
        getPricingConfig({}).catch(() => ({ config: '' })),
        getTabConfig({}).catch(() => ({ config: '' })),
        getBusinessConfig({}).catch(() => ({ config: '' })),
        getLabelConfig({}).catch(() => ({ config: '' })),
        getAppConfig({}).catch(() => ({ config: '' })),
        getMasterlistMapping({}).catch(() => ({ config: '' })),
        getOptionsConfig({}).catch(() => ({ config: '' })),
        getCustomToggles({}).catch(() => ({ config: '' })),
      ]);
      setRecords(recordsRes as DatabaseRowType[]);
      setKnownStatuses(recordsRes as DatabaseRowType[]);
      setKnownOptions(recordsRes as DatabaseRowType[]);
      setDiscoveredOptions(recordsRes as DatabaseRowType[]);
      if (rolesRes) setDynamicRoles(rolesRes as any[]);
      if (ratesRes?.config) applyRatesConfig(ratesRes.config);
      if (pricingRes?.config) applyPricingConfig(pricingRes.config);
      applyBusinessConfig(bizRes?.config || '');
      applyLabelConfig(labelRes?.config || '');
      applyAppConfig(appRes?.config || '');
      applyMasterlistMapping(mlmRes?.config || '');
      applyOptionsConfig(optRes?.config || '');
      applyCustomToggles(tglRes?.config || '');
      applyTabConfig(tabRes?.config || '');
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

  useEffect(() => {
    if (!user?.email) return;
    const userRoles = getUserRole(user.email, dynamicRoles);
    setRoles(userRoles);
    const visible = getVisibleTabs(userRoles);
    const priority: TabKey[] = ['admin', 'dispatch', 'accounts', 'bossing', 'liver', 'purchasing', 'invoicing'];
    const defaultTab = priority.find(t => visible.has(t));
    if (defaultTab) setActiveTab(defaultTab);
  }, [user?.email, dynamicRoles]);

  const handleUpdate = useCallback(async (rowId: number, fields: Partial<DatabaseRowType>) => {
    setRecords(prev => prev.map(r => r.id === rowId ? { ...r, ...fields } : r));
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
      fetchData();
    }
  }, [fetchData]);

  /** Batched update: optimistic local state for every row, then ONE server call. */
  const handleBulkUpdate = useCallback(async (updates: { rowId: number; fields: Partial<DatabaseRowType> }[]) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map(u => [u.rowId, u.fields]));
    setRecords(prev => prev.map(r => (byId.has(r.id) ? { ...r, ...byId.get(r.id)! } : r)));
    try {
      // Attach each row's stable key so the write can't land on the wrong row
      // if the sheet was sorted/edited since these records were loaded.
      const keyed = updates.map(u => ({
        ...u,
        rowKey: recordsRef.current.find(r => r.id === u.rowId)?.rowKey,
      }));
      // Server caps each request; chunk so very large selections still work.
      const CHUNK = 200;
      for (let i = 0; i < keyed.length; i += CHUNK) {
        await bulkUpdateRecords({ updates: keyed.slice(i, i + CHUNK) });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk update failed');
      fetchData();
    }
  }, [fetchData]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQueries(prev => ({ ...prev, [activeTab]: query }));
  }, [activeTab]);

  const clientMilestones = useMemo(() => computeClientMilestones(records), [records]);

  // Each user's "My Sales" is locked to their OWN liver name (the "name" column
  // in the Roles tab), so a liver only ever sees their own sales — never other
  // livers'. When previewing, we lock to the previewed user's name instead.
  const lockedLiverName = useMemo(() => {
    const email = (previewEmail || user?.email || '').toLowerCase().trim();
    if (!email) return undefined;
    const fromRoles = dynamicRoles?.find((r: any) => String(r?.email ?? '').toLowerCase().trim() === email);
    const name = fromRoles?.name ? String(fromRoles.name).toUpperCase().trim() : '';
    if (name) return name;
    // Fallback to the (usually empty) static map for backwards compatibility.
    const entry = Object.entries(EMAIL_TO_LIVER_NAME).find(([k]) => k.toLowerCase() === email);
    return entry ? String(entry[1]).toUpperCase().trim() : undefined;
  }, [previewEmail, user?.email, dynamicRoles]);

  if (authLoading) return <LoadingSkeleton />;
  if (!user) return <WelcomeScreen />;
  if (loading) return <LoadingSkeleton />;

  // Developers (God Mode) always get in, even if their email isn't in a
  // customer's Roles sheet. Wait for the dev-context probe before denying so a
  // developer never briefly sees Access Denied.
  const developerFlag = devContext?.isDeveloper ?? false;
  if (!developerFlag && roles.length === 0) {
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
    { key: 'settings', label: 'Settings', icon: <SettingsIcon className="h-3.5 w-3.5" /> },
  ];

  const isDeveloper = devContext?.isDeveloper ?? false;
  // Role-permitted AND not hidden by the customer's tab config. Settings stays
  // available so the config itself can always be edited.
  const visibleTabs = allTabs.filter(
    t => visibleTabKeys.has(t.key) && (t.key === 'settings' || !isTabHidden(t.key))
  );
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
            <RateCalculatorWidget />
            <button onClick={toggleCompact} className="p-1.5 transition-colors hover:bg-accent text-muted-foreground" title={isCompact ? 'Expand view' : 'Compact view'}>
              {isCompact ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </button>
            {canPreview && dynamicRoles && (
              <PreviewAsUser users={dynamicRoles} value={previewEmail} onChange={setPreviewEmail} />
            )}
            {(effectiveRoles.includes('super_admin') || effectiveRoles.includes('admin')) && <UploadMasterlistFAB onRefresh={fetchData} />}
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
              data-active={activeTab === tab.key ? "true" : undefined}
              className={`kt-tab flex items-center gap-1 px-3 py-2 font-cinzel text-[10px] uppercase whitespace-nowrap transition-all relative ${
                activeTab === tab.key
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
          {records.length.toLocaleString()} records loaded
        </span>
        <button onClick={fetchData} className="text-[10px] font-cinzel uppercase tracking-widest hover:underline text-primary">
          Refresh
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'admin' && (
        <AdminPipeline onBulkUpdate={handleBulkUpdate} records={records} searchQuery={searchQueries.admin} onSearchChange={handleSearchChange} onUpdate={handleUpdate} userEmail={user.email} userFirstName={user.firstName} onRefresh={fetchData} />
      )}
      {activeTab === 'dispatch' && (
        <DispatchBoard records={records} searchQuery={searchQueries.dispatch} onSearchChange={handleSearchChange} onUpdate={handleUpdate} userEmail={user.email} clientMilestones={clientMilestones} />
      )}
      {activeTab === 'accounts' && (
        <AccountsTracking records={records} searchQuery={searchQueries.accounts} onSearchChange={handleSearchChange} onUpdate={handleUpdate} userEmail={user.email} userFirstName={user.firstName} onRefresh={fetchData} />
      )}
      {activeTab === 'bossing' && (
        <BossingDashboard records={records} searchQuery={searchQueries.bossing} onSearchChange={handleSearchChange} onUpdate={handleUpdate} />
      )}
      {activeTab === 'liver' && (
        <LiverDashboard records={records} searchQuery={searchQueries.liver} onSearchChange={handleSearchChange} onUpdate={handleUpdate} lockedLiverName={lockedLiverName} />
      )}
      {activeTab === 'purchasing' && (
        <PurchasingTab userEmail={user.email} />
      )}
      {activeTab === 'invoicing' && (
        <InvoicingTab records={records} searchQuery={searchQueries.invoicing} onSearchChange={handleSearchChange} onUpdate={handleUpdate} />
      )}
      {activeTab === 'settings' && <DesignSettings />}
      {activeTab === 'godmode' && <GodModePanel />}
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
