"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, LayoutGrid, ChevronUp, ChevronDown, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getTabConfig, saveTabConfig } from "@/lib/api";
import {
  CONFIGURABLE_TAB_KEYS,
  DEFAULT_TAB_LABELS,
  applyTabConfig,
  getTabConfig as getLocalTabConfig,
  setTabConfig,
  serializeTabConfig,
  type ConfigurableTabKey,
  type TabConfig,
} from "@/lib/tabConfig";

/**
 * Per-tenant tab editor: show/hide, rename, and reorder the business tabs for
 * the active customer. Saves to their sheet; a full reload picks up the new nav.
 */
export default function TabSettings() {
  const [order, setOrder] = useState<ConfigurableTabKey[]>([...CONFIGURABLE_TAB_KEYS]);
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTabConfig()
      .then((res) => { if (res.config) applyTabConfig(res.config); })
      .catch(() => { /* defaults */ })
      .finally(() => {
        const cfg = getLocalTabConfig();
        const ord = cfg.order && cfg.order.length ? dedupeOrder(cfg.order) : [...CONFIGURABLE_TAB_KEYS];
        setOrder(ord);
        const vis: Record<string, boolean> = {};
        const lab: Record<string, string> = {};
        for (const k of CONFIGURABLE_TAB_KEYS) {
          vis[k] = cfg.overrides[k]?.visible !== false;
          lab[k] = cfg.overrides[k]?.label ?? "";
        }
        setVisible(vis);
        setLabels(lab);
        setLoading(false);
      });
  }, []);

  const move = (idx: number, dir: -1 | 1) => {
    setOrder((cur) => {
      const next = [...cur];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const buildConfig = (): TabConfig => {
    const overrides: TabConfig["overrides"] = {};
    for (const k of CONFIGURABLE_TAB_KEYS) {
      const o: { visible?: boolean; label?: string } = {};
      if (visible[k] === false) o.visible = false;
      if (labels[k] && labels[k].trim() && labels[k].trim() !== DEFAULT_TAB_LABELS[k]) o.label = labels[k].trim();
      if (o.visible !== undefined || o.label !== undefined) overrides[k] = o;
    }
    return { overrides, order };
  };

  const save = async () => {
    setSaving(true);
    try {
      setTabConfig(buildConfig());
      await saveTabConfig({ config: serializeTabConfig() });
      toast.success("Tabs saved. Reloading to apply…");
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save tabs");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading tabs…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <LayoutGrid className="h-4 w-4" /> Tabs
      </h2>
      <p className="text-xs text-muted-foreground">
        Show/hide, rename, and reorder the tabs for the workspace you&apos;re currently
        in. (In God Mode this is whichever customer you&apos;ve switched into; otherwise
        it&apos;s this account.) Renaming only changes the label — e.g. “Bossing” →
        “Rexie/Analyn”. A user still needs the matching role to see a tab. Saving
        reloads the app.
      </p>

      <div className="space-y-2">
        {order.map((k, idx) => (
          <div key={k} className="flex items-center gap-2 rounded-md border border-border p-2">
            <div className="flex flex-col">
              <button onClick={() => move(idx, -1)} disabled={idx === 0} className="text-muted-foreground disabled:opacity-30 hover:text-primary">
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => move(idx, 1)} disabled={idx === order.length - 1} className="text-muted-foreground disabled:opacity-30 hover:text-primary">
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground w-20 shrink-0">{DEFAULT_TAB_LABELS[k]}</span>
            <Input
              value={labels[k]}
              onChange={(e) => setLabels((l) => ({ ...l, [k]: e.target.value }))}
              placeholder={DEFAULT_TAB_LABELS[k]}
              className="h-8 text-sm flex-1"
            />
            <button
              onClick={() => setVisible((v) => ({ ...v, [k]: !v[k] }))}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${
                visible[k] ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
              }`}
              title={visible[k] ? "Visible" : "Hidden"}
            >
              {visible[k] ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              {visible[k] ? "Shown" : "Hidden"}
            </button>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save tabs
        </Button>
      </div>
    </section>
  );
}

function dedupeOrder(order: ConfigurableTabKey[]): ConfigurableTabKey[] {
  const seen = new Set<ConfigurableTabKey>();
  const out: ConfigurableTabKey[] = [];
  for (const k of order) if (CONFIGURABLE_TAB_KEYS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  for (const k of CONFIGURABLE_TAB_KEYS) if (!seen.has(k)) out.push(k);
  return out;
}
