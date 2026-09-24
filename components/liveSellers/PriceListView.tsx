"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveLivePriceList } from "@/lib/api";
import type { LivePriceList } from "@/lib/liveSellers";
import { Field } from "./parts";

export default function PriceListView({ priceList, canEdit, onSaved }: { priceList: LivePriceList; canEdit: boolean; onSaved: () => Promise<void> | void }) {
  const [types, setTypes] = useState(priceList.types.map((t) => ({ name: t.name, rate: String(t.rate) })));
  const [currency, setCurrency] = useState(priceList.currency);
  const [holdWarnDays, setHoldWarnDays] = useState(String(priceList.holdWarnDays));
  const [notMovingDays, setNotMovingDays] = useState(String(priceList.notMovingDays));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTypes(priceList.types.map((t) => ({ name: t.name, rate: String(t.rate) })));
    setCurrency(priceList.currency);
    setHoldWarnDays(String(priceList.holdWarnDays));
    setNotMovingDays(String(priceList.notMovingDays));
  }, [priceList]);

  const save = async () => {
    const clean = types.map((t) => ({ name: t.name.trim(), rate: parseFloat(t.rate) || 0 })).filter((t) => t.name);
    if (!clean.length) return toast.error("Add at least one type.");
    const names = new Set<string>();
    for (const t of clean) {
      const k = t.name.toLowerCase();
      if (names.has(k)) return toast.error(`"${t.name}" is listed twice.`);
      names.add(k);
    }
    setSaving(true);
    try {
      await saveLivePriceList({
        config: JSON.stringify({
          currency: currency.trim().toUpperCase() || "AED",
          types: clean,
          holdWarnDays: parseInt(holdWarnDays) || 7,
          notMovingDays: parseInt(notMovingDays) || 30,
        }),
      });
      toast.success("Price list saved. New items use these rates.");
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-xs text-muted-foreground">
        Price per gram for each type. Items already recorded keep the rate they were saved with.
      </p>
      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="grid grid-cols-[1fr_7rem_2rem] gap-2 text-[11px] text-muted-foreground px-1">
          <span>Type</span><span className="text-right">Rate / g ({currency})</span><span />
        </div>
        {types.map((t, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_7rem_2rem] gap-2 items-center">
            <Input value={t.name} disabled={!canEdit} onChange={(e) => setTypes((ts) => ts.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} className="h-8 text-sm" />
            <Input type="number" step="any" value={t.rate} disabled={!canEdit} onChange={(e) => setTypes((ts) => ts.map((x, i) => (i === idx ? { ...x, rate: e.target.value } : x)))} className="h-8 text-sm text-right" />
            {canEdit ? (
              <button onClick={() => setTypes((ts) => ts.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive justify-self-center" title="Remove">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : <span />}
          </div>
        ))}
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setTypes((ts) => [...ts, { name: "", rate: "" }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add type
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Currency"><Input value={currency} disabled={!canEdit} onChange={(e) => setCurrency(e.target.value)} className="text-sm uppercase" /></Field>
        <Field label="Warn when holding (days)"><Input type="number" value={holdWarnDays} disabled={!canEdit} onChange={(e) => setHoldWarnDays(e.target.value)} className="text-sm" /></Field>
        <Field label="Not moving after (days)"><Input type="number" value={notMovingDays} disabled={!canEdit} onChange={(e) => setNotMovingDays(e.target.value)} className="text-sm" /></Field>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save price list
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only an admin can change the price list.</p>
      )}
    </div>
  );
}
