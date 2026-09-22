"use client";

import { useEffect, useState } from "react";
import { Loader2, Crown, Plus, Check, Building2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getMyContext, switchTenant, saveTenant } from "@/lib/tenancy";
import { backfillRowKeys } from "@/lib/api";
import type { MyContext, Tenant } from "@/lib/tenancy-types";
import NewCustomerWizard from "@/components/godmode/NewCustomerWizard";
import MasterlistImportSetup from "@/components/godmode/MasterlistImportSetup";

/**
 * Developer-only console: manage every customer (tenant) from one place, switch
 * which workspace is active, and add a new customer by pasting their sheet link
 * (validated before saving). Switching reloads so all tabs show that customer's
 * data.
 */
export default function GodModePanel() {
  const [ctx, setCtx] = useState<MyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [keying, setKeying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setCtx(await getMyContext());
    } catch {
      toast.error("Failed to load God Mode context.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // One-time data-safety migration for the ACTIVE customer.
  const runBackfill = async () => {
    setKeying(true);
    try {
      const res = await backfillRowKeys();
      if (!res.success) toast.error(res.error || "Backfill failed.");
      else if (res.updated === 0) toast.success(`All ${res.total} rows already have a Row Key.`);
      else toast.success(`Added a Row Key to ${res.updated} of ${res.total} rows.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setKeying(false);
    }
  };

  const onSwitch = async (t: Tenant) => {
    setSwitching(t.tenantId);
    try {
      await switchTenant({ tenantId: t.tenantId });
      toast.success(`Switched to ${t.displayName}. Reloading…`);
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Switch failed");
      setSwitching(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading God Mode…
      </div>
    );
  }

  if (!ctx?.isDeveloper) {
    return (
      <div className="max-w-md mx-auto p-8 text-center space-y-2">
        <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">This area is for the developer account only.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-cinzel text-xl text-primary flex items-center gap-2">
            <Crown className="h-5 w-5" /> God Mode
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ctx.multiTenant
              ? <>{ctx.tenants.length} customer{ctx.tenants.length !== 1 ? "s" : ""} · active: <span className="text-primary">{ctx.activeTenant?.displayName ?? "none"}</span></>
              : "Config generator (multi-tenant off)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {ctx.multiTenant && ctx.controlError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">Can&apos;t read your Control sheet</p>
          <p className="text-xs text-muted-foreground mt-1 font-mono break-words">{ctx.controlError}</p>
          <p className="text-xs text-muted-foreground mt-2">
            Fix: share the Control sheet (Editor) with your service account, make sure the tab is
            named exactly <span className="font-mono">Tenants</span>, and that CONTROL_SHEET_ID is
            that sheet&apos;s ID. Then click Refresh.
          </p>
        </div>
      )}

      {/* New Customer wizard — generates each customer's .env; registers them
          in the Control sheet when multi-tenant is on. */}
      <NewCustomerWizard multiTenant={ctx.multiTenant} onRegistered={load} />

      {/* Per-customer masterlist import setup (auto-detect columns from a sample). */}
      <MasterlistImportSetup activeName={ctx.activeTenant?.displayName} />

      {/* Data safety: stable row identity */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="font-cinzel text-sm text-primary">Row Keys (data safety)</h2>
        <p className="text-xs text-muted-foreground">
          Gives every existing row a permanent key so edits target the right record even if
          someone sorts, inserts or deletes rows directly in the Google Sheet. New rows get one
          automatically. Run this once per customer — it&apos;s safe to run again.
          Requires a <span className="font-mono">Row Key</span> column on the Database tab.
        </p>
        <Button size="sm" variant="outline" onClick={runBackfill} disabled={keying}>
          {keying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
          Backfill Row Keys for {ctx.activeTenant?.displayName || "active customer"}
        </Button>
      </div>

      {!ctx.multiTenant && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
          Central customer management (switch between customers) is off. To enable it,
          set <code className="font-mono text-xs">CONTROL_SHEET_ID</code> +
          <code className="font-mono text-xs"> DEVELOPER_EMAILS</code> and add a
          <span className="font-mono text-xs"> Tenants</span> tab to your control sheet.
          The wizard above works regardless.
        </div>
      )}

      {ctx.multiTenant && (
      <div className="space-y-2">
        {ctx.tenants.map((t) => {
          const isActive = ctx.activeTenant?.tenantId === t.tenantId;
          return (
            <div
              key={t.tenantId}
              className={`rounded-lg border p-3 flex items-center gap-3 ${
                isActive ? "border-primary/50 bg-primary/5" : "border-border bg-card"
              }`}
            >
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{t.displayName}</p>
                  {!t.active && <span className="text-[10px] text-destructive uppercase tracking-wide">inactive</span>}
                  {t.plan && <span className="text-[10px] text-muted-foreground">· {t.plan}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {t.allowedEmails || t.emailDomain || "no emails set"} · sheet {t.sheetId.slice(0, 10)}…
                </p>
              </div>
              {isActive ? (
                <span className="text-xs text-primary flex items-center gap-1 shrink-0">
                  <Check className="h-3.5 w-3.5" /> Active
                </span>
              ) : (
                <Button size="sm" variant="outline" disabled={switching === t.tenantId} onClick={() => onSwitch(t)}>
                  {switching === t.tenantId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Switch"}
                </Button>
              )}
            </div>
          );
        })}
        {ctx.tenants.length === 0 && (
          <div className="text-center py-10 border border-dashed border-border rounded-xl">
            <p className="text-sm text-muted-foreground">No customers yet — register your first one with the wizard above.</p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function AddTenantForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    displayName: "",
    allowedEmails: "",
    emailDomain: "",
    sheetIdOrUrl: "",
    plan: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.displayName.trim()) return toast.error("Give the customer a name.");
    if (!form.sheetIdOrUrl.trim()) return toast.error("Paste the customer's sheet link or ID.");
    if (!form.allowedEmails.trim() && !form.emailDomain.trim())
      return toast.error("Add at least one allowed email or an email domain.");
    setSaving(true);
    try {
      const res = await saveTenant(form);
      toast.success(`Saved ${res.tenant.displayName}.`);
      if (res.warning) toast.warning(res.warning);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="font-cinzel text-sm text-primary">New customer</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Business name" value={form.displayName} onChange={set("displayName")} placeholder="MYKabayan" />
        <Field label="Plan (optional)" value={form.plan} onChange={set("plan")} placeholder="Pro / Trial" />
        <Field
          label="Allowed emails (comma-separated)"
          value={form.allowedEmails}
          onChange={set("allowedEmails")}
          placeholder="owner@gmail.com, staff@gmail.com"
        />
        <Field label="Or email domain (optional)" value={form.emailDomain} onChange={set("emailDomain")} placeholder="acme.com" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Google Sheet link or ID</Label>
        <Input
          value={form.sheetIdOrUrl}
          onChange={set("sheetIdOrUrl")}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Share the sheet as Editor with your service account first, or validation fails.
        </p>
      </div>
      <Field label="Notes (optional)" value={form.notes} onChange={set("notes")} placeholder="anything" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDone} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          Validate &amp; save
        </Button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={value} onChange={onChange} placeholder={placeholder} className="text-sm" />
    </div>
  );
}
