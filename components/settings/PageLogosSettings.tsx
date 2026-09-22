"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, X, Image as ImageIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { getPageLogos, savePageLogo, deletePageLogo } from "@/lib/api";
import { useBrand } from "@/components/BrandThemeLoader";
import { resizeImageToDataUrl } from "@/lib/brandSettings";

/**
 * Upload a distinct logo per page/brand (e.g. "Empire Gold", "Aliyah's"). On a
 * printed invoice, items from that page use its logo instead of the default
 * invoice logo. Stored per-tenant.
 */
export default function PageLogosSettings() {
  const { refresh: refreshBrand } = useBrand();
  const [logos, setLogos] = useState<{ page: string; dataUrl: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPage, setNewPage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    getPageLogos({})
      .then((res) => setLogos(res))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const upload = async (page: string, file: File) => {
    if (!page.trim()) { toast.error("Enter a page/brand name first."); return; }
    setBusy(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 200);
      await savePageLogo({ page: page.trim(), dataUrl });
      toast.success(`Logo saved for "${page.trim()}".`);
      setNewPage("");
      load();
      refreshBrand();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed — try a smaller image");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (page: string) => {
    try {
      await deletePageLogo({ page });
      toast.success(`Removed logo for "${page}".`);
      load();
      refreshBrand();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Remove failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading page logos…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <ImageIcon className="h-4 w-4" /> Page / Brand Logos
      </h2>
      <p className="text-xs text-muted-foreground">
        A separate logo per page/brand. On printed invoices, items from that page
        use its logo. The page name must match the “Page” value on the records.
      </p>

      {logos.map((l) => (
        <div key={l.page} className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg border border-border overflow-hidden bg-muted/40 shrink-0 flex items-center justify-center">
            <img src={l.dataUrl} alt={l.page} className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{l.page}</p>
          </div>
          <button onClick={() => remove(l.page)} className="text-muted-foreground hover:text-destructive" title="Remove">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {logos.length === 0 && <p className="text-xs text-muted-foreground">No page logos yet.</p>}

      {/* Add new */}
      <div className="flex items-end gap-2 border-t border-border pt-3">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground">New page / brand name</Label>
          <Input value={newPage} onChange={(e) => setNewPage(e.target.value)} placeholder="e.g. Empire Gold" className="h-8 text-sm" />
        </div>
        <Button size="sm" variant="outline" disabled={busy || !newPage.trim()} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Upload className="h-3.5 w-3.5 mr-1" /> Logo</>}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(newPage, f); e.target.value = ""; }}
        />
      </div>
    </section>
  );
}
