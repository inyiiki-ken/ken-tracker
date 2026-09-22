"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, Check, TableProperties, Save, RotateCcw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { saveMasterlistMapping } from "@/lib/api";
import {
  detectMapping,
  getMasterlistMapping,
  setMasterlistMapping,
  MASTERLIST_FIELD_LABELS,
  DEFAULT_MASTERLIST_MAPPING,
  colToIndex,
  suggestMcCategories,
  type MasterlistMapping,
  type MasterlistFieldKey,
} from "@/lib/masterlistMapping";
import { parseMasterlistFile, type ParsedMasterlistRow } from "@/lib/masterlistImport";
import { getPricing } from "@/lib/pricingConfig";

/** Round half-up to a whole number: .0–.4 stays, .5–.9 goes up. */
const round0 = (v: number) => Math.round(v);

/**
 * Developer tool (God Mode): teach the app the ACTIVE customer's own masterlist
 * layout. Upload a sample of their real Excel/CSV → the app detects the header
 * row, every column, the date / page / rate cells and whether price is
 * "Rate" or "Rate + MC" → you can correct anything → a live preview shows the
 * exact rows that will be imported → Save. From then on "Upload Masterlist" for
 * this customer reads THEIR format. Saved only for this customer.
 */
export default function MasterlistImportSetup({ activeName }: { activeName?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mapping, setMapping] = useState<MasterlistMapping | null>(null);
  const [headerRow, setHeaderRow] = useState<string[]>([]);
  const [headerRowIndex, setHeaderRowIndex] = useState(-1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: ParsedMasterlistRow[]; page: string; date: string; rate: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saved = getMasterlistMapping();
  const usingCustom = JSON.stringify(saved) !== JSON.stringify(DEFAULT_MASTERLIST_MAPPING);

  const runPreview = async (f: File, m: MasterlistMapping) => {
    setPreviewing(true);
    try {
      const res = await parseMasterlistFile(f, m);
      setPreview({ rows: res.rows, page: res.pageName, date: res.liveDate, rate: res.globalRate });
    } catch (e) {
      setPreview(null);
      toast.error(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const onFile = async (f: File) => {
    setBusy(true);
    setMapping(null);
    setPreview(null);
    setFile(f);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", raw: false });
      let grid: unknown[][] | null = null;
      for (const name of wb.SheetNames) {
        if (/data'?s?/i.test(name.trim())) continue; // skip the dropdown-source tab
        const g = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" }) as unknown[][];
        if (g.length >= 2) { grid = g; break; }
      }
      if (!grid) { toast.error("Couldn't read any rows from that file."); return; }
      const det = detectMapping(grid);
      if (!det) {
        toast.error("Couldn't find a header row. The file needs a row of column titles (Code, Name, Description, Rate…).");
        return;
      }
      let m = det.mapping;
      // No Category column but an MC column (e.g. Crown): suggest MC -> category
      // tiers from the MC values in the file. Editable below before saving.
      if (m.columns.mc && !m.columns.category) {
        const first = await parseMasterlistFile(f, m);
        m = { ...m, mcCategories: suggestMcCategories(first.rows.map((r) => parseFloat(r.mc) || 0)) };
      }
      setMapping(m);
      setHeaderRow(det.headerRow);
      setHeaderRowIndex(det.headerRowIndex);
      await runPreview(f, m);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read file");
    } finally {
      setBusy(false);
    }
  };

  const update = (patch: Partial<MasterlistMapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const setCol = (key: MasterlistFieldKey, letter: string) =>
    setMapping((m) => (m ? { ...m, columns: { ...m.columns, [key]: letter.toUpperCase().replace(/[^A-Z]/g, "") } } : m));

  const save = async (m: MasterlistMapping, label: string) => {
    setSaving(true);
    try {
      setMasterlistMapping(m);
      await saveMasterlistMapping({ config: JSON.stringify(getMasterlistMapping()) });
      toast.success(label);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const who = activeName || "the active customer";
  const amountOf = (r: ParsedMasterlistRow) => round0((parseFloat(r.grams) || 0) * (parseFloat(r.clientRate) || 0));
  const total = preview?.rows.reduce((s, r) => s + amountOf(r), 0) ?? 0;
  const categoryChoices = Object.keys(getPricing().makingCharges);
  const mcEntries = mapping ? Object.entries(mapping.mcCategories || {}) : [];
  const setMcEntry = (oldMc: string, mc: string, cat: string) =>
    setMapping((m) => {
      if (!m) return m;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m.mcCategories || {})) if (k !== oldMc) next[k] = v;
      if (mc.trim() !== "" || cat.trim() !== "") next[mc.trim()] = cat;
      return { ...m, mcCategories: next };
    });

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <TableProperties className="h-4 w-4" /> Masterlist Import Setup
      </h2>
      <p className="text-xs text-muted-foreground">
        Upload <span className="text-primary font-medium">{who}</span>&apos;s own masterlist once. The app learns
        their layout (columns, date, page, rate, and whether price is <em>Rate</em> or <em>Rate + MC</em>), shows
        you exactly what it will import, and after you save, <strong>Upload Masterlist</strong> reads their format
        automatically. Only affects {who}.
      </p>
      <div className="flex items-center gap-2 text-[11px]">
        <span className={usingCustom ? "text-success" : "text-muted-foreground"}>
          {usingCustom ? "✓ Using a custom layout for this customer" : "Using the standard Ken Tracker masterlist layout"}
        </span>
        {usingCustom && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[11px]"
            disabled={saving}
            onClick={() => save({ ...DEFAULT_MASTERLIST_MAPPING }, `Reset ${who} to the standard layout.`)}
          >
            <RotateCcw className="h-3 w-3 mr-1" /> Reset to standard
          </Button>
        )}
      </div>

      <div
        className="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        {busy ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading {file?.name}…
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            <Upload className="h-6 w-6 mx-auto mb-1.5" />
            {file ? `Selected: ${file.name} — tap to choose another` : "Tap to upload their Excel / CSV masterlist"}
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
      />

      {mapping && (
        <div className="space-y-3">
          <div className="rounded-md border border-success/40 bg-success/5 p-2 text-xs text-success flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" /> Found the header on row {headerRowIndex + 1}. Check below, fix anything, then save.
          </div>

          {/* Where things are */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
            <Meta label="Items start on row">
              <Input type="number" value={mapping.dataStartRow} onChange={(e) => update({ dataStartRow: parseInt(e.target.value, 10) || 1 })} className="h-7 text-xs" />
            </Meta>
            <Meta label="Live date cell">
              <Input value={mapping.liveDateCell} onChange={(e) => update({ liveDateCell: e.target.value.toUpperCase() })} className="h-7 text-xs font-mono" placeholder="e.g. A5" />
            </Meta>
            <Meta label="Page / title cell">
              <Input value={mapping.pageCell} onChange={(e) => update({ pageCell: e.target.value.toUpperCase() })} className="h-7 text-xs font-mono" placeholder="e.g. A1" />
            </Meta>
            <Meta label="Sheet rate cell">
              <Input value={mapping.rateCell} onChange={(e) => update({ rateCell: e.target.value.toUpperCase() })} className="h-7 text-xs font-mono" placeholder="(none)" />
            </Meta>
            <Meta label="Selling price per gram">
              <select
                value={mapping.priceMode}
                onChange={(e) => update({ priceMode: e.target.value === "rate_plus_mc" ? "rate_plus_mc" : "rate" })}
                className="h-7 w-full text-xs rounded-md border border-border bg-background px-2"
              >
                <option value="rate">Rate column</option>
                <option value="rate_plus_mc">Rate + MC</option>
              </select>
            </Meta>
            <Meta label="Category if file has none">
              <Input value={mapping.defaultCategory} onChange={(e) => update({ defaultCategory: e.target.value })} className="h-7 text-xs" placeholder="e.g. Gold Normal" />
            </Meta>
          </div>

          {/* MC -> Category (only when their file has no Category column) */}
          {mapping.columns.mc && !mapping.columns.category && (
            <div className="rounded-lg border border-border p-2.5 space-y-1.5">
              <p className="text-[11px] text-muted-foreground">
                Their file has no Category column — category is picked from the <strong>MC</strong>:
              </p>
              {mcEntries.map(([mc, cat], i) => (
                <div key={i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground w-8">MC</span>
                  <Input value={mc} onChange={(e) => setMcEntry(mc, e.target.value, cat)} className="h-6 w-16 text-[11px] px-1.5" />
                  <span className="text-muted-foreground">→</span>
                  <Input value={cat} list="mc-cat-choices" onChange={(e) => setMcEntry(mc, mc, e.target.value)} className="h-6 flex-1 text-[11px] px-1.5" />
                  <button type="button" className="text-muted-foreground hover:text-destructive px-1" onClick={() => setMcEntry(mc, "", "")}>✕</button>
                </div>
              ))}
              <datalist id="mc-cat-choices">{categoryChoices.map((c) => <option key={c} value={c} />)}</datalist>
              <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setMcEntry("__new", "", "Gold Normal")}>+ Add MC</Button>
              <p className="text-[10px] text-muted-foreground">Any other MC uses “Category if file has none”.</p>
            </div>
          )}

          {/* Columns */}
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr><th className="text-left px-2 py-1.5">Field</th><th className="text-left px-2 py-1.5 w-20">Column</th><th className="text-left px-2 py-1.5">Their header</th></tr>
              </thead>
              <tbody>
                {MASTERLIST_FIELD_LABELS.map(({ key, label }) => {
                  const col = mapping.columns[key];
                  const idx = colToIndex(col);
                  return (
                    <tr key={key} className="border-t border-border/50">
                      <td className="px-2 py-1">{label}</td>
                      <td className="px-2 py-1">
                        <Input value={col} onChange={(e) => setCol(key, e.target.value)} className="h-6 w-14 text-[11px] font-mono px-1.5" placeholder="—" />
                      </td>
                      <td className="px-2 py-1 text-muted-foreground truncate max-w-[160px]">
                        {idx >= 0 ? (headerRow[idx] || "") : <span className="italic">not in their file</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => file && runPreview(file, mapping)} disabled={previewing || !file}>
              {previewing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
              Refresh preview
            </Button>
            <Button size="sm" onClick={() => save(mapping, `Saved. Upload Masterlist now reads ${who}'s format.`)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save for {who}
            </Button>
          </div>

          {/* Preview of what will be imported */}
          {preview && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">
                Preview — <strong className="text-foreground">{preview.rows.length}</strong> items
                {preview.page && <> · page <strong className="text-foreground">{preview.page}</strong></>}
                {preview.date && <> · date <strong className="text-foreground">{preview.date}</strong></>}
                {preview.rate > 0 && <> · rate <strong className="text-foreground">{preview.rate}</strong></>}
                {" "}· total <strong className="text-foreground">{total.toLocaleString()}</strong> (rounded)
              </p>
              {preview.rows.length === 0 ? (
                <p className="text-[11px] text-warning">No items found — check “Items start on row” and the Code / Client name / Description columns.</p>
              ) : (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-[11px] whitespace-nowrap">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        {["Code", "Client", "Item", "Grams", "Gold rate", "MC", "Rate/g", "Amount", "Category"].map((h) => (
                          <th key={h} className="text-left px-2 py-1.5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 8).map((r, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="px-2 py-1">{r.orderId}</td>
                          <td className="px-2 py-1">{r.minerName}</td>
                          <td className="px-2 py-1">{r.itemDescription}</td>
                          <td className="px-2 py-1">{r.grams}</td>
                          <td className="px-2 py-1">{r.goldRate !== "0" ? r.goldRate : "—"}</td>
                          <td className="px-2 py-1">{r.mc || "—"}</td>
                          <td className="px-2 py-1">{r.clientRate}</td>
                          <td className="px-2 py-1">{amountOf(r).toLocaleString()}</td>
                          <td className="px-2 py-1">{r.category || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">Changed a cell or column above? Tap “Refresh preview” to re-check before saving.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
