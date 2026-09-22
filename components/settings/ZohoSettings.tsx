"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Receipt, PlugZap, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getZohoSettings, saveZohoSettings, testZohoConnection } from "@/lib/zoho/actions";
import { DEFAULT_ZOHO_SETTINGS, ZOHO_REGIONS, type ZohoSettings as Z } from "@/lib/zoho/types";

/** Per-customer Zoho Invoice connection. Credentials stay on the server. */
export default function ZohoSettings() {
  const [s, setS] = useState<Z>(DEFAULT_ZOHO_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);

  useEffect(() => {
    getZohoSettings()
      .then((res) => setS(res.settings))
      .catch(() => { /* not configured yet */ })
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof Z>(k: K, v: Z[K]) => setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await saveZohoSettings({ settings: s });
      toast.success("Zoho settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const res = await testZohoConnection();
      setStatus(res.ok ? { ok: true, msg: "Connected to Zoho." } : { ok: false, msg: res.error || "Failed." });
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : "Failed." });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Zoho settings…
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <Receipt className="h-4 w-4" /> Zoho Invoice (this customer)
      </h2>
      <p className="text-xs text-muted-foreground">
        Connect this customer&apos;s own Zoho account so the app can create their customers and
        raise invoices there. Zoho keeps ownership of invoice numbers. Credentials are stored
        server-side and never shown again after saving.
      </p>

      {/* Master switch — nothing is sent to Zoho while this is off. */}
      <label className={`flex items-center gap-2.5 rounded-md border p-3 cursor-pointer ${s.enabled ? 'border-success/40 bg-success/5' : 'border-border'}`}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4" />
        <span className="text-xs">
          <b className={s.enabled ? 'text-success' : 'text-foreground'}>
            {s.enabled ? 'Sending to Zoho is ON' : 'Sending to Zoho is OFF'}
          </b>
          <span className="block text-muted-foreground text-[11px] mt-0.5">
            While off, the app never contacts Zoho. Set up and test first, then switch on.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Organization ID</Label>
          <Input value={s.organizationId} onChange={(e) => set("organizationId", e.target.value)} className="h-8 text-sm mt-0.5 font-mono" placeholder="60012345678" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data centre</Label>
          <Select
            value={s.apiDomain}
            onValueChange={(v) => {
              const r = ZOHO_REGIONS.find((x) => x.api === v);
              setS((p) => ({ ...p, apiDomain: v, accountsDomain: r?.accounts ?? p.accountsDomain }));
            }}
          >
            <SelectTrigger className="h-8 text-sm mt-0.5"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {ZOHO_REGIONS.map((r) => (
                <SelectItem key={r.api} value={r.api} className="text-xs text-foreground">{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Client ID</Label>
          <Input value={s.clientId} onChange={(e) => set("clientId", e.target.value)} className="h-8 text-sm mt-0.5 font-mono" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Client Secret</Label>
          <Input value={s.clientSecret} onChange={(e) => set("clientSecret", e.target.value)} className="h-8 text-sm mt-0.5 font-mono" type="password" />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Refresh Token</Label>
          <Input value={s.refreshToken} onChange={(e) => set("refreshToken", e.target.value)} className="h-8 text-sm mt-0.5 font-mono" type="password" />
        </div>
      </div>

      {/* Tax — must be confirmed by the customer's accountant */}
      <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
        <p className="text-xs font-medium text-warning flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> Confirm these with the customer&apos;s accountant
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Tax rate %</Label>
            <Input type="number" step="0.01" value={String(s.taxPercent)} onChange={(e) => set("taxPercent", parseFloat(e.target.value) || 0)} className="h-8 text-sm mt-0.5" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Zoho tax ID (optional)</Label>
            <Input value={s.taxId} onChange={(e) => set("taxId", e.target.value)} className="h-8 text-sm mt-0.5 font-mono" placeholder="overrides rate" />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs cursor-pointer pb-1.5">
              <input type="checkbox" checked={s.pricesIncludeTax} onChange={(e) => set("pricesIncludeTax", e.target.checked)} className="h-4 w-4" />
              Prices already include tax
            </label>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={s.createAsDraft} onChange={(e) => set("createAsDraft", e.target.checked)} className="h-4 w-4" />
        Create invoices as drafts (accounts reviews before sending)
      </label>

      {status && (
        <div className={`rounded-md border p-2 text-xs flex items-center gap-1.5 ${status.ok ? "border-success/40 bg-success/5 text-success" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>
          {status.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          {status.msg}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          Save Zoho settings
        </Button>
        <Button size="sm" variant="outline" onClick={test} disabled={testing}>
          {testing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <PlugZap className="h-4 w-4 mr-1.5" />}
          Test connection
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Add a <span className="font-mono">Zoho Contact ID</span> column to the Database tab so each
        client stays linked to their Zoho record — that&apos;s what prevents duplicate customers.
      </p>
    </section>
  );
}
