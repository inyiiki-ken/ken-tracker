"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, ToggleLeft, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getCustomToggles, saveCustomToggles } from "@/lib/api";
import {
  applyCustomToggles,
  getCustomToggles as getLocalToggles,
  setCustomToggles,
  serializeCustomToggles,
  newCustomToggle,
  TOGGLE_FIELD_CHOICES,
  TOGGLE_COLORS,
  toggleColorClass,
  type CustomToggle,
} from "@/lib/customToggles";

/** Developer panel: define your own on/off switches for the item card. */
export default function CustomTogglesSettings() {
  const [toggles, setToggles] = useState<CustomToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCustomToggles({})
      .then((res) => { if (res.config) applyCustomToggles(res.config); })
      .catch(() => { /* none */ })
      .finally(() => { setToggles([...getLocalToggles()]); setLoading(false); });
  }, []);

  const update = (id: string, patch: Partial<CustomToggle>) =>
    setToggles((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const save = async () => {
    const bad = toggles.find((t) => !t.label.trim());
    if (bad) { toast.error("Give every toggle a name."); return; }
    setSaving(true);
    try {
      setCustomToggles(toggles);
      await saveCustomToggles({ config: serializeCustomToggles() });
      toast.success("Toggles saved. Reloading…");
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading toggles…
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <ToggleLeft className="h-4 w-4" /> Custom Toggles (this customer)
      </h2>
      <p className="text-xs text-muted-foreground">
        Add your own on/off switches to the item card — e.g. “EID Provided”, “Gift Wrap”,
        “Fragile”. Each one saves a value into the column you choose, so it shows in your
        Google Sheet too. (The built-in Free SF / Promo SF / Add Charge / Discount stay as they are.)
      </p>

      <div className="space-y-3">
        {toggles.map((t) => (
          <div key={t.id} className="rounded-md border border-border/60 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={t.label}
                onChange={(e) => update(t.id, { label: e.target.value })}
                placeholder="Toggle name (e.g. EID Provided)"
                className="h-8 text-sm flex-1"
              />
              <button
                onClick={() => setToggles((l) => l.filter((x) => x.id !== t.id))}
                className="text-muted-foreground hover:text-destructive shrink-0"
                title="Delete toggle"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Saves to column</Label>
                <Select value={t.field} onValueChange={(v) => update(t.id, { field: v })}>
                  <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {TOGGLE_FIELD_CHOICES.map((f) => (
                      <SelectItem key={f.value} value={f.value} className="text-xs text-foreground">{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Value when ON</Label>
                <Input value={t.onValue} onChange={(e) => update(t.id, { onValue: e.target.value })} className="h-8 text-xs mt-0.5" placeholder="TRUE" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Value when OFF</Label>
                <Input value={t.offValue} onChange={(e) => update(t.id, { offValue: e.target.value })} className="h-8 text-xs mt-0.5" placeholder="(empty)" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Colour</Label>
                <Select value={t.color} onValueChange={(v) => update(t.id, { color: v as CustomToggle["color"] })}>
                  <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {TOGGLE_COLORS.map((c) => (
                      <SelectItem key={c} value={c} className={`text-xs capitalize ${toggleColorClass(c)}`}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
        {toggles.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No custom toggles yet.</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={() => setToggles((l) => [...l, newCustomToggle()])}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add toggle
        </Button>
        <Button size="sm" onClick={save} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save toggles
        </Button>
      </div>
    </section>
  );
}
