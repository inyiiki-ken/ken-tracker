"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, FileSpreadsheet, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getMasterlistTemplate, saveMasterlistTemplate, clearMasterlistTemplate } from "@/lib/api";
import { fileToBase64 } from "@/lib/fileBase64";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Per-customer masterlist template. Upload this workspace's own styled .xlsx;
 * the Admin tab's "Export Masterlist" then hands out THIS file. If none is set,
 * the app falls back to the bundled default template.
 */
export default function MasterlistTemplateSettings() {
  const [hasCustom, setHasCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    getMasterlistTemplate({})
      .then((res) => setHasCustom(!!res.dataUrl))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const upload = async (file: File) => {
    if (!/\.(xlsx|xls)$/i.test(file.name)) { toast.error("Please choose an .xlsx file."); return; }
    setBusy(true);
    try {
      const b64 = await fileToBase64(file);
      await saveMasterlistTemplate({ dataUrl: b64 });
      toast.success("Template saved. Admin → Export Masterlist now uses it.");
      setHasCustom(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await clearMasterlistTemplate({});
      toast.success("Reverted to the default template.");
      setHasCustom(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading template…
      </div>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4" /> Masterlist Template
      </h2>
      <p className="text-xs text-muted-foreground">
        Upload this customer&apos;s own styled masterlist (.xlsx). The Admin tab&apos;s
        “Export Masterlist” button will hand out this exact file. Leave empty to use
        the built-in default.
      </p>

      <div className="flex items-center gap-2">
        {hasCustom ? (
          <span className="text-xs text-success flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Custom template set
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Using default template</span>
        )}
        <div className="flex-1" />
        {hasCustom && (
          <Button size="sm" variant="ghost" className="text-xs text-destructive" onClick={remove} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Revert to default
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Upload className="h-3.5 w-3.5 mr-1" /> Upload .xlsx</>}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }}
        />
      </div>
    </section>
  );
}

export { XLSX_MIME };
