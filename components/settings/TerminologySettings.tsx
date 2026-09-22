"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getLabelConfig, saveLabelConfig } from "@/lib/api";
import {
  LABEL_KEYS,
  applyLabelConfig,
  getLabelConfig as getLocalLabels,
  getDefaultLabel,
  setLabelConfig,
  serializeLabelConfig,
  type LabelKey,
} from "@/lib/labelConfig";

const FRIENDLY: Record<LabelKey, string> = {
  minerName: "Customer / client field",
  liverName: "Seller / live host field",
  page: "Page / store field",
  itemDescription: "Item / product field",
  clientRate: "Selling rate field",
  supplierRate: "Cost rate field",
};

/**
 * Per-tenant terminology overrides. Defaults follow the Business Type (jewellery
 * vs per-item); here you can rename any customer-facing term. Saving reloads.
 */
export default function TerminologySettings() {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getLabelConfig()
      .then((res) => { if (res.config) applyLabelConfig(res.config); })
      .catch(() => { /* defaults */ })
      .finally(() => {
        const cfg = getLocalLabels();
        const o: Record<string, string> = {};
        for (const k of LABEL_KEYS) o[k] = cfg.overrides[k] ?? "";
        setOverrides(o);
        setLoading(false);
      });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const clean: { overrides: Partial<Record<LabelKey, string>> } = { overrides: {} };
      for (const k of LABEL_KEYS) if (overrides[k]?.trim()) clean.overrides[k] = overrides[k].trim();
      setLabelConfig(clean);
      await saveLabelConfig({ config: serializeLabelConfig() });
      toast.success("Terminology saved. Reloading…");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading terminology…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <Type className="h-4 w-4" /> Terminology
      </h2>
      <p className="text-xs text-muted-foreground">
        Rename customer-facing terms for this workspace. Leave blank to use the
        Business Type default (shown as the placeholder). Saving reloads the app.
      </p>

      <div className="space-y-3">
        {LABEL_KEYS.map((k) => (
          <div key={k} className="grid grid-cols-[1fr,1.2fr] items-center gap-2">
            <Label className="text-xs text-muted-foreground">{FRIENDLY[k]}</Label>
            <Input
              value={overrides[k] ?? ""}
              onChange={(e) => setOverrides((o) => ({ ...o, [k]: e.target.value }))}
              placeholder={getDefaultLabel(k)}
              className="h-8 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save terminology
        </Button>
      </div>
    </section>
  );
}
