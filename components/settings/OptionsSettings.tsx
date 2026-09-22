"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, ListChecks, X, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getOptionsConfig, saveOptionsConfig } from "@/lib/api";
import {
  OPTION_LISTS,
  applyOptionsConfig,
  getOptionsConfig as getLocalOptions,
  setOptionsConfig,
  serializeOptionsConfig,
  getSuggestedOptions,
  type OptionKey,
  type OptionsConfig,
} from "@/lib/optionsConfig";

/**
 * ONE place to edit every dropdown list in the app. Whatever is saved here wins
 * exactly — so removing a value keeps it removed.
 */
export default function OptionsSettings() {
  const [lists, setLists] = useState<Record<string, string[]>>({});
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOptionsConfig({})
      .then((res) => { if (res.config) applyOptionsConfig(res.config); })
      .catch(() => { /* defaults */ })
      .finally(() => {
        const saved = getLocalOptions();
        const init: Record<string, string[]> = {};
        for (const def of OPTION_LISTS) {
          // Show the saved list, or prefill with what's in use + defaults.
          init[def.key] = saved[def.key]?.length ? [...saved[def.key]!] : getSuggestedOptions(def.key);
        }
        setLists(init);
        setLoading(false);
      });
  }, []);

  const add = (key: OptionKey) => {
    const v = (newValue[key] ?? "").trim();
    if (!v) return;
    setLists((l) => {
      const cur = l[key] ?? [];
      if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return l;
      return { ...l, [key]: [...cur, v] };
    });
    setNewValue((n) => ({ ...n, [key]: "" }));
  };

  const remove = (key: OptionKey, val: string) =>
    setLists((l) => ({ ...l, [key]: (l[key] ?? []).filter((x) => x !== val) }));

  const resetToSuggested = (key: OptionKey) =>
    setLists((l) => ({ ...l, [key]: getSuggestedOptions(key) }));

  const save = async () => {
    setSaving(true);
    try {
      const cfg: OptionsConfig = {};
      for (const def of OPTION_LISTS) cfg[def.key] = lists[def.key] ?? [];
      setOptionsConfig(cfg);
      await saveOptionsConfig({ config: serializeOptionsConfig() });
      toast.success("Options saved. Reloading…");
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading options…
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <ListChecks className="h-4 w-4" /> Dropdown Options (this customer)
      </h2>
      <p className="text-xs text-muted-foreground">
        Every choice list in the app. Add or remove values here — what you save is
        exactly what staff see. Removing a value keeps it removed.
      </p>

      <div className="space-y-4">
        {OPTION_LISTS.map((def) => (
          <div key={def.key} className="rounded-md border border-border/60 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-primary font-semibold">{def.label}</Label>
              <button
                onClick={() => resetToSuggested(def.key)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                title="Reset to defaults + values found in your data"
              >
                <RotateCcw className="h-3 w-3" /> reset
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(lists[def.key] ?? []).map((v) => (
                <span key={v} className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground flex items-center gap-1">
                  {v}
                  <button onClick={() => remove(def.key, v)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {(lists[def.key] ?? []).length === 0 && (
                <span className="text-[11px] text-muted-foreground">No values — staff will see an empty list.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newValue[def.key] ?? ""}
                onChange={(e) => setNewValue((n) => ({ ...n, [def.key]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(def.key); } }}
                placeholder={`Add to ${def.label}…`}
                className="h-8 text-sm w-56"
              />
              <Button size="sm" variant="outline" className="h-8" onClick={() => add(def.key)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-2 flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save options
        </Button>
      </div>
    </section>
  );
}
