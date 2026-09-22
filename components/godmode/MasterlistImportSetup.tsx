"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, Check, TableProperties, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { saveMasterlistMapping } from "@/lib/api";
import {
  detectMapping,
  setMasterlistMapping,
  MASTERLIST_FIELD_LABELS,
  type DetectResult,
} from "@/lib/masterlistMapping";

/**
 * Developer tool (God Mode): set how the ACTIVE customer's masterlist is read,
 * by simply uploading a sample of their real Excel/CSV. The app auto-detects
 * which column each field is in from the header row — no manual mapping.
 */
export default function MasterlistImportSetup({ activeName }: { activeName?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    setResult(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", raw: false });
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
      setResult(det);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read file");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      setMasterlistMapping(result.mapping);
      await saveMasterlistMapping({ config: JSON.stringify(result.mapping) });
      toast.success(`Import setup saved${activeName ? ` for ${activeName}` : ""}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <TableProperties className="h-4 w-4" /> Masterlist Import Setup
      </h2>
      <p className="text-xs text-muted-foreground">
        Upload this customer&apos;s real masterlist (Excel or CSV) once. The app
        reads the header row and figures out which column is which automatically —
        so their own layout imports correctly. Applies to{" "}
        <span className="text-primary font-medium">{activeName || "the active customer"}</span>.
      </p>

      <div
        className="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        {busy ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading {fileName}…
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            <Upload className="h-6 w-6 mx-auto mb-1.5" />
            {fileName ? `Selected: ${fileName} — tap to choose another` : "Tap to upload their Excel / CSV masterlist"}
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      {result && (
        <div className="space-y-3">
          <div className="rounded-md border border-success/40 bg-success/5 p-2 text-xs text-success flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5" /> Detected the header on row {result.headerRowIndex + 1}. Data reads from row {result.mapping.dataStartRow}.
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr><th className="text-left px-2 py-1.5">Field</th><th className="text-left px-2 py-1.5">Column</th><th className="text-left px-2 py-1.5">Header found</th></tr>
              </thead>
              <tbody>
                {MASTERLIST_FIELD_LABELS.map(({ key, label }) => {
                  const col = result.mapping.columns[key];
                  const idx = col ? col.split("").reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1 : -1;
                  return (
                    <tr key={key} className="border-t border-border/50">
                      <td className="px-2 py-1.5">{label}</td>
                      <td className="px-2 py-1.5 font-mono">{col || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[160px]">{idx >= 0 ? (result.headerRow[idx] || "") : <span className="italic">not found</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Looks right? Save it. Any field showing “—” just isn&apos;t in their file (that&apos;s fine).
          </p>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
            Save import setup
          </Button>
        </div>
      )}
    </div>
  );
}
