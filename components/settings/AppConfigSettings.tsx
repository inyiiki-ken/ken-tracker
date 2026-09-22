"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { getAppConfig, saveAppConfig } from "@/lib/api";
import {
  ALIASABLE_FIELDS,
  HIDEABLE_FIELDS,
  applyAppConfig,
  getAppConfig as getLocalAppConfig,
  setAppConfig,
  serializeAppConfig,
} from "@/lib/appConfig";
import { DEFAULT_ADMIN_STATUSES, DEFAULT_ACCOUNTS_STATUSES } from "@/lib/statusRegistry";
import { getMotionEnabled, setMotionEnabled } from "@/lib/motionPref";

// The per-team status lists the developer can customize.
const STATUS_TABS: { key: string; label: string; hint: string }[] = [
  { key: "admin", label: "Admin / Intake team", hint: DEFAULT_ADMIN_STATUSES.join(", ") },
  { key: "accounts", label: "Accounts team", hint: DEFAULT_ACCOUNTS_STATUSES.join(", ") },
  { key: "dispatch", label: "Dispatch team", hint: "full list + every courier from your data (auto)" },
];

/**
 * Developer self-service controls per customer: column mapping (aliases),
 * which sections are hidden, and the status dropdown options. No code needed.
 */
export default function AppConfigSettings() {
  const [aliases, setAliases] = useState<Record<string, string[]>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [statusByTab, setStatusByTab] = useState<Record<string, string>>({});
  const [requirePullout, setRequirePullout] = useState(true);
  const [motion, setMotion] = useState(true);
  useEffect(() => { setMotion(getMotionEnabled()); }, []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAppConfig()
      .then((res) => { if (res.config) applyAppConfig(res.config); })
      .catch(() => { /* defaults */ })
      .finally(() => {
        const c = getLocalAppConfig();
        setAliases(c.columnAliases);
        setHidden(c.hiddenFields);
        setStatuses(c.statusOptions);
        const byTab: Record<string, string> = {};
        for (const t of STATUS_TABS) byTab[t.key] = (c.statusOptionsByTab?.[t.key] ?? []).join(", ");
        setStatusByTab(byTab);
        setRequirePullout(c.requirePaymentForPullout !== false);
        setLoading(false);
      });
  }, []);

  const setAlias = (key: string, value: string) =>
    setAliases((a) => ({ ...a, [key]: value.split(",").map((s) => s.trim()).filter(Boolean) }));

  const toggleHidden = (key: string) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const save = async () => {
    setSaving(true);
    try {
      const statusOptionsByTab: Record<string, string[]> = {};
      for (const t of STATUS_TABS) {
        const list = (statusByTab[t.key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length) statusOptionsByTab[t.key] = list;
      }
      setAppConfig({ columnAliases: aliases, hiddenFields: hidden, statusOptions: statuses, statusOptionsByTab, requirePaymentForPullout: requirePullout });
      await saveAppConfig({ config: serializeAppConfig() });
      toast.success("App settings saved. Reloading…");
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading app settings…
      </div>
    );
  }

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <Sliders className="h-4 w-4" /> App Settings (this customer)
      </h2>
      <p className="text-xs text-muted-foreground">
        Customize how the app behaves for the workspace you&apos;re in — no code. Saving reloads.
      </p>

      {/* Column aliases */}
      <div>
        <Label className="text-xs text-primary font-semibold">Column mapping</Label>
        <p className="text-[11px] text-muted-foreground mb-2">
          If this customer&apos;s sheet uses a different column name, list it here (comma-separated).
          e.g. Supplier rate → <span className="font-mono">Cost</span>.
        </p>
        <div className="space-y-2">
          {ALIASABLE_FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-[1fr,1.4fr] items-center gap-2">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <Input
                value={(aliases[f.key] ?? []).join(", ")}
                onChange={(e) => setAlias(f.key, e.target.value)}
                placeholder="alternate column name(s)"
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Hidden sections */}
      <div>
        <Label className="text-xs text-primary font-semibold">Hide sections / fields for this customer</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {HIDEABLE_FIELDS.map((f) => (
            <button
              key={f.key}
              onClick={() => toggleHidden(f.key)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                hidden.includes(f.key)
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {hidden.includes(f.key) ? `Hidden: ${f.label}` : f.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">Click to toggle. Hidden = removed from the UI for this customer.</p>
      </div>

      {/* Status options per team */}
      <div>
        <Label className="text-xs text-primary font-semibold">Status options per team</Label>
        <p className="text-[11px] text-muted-foreground mb-2">
          Control which statuses each team can pick in their dropdown — so Admin only sees intake
          statuses, Dispatch sees delivery ones, etc. Type them separated by commas.
          Leave a box empty to use the sensible default shown as the hint.
        </p>
        <div className="space-y-2">
          {STATUS_TABS.map((t) => (
            <div key={t.key} className="grid grid-cols-[1fr,2.2fr] items-start gap-2">
              <span className="text-xs text-muted-foreground pt-2">{t.label}</span>
              <div>
                <Input
                  value={statusByTab[t.key] ?? ""}
                  onChange={(e) => setStatusByTab((m) => ({ ...m, [t.key]: e.target.value }))}
                  placeholder="leave empty for default"
                  className="h-8 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">Default: {t.hint}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Animation — a personal, per-device choice, not a customer setting. */}
      <div>
        <Label className="text-xs text-primary font-semibold">Animation</Label>
        <label className="mt-2 flex w-fit items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border border-border cursor-pointer hover:bg-muted transition-colors">
          <Switch
            checked={motion}
            onCheckedChange={(v) => { setMotion(v); setMotionEnabled(v); }}
            aria-label="Interface animation"
          />
          Interface animation
        </label>
        <p className="text-[11px] text-muted-foreground mt-1">
          Applies to this device only. Turn off if you prefer a completely still screen during long data-entry sessions.
        </p>
      </div>

      {/* Rules */}
      <div>
        <Label className="text-xs text-primary font-semibold">Rules</Label>
        <label className="mt-2 flex w-fit items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border border-border cursor-pointer hover:bg-muted transition-colors">
          <Switch
            checked={requirePullout}
            onCheckedChange={setRequirePullout}
            aria-label="Require downpayment or EID before For Pullout"
          />
          Require downpayment or EID before &quot;For Pullout&quot;
        </label>
        <p className="text-[11px] text-muted-foreground mt-1">
          On = staff can&apos;t pick &quot;For Pullout&quot; until a downpayment or EID is on file. Off = always selectable.
        </p>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save app settings
        </Button>
      </div>
    </section>
  );
}
