"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Calculator, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getPricingConfig, savePricingConfig } from "@/lib/api";
import {
  DEFAULT_PRICING,
  getPricing,
  setPricing,
  serializePricingConfig,
  applyPricingConfig,
  type PricingConfig,
} from "@/lib/pricingConfig";

/**
 * Per-tenant pricing editor. Edits the numbers that used to be hardcoded
 * (USD→AED, gold making-charge tiers by category, per-piece supplier rates,
 * B1T1 multiplier) and saves them to the active customer's sheet. PHP + silver
 * rates are edited separately in the Daily Rates editor.
 */
export default function PricingSettings() {
  const [cfg, setCfg] = useState<PricingConfig>(getPricing());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPricingConfig()
      .then((res) => {
        if (res.config) {
          applyPricingConfig(res.config);
          setCfg(getPricing());
        }
      })
      .catch(() => { /* keep defaults */ })
      .finally(() => setLoading(false));
  }, []);

  const num = (v: string, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const setMc = (cat: string, v: string) =>
    setCfg((c) => ({ ...c, makingCharges: { ...c.makingCharges, [cat]: num(v) } }));
  const setPerPc = (tog: string, v: string) =>
    setCfg((c) => ({ ...c, perPcRates: { ...c.perPcRates, [tog]: num(v) } }));

  const save = async () => {
    setSaving(true);
    try {
      setPricing(cfg); // update in-memory + cache so calcs use it immediately
      await savePricingConfig({ config: serializePricingConfig() });
      toast.success("Pricing saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save pricing");
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => setCfg({ ...DEFAULT_PRICING, makingCharges: { ...DEFAULT_PRICING.makingCharges }, perPcRates: { ...DEFAULT_PRICING.perPcRates } });

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing…
      </div>
    );
  }

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
          <Calculator className="h-4 w-4" /> Pricing &amp; Rates
        </h2>
        <Button size="sm" variant="ghost" className="text-xs" onClick={resetDefaults}>Reset to defaults</Button>
      </div>

      <p className="text-xs text-muted-foreground">
        These numbers feed every profit/cost calculation for the workspace you&apos;re
        currently in (in God Mode, the customer you&apos;ve switched into). PHP and silver
        sell/cost rates are set in the Daily Rates editor.
      </p>

      {/* Conversion + fallbacks */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <NumField label="USD → AED" value={cfg.usdToAed} onChange={(v) => setCfg((c) => ({ ...c, usdToAed: num(v, DEFAULT_PRICING.usdToAed) }))} />
        <NumField label="Per-PC fallback" value={cfg.perPcFallback} onChange={(v) => setCfg((c) => ({ ...c, perPcFallback: num(v, DEFAULT_PRICING.perPcFallback) }))} />
        <NumField label="B1T1 multiplier" value={cfg.b1t1Multiplier} onChange={(v) => setCfg((c) => ({ ...c, b1t1Multiplier: num(v, DEFAULT_PRICING.b1t1Multiplier) }))} />
      </div>

      {/* Credit-card surcharge */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
        <NumField label="Credit-card surcharge %" value={cfg.ccSurchargePct} onChange={(v) => setCfg((c) => ({ ...c, ccSurchargePct: num(v, DEFAULT_PRICING.ccSurchargePct) }))} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground col-span-2 sm:col-span-2 pb-2">
          <input
            type="checkbox"
            checked={cfg.ccIncludeShipping}
            onChange={(e) => setCfg((c) => ({ ...c, ccIncludeShipping: e.target.checked }))}
            className="h-4 w-4"
          />
          CC surcharge includes shipping by default
        </label>
      </div>

      {/* Making charges by category */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Gold making charge (MC) by category</Label>
        <KeyNumEditor
          entries={cfg.makingCharges}
          onChange={setMc}
          onRemove={(k) => setCfg((c) => { const m = { ...c.makingCharges }; delete m[k]; return { ...c, makingCharges: m }; })}
          onAdd={(k) => setCfg((c) => ({ ...c, makingCharges: { ...c.makingCharges, [k]: 0 } }))}
          addPlaceholder="New category"
        />
      </div>

      {/* Shipping fees by region */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">
          Shipping fee by region (match is case-insensitive; add any spelling your data uses)
        </Label>
        <KeyNumEditor
          entries={cfg.shippingFees}
          onChange={(k, v) => setCfg((c) => ({ ...c, shippingFees: { ...c.shippingFees, [k]: parseFloat(v) || 0 } }))}
          onRemove={(k) => setCfg((c) => { const m = { ...c.shippingFees }; delete m[k]; return { ...c, shippingFees: m }; })}
          onAdd={(k) => setCfg((c) => ({ ...c, shippingFees: { ...c.shippingFees, [k.toLowerCase()]: 0 } }))}
          addPlaceholder="New region"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div>
            <Label className="text-xs text-muted-foreground">Other regions (default)</Label>
            <Input type="number" value={String(cfg.shippingFeeDefault)}
              onChange={(e) => setCfg((c) => ({ ...c, shippingFeeDefault: parseFloat(e.target.value) || 0 }))}
              className="h-8 text-sm mt-0.5" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Pinas / International</Label>
            <Input type="number" value={String(cfg.shippingFeeInternational)}
              onChange={(e) => setCfg((c) => ({ ...c, shippingFeeInternational: parseFloat(e.target.value) || 0 }))}
              className="h-8 text-sm mt-0.5" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Meet Up</Label>
            <Input type="number" value={String(cfg.shippingFeeMeetUp)}
              onChange={(e) => setCfg((c) => ({ ...c, shippingFeeMeetUp: parseFloat(e.target.value) || 0 }))}
              className="h-8 text-sm mt-0.5" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">Pick Up Shop is always 0.</p>
      </div>

      {/* Per-PC rates by T.O.G */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Per-PC supplier rate by T.O.G (use “default” for the fallback)</Label>
        <KeyNumEditor
          entries={cfg.perPcRates}
          onChange={setPerPc}
          onRemove={(k) => setCfg((c) => { const m = { ...c.perPcRates }; delete m[k]; return { ...c, perPcRates: m }; })}
          onAdd={(k) => setCfg((c) => ({ ...c, perPcRates: { ...c.perPcRates, [k]: 0 } }))}
          addPlaceholder="New T.O.G"
        />
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save pricing
        </Button>
      </div>
    </section>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" step="0.01" value={String(value)} onChange={(e) => onChange(e.target.value)} className="text-sm" />
    </div>
  );
}

function KeyNumEditor({
  entries, onChange, onRemove, onAdd, addPlaceholder,
}: {
  entries: Record<string, number>;
  onChange: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onAdd: (key: string) => void;
  addPlaceholder: string;
}) {
  const [newKey, setNewKey] = useState("");
  return (
    <div className="space-y-2">
      {Object.entries(entries).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-xs w-40 truncate" title={k}>{k}</span>
          <Input type="number" step="0.01" value={String(v)} onChange={(e) => onChange(k, e.target.value)} className="h-8 text-sm w-28" />
          <button onClick={() => onRemove(k)} className="text-muted-foreground hover:text-destructive" title="Remove">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder={addPlaceholder} className="h-8 text-sm w-40" />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => { const k = newKey.trim(); if (k) { onAdd(k); setNewKey(""); } }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}
