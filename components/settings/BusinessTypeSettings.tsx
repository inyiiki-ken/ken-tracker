"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getBusinessConfig, saveBusinessConfig } from "@/lib/api";
import {
  BUSINESS_PRESETS,
  applyBusinessConfig,
  getBusinessConfig as getLocalBiz,
  setBusinessConfig,
  serializeBusinessConfig,
} from "@/lib/businessConfig";

/**
 * Per-tenant industry template. The important switch is weight-based (jewellery)
 * vs per-item (retail/cosmetics) pricing — it changes how profit/cost are
 * calculated across the app. Saving reloads so the new math takes effect.
 */
export default function BusinessTypeSettings() {
  const [presetId, setPresetId] = useState<string>("jewellery");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tz, setTz] = useState<number>(getLocalBiz().timezoneOffsetHours ?? 4);

  useEffect(() => {
    getBusinessConfig()
      .then((res) => { if (res.config) applyBusinessConfig(res.config); })
      .catch(() => { /* defaults */ })
      .finally(() => {
        const cfg = getLocalBiz();
        // Best-effort: match the saved mode/preset back to a preset id.
        const match = BUSINESS_PRESETS.find((p) => p.id === cfg.preset) || BUSINESS_PRESETS.find((p) => p.mode === cfg.mode);
        setPresetId(match?.id || (cfg.mode === "unit" ? "retail" : "jewellery"));
        setLoading(false);
      });
  }, []);

  const save = async () => {
    const preset = BUSINESS_PRESETS.find((p) => p.id === presetId) || BUSINESS_PRESETS[0];
    setSaving(true);
    try {
      setBusinessConfig({ ...getLocalBiz(), mode: preset.mode, preset: preset.id, timezoneOffsetHours: tz });
      await saveBusinessConfig({ config: serializeBusinessConfig() });
      toast.success("Business type saved. Reloading…");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading business type…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <Store className="h-4 w-4" /> Business Type
      </h2>
      <p className="text-xs text-muted-foreground">
        Sets how prices and profit are calculated for this workspace. Jewellery is
        weight-based (grams × rate + making charge); retail/cosmetics price per item
        (unit price × qty). Saving reloads the app.
      </p>

      <div className="grid grid-cols-1 gap-2">
        {BUSINESS_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`text-left px-3 py-2.5 rounded-md border transition-colors ${
              presetId === p.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            <div className="text-sm font-medium">{p.label}</div>
            <div className="text-[11px] text-muted-foreground">{p.hint}</div>
          </button>
        ))}
      </div>

      <div className="flex justify-end">
      <div className="pt-2 border-t border-border">
        <Label className="text-xs text-muted-foreground">Timezone offset from UTC (hours)</Label>
        <Input
          type="number"
          step="0.5"
          value={String(tz)}
          onChange={(e) => setTz(parseFloat(e.target.value) || 0)}
          className="h-8 text-sm w-28 mt-0.5"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          UAE = 4, Philippines = 8. Controls what counts as &quot;today&quot; and when items become overdue.
        </p>
      </div>

        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save business type
        </Button>
      </div>
    </section>
  );
}
