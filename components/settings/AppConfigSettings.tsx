"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Sliders, X, Plus, Trash2 } from "lucide-react";
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
  DEFAULT_SALE_STATUSES,
  DEFAULT_PULLOUT_STATUSES,
  type StatusDeadline,
} from "@/lib/appConfig";
import { getAllKnownOptions } from "@/lib/optionsConfig";
import { useSectionSaver } from "@/lib/settingsSave";
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
  const [saleStatuses, setSaleStatuses] = useState<string[]>([]);
  const [pulloutStatuses, setPulloutStatuses] = useState<string[]>([]);
  const [deadlines, setDeadlines] = useState<{ status: string; days: string }[]>([]);
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
        setSaleStatuses(c.saleStatuses.length ? c.saleStatuses : DEFAULT_SALE_STATUSES);
        setPulloutStatuses(c.pulloutStatuses.length ? c.pulloutStatuses : DEFAULT_PULLOUT_STATUSES);
        setDeadlines(c.statusDeadlines.map((d) => ({ status: d.status, days: String(d.days) })));
        setLoading(false);
      });
  }, []);

  const setAlias = (key: string, value: string) =>
    setAliases((a) => ({ ...a, [key]: value.split(",").map((s) => s.trim()).filter(Boolean) }));

  const toggleHidden = (key: string) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const snapshot = () => JSON.stringify({ aliases, hidden, statuses, statusByTab, requirePullout, saleStatuses, pulloutStatuses, deadlines });
  const [savedSnap, setSavedSnap] = useState("");
  useEffect(() => { if (!loading && !savedSnap) setSavedSnap(snapshot()); }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async () => {
    const statusOptionsByTab: Record<string, string[]> = {};
    for (const t of STATUS_TABS) {
      const list = (statusByTab[t.key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length) statusOptionsByTab[t.key] = list;
    }
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    const statusDeadlines: StatusDeadline[] = deadlines
      .map((d) => ({ status: d.status.trim(), days: parseInt(d.days, 10) || 0 }))
      .filter((d) => d.status && d.days > 0);
    setAppConfig({
      columnAliases: aliases,
      hiddenFields: hidden,
      statusOptions: statuses,
      statusOptionsByTab,
      requirePaymentForPullout: requirePullout,
      // Store only when changed from the default, so defaults can still evolve.
      saleStatuses: same(saleStatuses, DEFAULT_SALE_STATUSES) ? [] : saleStatuses,
      pulloutStatuses: same(pulloutStatuses, DEFAULT_PULLOUT_STATUSES) ? [] : pulloutStatuses,
      statusDeadlines,
      // First time deadlines are switched on = the start of counting.
      deadlinesStartedAt: statusDeadlines.length
        ? (getLocalAppConfig().deadlinesStartedAt || new Date().toISOString())
        : "",
    });
    await saveAppConfig({ config: serializeAppConfig() });
    setSavedSnap(snapshot());
  };
  useSectionSaver("appconfig", { label: "App Settings", isDirty: () => !loading && !!savedSnap && snapshot() !== savedSnap, save: persist, reloads: true });

  const save = async () => {
    setSaving(true);
    try {
      await persist();
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

      {/* Status dropdowns moved */}
      <div>
        <Label className="text-xs text-primary font-semibold">Status dropdowns per tab</Label>
        <p className="text-[11px] text-muted-foreground">
          Now edited in <b>Dropdown Options</b> above (Status — Admin / Dispatch / Accounts tab): add, remove and reorder.
        </p>
      </div>

      {/* Liver sales */}
      <div>
        <Label className="text-xs text-primary font-semibold">Extra statuses that count as a sale (My Sales and Bossing)</Label>
        <p className="text-[11px] text-muted-foreground mb-2">
          Shipped and delivered items (Dispatched, Shipped, In Transit, Delivered, Picked Up…) always count as sold. Add any other status here that should also count as a sale.
        </p>
        <ChipList id="sale" values={saleStatuses} onChange={setSaleStatuses} />
      </div>

      {/* Deadlines */}
      <div>
        <Label className="text-xs text-primary font-semibold">Status deadlines (reminders)</Label>
        <p className="text-[11px] text-muted-foreground mb-2">
          If an item stays in a status longer than this, it shows in Reminders (Dispatch tab and the liver&apos;s own My Sales tab)
          and in the Pullout Report under &quot;Needs to be cancelled&quot;. Counted from the day the status was set.
          Leave empty to keep the built-in reminders (For Pullout after 1 day, Dispatched after 2 days).
        </p>
        <datalist id="dl-deadline-status">
          {getAllKnownOptions("statusDispatch").map((o) => <option key={o} value={o} />)}
        </datalist>
        <div className="space-y-2">
          {deadlines.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input list="dl-deadline-status" value={d.status} onChange={(e) => setDeadlines((ds) => ds.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))} placeholder="Status, e.g. For COD" className="h-8 text-sm flex-1" />
              <Input type="number" min={1} value={d.days} onChange={(e) => setDeadlines((ds) => ds.map((x, j) => (j === i ? { ...x, days: e.target.value } : x)))} className="h-8 text-sm w-20 text-right" />
              <span className="text-xs text-muted-foreground w-8">days</span>
              <button onClick={() => setDeadlines((ds) => ds.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive" title="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-8" onClick={() => setDeadlines((ds) => [...ds, { status: "", days: "3" }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add deadline
          </Button>
        </div>
      </div>

      {/* Pullout report */}
      <div>
        <Label className="text-xs text-primary font-semibold">Pullout Report includes</Label>
        <p className="text-[11px] text-muted-foreground mb-2">Statuses listed as ready for pullout in the Dispatch report.</p>
        <ChipList id="pullout" values={pulloutStatuses} onChange={setPulloutStatuses} />
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

/** Small add/remove chip editor with suggestions from every known status. */
function ChipList({ id, values, onChange }: { id: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v) => (
          <span key={v} className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground flex items-center gap-1">
            {v}
            <button onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {values.length === 0 && <span className="text-[11px] text-muted-foreground">None.</span>}
      </div>
      <datalist id={`dl-${id}`}>
        {getAllKnownOptions("statusDispatch").filter((o) => !values.includes(o)).map((o) => <option key={o} value={o} />)}
      </datalist>
      <div className="flex items-center gap-2">
        <Input list={`dl-${id}`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Add status…" className="h-8 text-sm w-56" />
        <Button size="sm" variant="outline" className="h-8" onClick={add}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
      </div>
    </div>
  );
}
