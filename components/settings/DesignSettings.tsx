"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, X, Palette, Type, Image as ImageIcon, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { getBrandSettings, saveBrandSettings, saveBrandLogo } from "@/lib/api";
import { useBrand } from "@/components/BrandThemeLoader";
import ConnectionCheck from "@/components/settings/ConnectionCheck";
import PricingSettings from "@/components/settings/PricingSettings";
import TabSettings from "@/components/settings/TabSettings";
import BusinessTypeSettings from "@/components/settings/BusinessTypeSettings";
import TerminologySettings from "@/components/settings/TerminologySettings";
import PageLogosSettings from "@/components/settings/PageLogosSettings";
import MasterlistTemplateSettings from "@/components/settings/MasterlistTemplateSettings";
import AppConfigSettings from "@/components/settings/AppConfigSettings";
import OptionsSettings from "@/components/settings/OptionsSettings";
import CustomTogglesSettings from "@/components/settings/CustomTogglesSettings";
import ZohoSettings from "@/components/settings/ZohoSettings";
import {
  DEFAULT_BRAND_SETTINGS,
  FONT_PAIRS,
  applyBrandSettingsToDom,
  resizeImageToDataUrl,
  type BrandSettings,
} from "@/lib/brandSettings";

/**
 * Super-admin-only design settings panel. Everything saved here is stored
 * in the Google Sheet itself (Uploads tab marker rows), so it applies for
 * every user immediately -- not just your own browser.
 */
export default function DesignSettings() {
  const { refresh: refreshGlobalBrand } = useBrand();
  const [settings, setSettings] = useState<BrandSettings>(DEFAULT_BRAND_SETTINGS);
  const [headerLogoPreview, setHeaderLogoPreview] = useState<string | null>(null);
  const [invoiceLogoPreview, setInvoiceLogoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);
  const invoiceFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBrandSettings()
      .then((res) => {
        if (res.config) {
          try {
            setSettings({ ...DEFAULT_BRAND_SETTINGS, ...JSON.parse(res.config) });
          } catch {
            /* keep defaults */
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Live preview: apply to DOM as the admin edits, before saving
  useEffect(() => {
    if (!loading) applyBrandSettingsToDom(settings);
  }, [settings, loading]);

  const handleSaveText = async () => {
    setSaving(true);
    try {
      await saveBrandSettings({ config: JSON.stringify(settings) });
      toast.success("Design settings saved for everyone.");
      refreshGlobalBrand();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (kind: "header" | "invoice", file: File) => {
    try {
      const dataUrl = await resizeImageToDataUrl(file, kind === "header" ? 160 : 200);
      if (kind === "header") setHeaderLogoPreview(dataUrl);
      else setInvoiceLogoPreview(dataUrl);

      await saveBrandLogo({ kind, dataUrl });
      toast.success(`${kind === "header" ? "Header" : "Invoice"} logo updated for everyone.`);
      refreshGlobalBrand();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed -- try a smaller image");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading design settings…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-8">
      <div>
        <h1 className="font-cinzel text-xl text-primary flex items-center gap-2">
          <Palette className="h-5 w-5" /> Design Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Changes here apply for every user, immediately -- stored in your Google Sheet, not just this browser.
        </p>
      </div>

      {/* Text branding */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
          <Type className="h-4 w-4" /> Company Details
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Company Name</Label>
            <Input
              value={settings.companyName}
              onChange={(e) => setSettings((s) => ({ ...s, companyName: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Legal Suffix</Label>
            <Input
              value={settings.legalSuffix}
              onChange={(e) => setSettings((s) => ({ ...s, legalSuffix: e.target.value }))}
              placeholder="LLC, Inc, Ltd…"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tagline</Label>
            <Input
              value={settings.tagline}
              onChange={(e) => setSettings((s) => ({ ...s, tagline: e.target.value }))}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Location</Label>
            <Input
              value={settings.location}
              onChange={(e) => setSettings((s) => ({ ...s, location: e.target.value }))}
              placeholder="City, Country"
            />
          </div>
        </div>
      </section>

      {/* Theme */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
          <Palette className="h-4 w-4" /> Theme
        </h2>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Primary Color</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={settings.primaryColorHex}
              onChange={(e) => setSettings((s) => ({ ...s, primaryColorHex: e.target.value }))}
              className="h-10 w-16 rounded border border-input cursor-pointer bg-transparent"
            />
            <Input
              value={settings.primaryColorHex}
              onChange={(e) => setSettings((s) => ({ ...s, primaryColorHex: e.target.value }))}
              className="w-32 font-mono text-xs"
            />
            <span className="text-xs text-muted-foreground">A gradient is generated automatically from this color.</span>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Background</Label>
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setSettings((s) => ({ ...s, themeMode: mode }))}
                className={`px-4 py-2 rounded-md text-sm border capitalize transition-colors ${
                  settings.themeMode === mode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Font Pair</Label>
          <div className="grid grid-cols-1 gap-2">
            {FONT_PAIRS.map((pair) => (
              <button
                key={pair.id}
                onClick={() => setSettings((s) => ({ ...s, fontPairId: pair.id }))}
                className={`text-left px-3 py-2 rounded-md text-sm border transition-colors ${
                  settings.fontPairId === pair.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {pair.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Element colors (advanced) */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
          <Palette className="h-4 w-4" /> Colors
        </h2>
        <p className="text-xs text-muted-foreground">
          Fine-tune each surface. Leave a color unset to use the {settings.themeMode} theme default.
          Changes preview live. Tip: if text is hard to read, make Text and Background clearly different.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <ColorField label="Background" hex={settings.backgroundColorHex}
            onChange={(v) => setSettings((s) => ({ ...s, backgroundColorHex: v }))} />
          <ColorField label="Text" hex={settings.textColorHex}
            onChange={(v) => setSettings((s) => ({ ...s, textColorHex: v }))} />
          <ColorField label="Muted text (labels)" hex={settings.mutedTextColorHex}
            onChange={(v) => setSettings((s) => ({ ...s, mutedTextColorHex: v }))} />
          <ColorField label="Cards & menus" hex={settings.cardColorHex}
            onChange={(v) => setSettings((s) => ({ ...s, cardColorHex: v }))} />
          <ColorField label="Borders" hex={settings.borderColorHex}
            onChange={(v) => setSettings((s) => ({ ...s, borderColorHex: v }))} />
          <ColorField label="Accent (badges/hover)" hex={settings.accentColorHex}
            onChange={(v) => setSettings((s) => ({ ...s, accentColorHex: v }))} />
        </div>
      </section>

      {/* Logos */}
      <section className="space-y-4 rounded-lg border border-border bg-card p-4">
        <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
          <ImageIcon className="h-4 w-4" /> Logos
        </h2>
        <p className="text-xs text-muted-foreground">
          Images are automatically resized and compressed. Keep it simple -- a plain logo mark works better than a detailed photo at this size.
        </p>

        <LogoUploadRow
          label="Header / Login Logo"
          preview={headerLogoPreview}
          inputRef={headerFileRef}
          onFile={(f) => handleLogoUpload("header", f)}
        />
        <LogoUploadRow
          label="Invoice Logo"
          preview={invoiceLogoPreview}
          inputRef={invoiceFileRef}
          onFile={(f) => handleLogoUpload("invoice", f)}
        />
      </section>

      {/* Per-page brand logos */}
      <PageLogosSettings />

      {/* Masterlist template (the blank form handed out) */}
      <MasterlistTemplateSettings />
      {/* Note: masterlist IMPORT column setup now lives in God Mode (auto-detect
          from a sample file), so it's not duplicated here. */}

      {/* Every dropdown list, editable */}
      <OptionsSettings />

      {/* Developer-defined on/off switches */}
      <CustomTogglesSettings />

      {/* Per-customer app behavior: column mapping, hidden sections, statuses */}
      <AppConfigSettings />

      {/* Business type */}
      <BusinessTypeSettings />

      {/* Terminology */}
      <TerminologySettings />

      {/* Tabs */}
      <TabSettings />

      {/* Pricing */}
      <PricingSettings />

      {/* Zoho Invoice connection */}
      <ZohoSettings />

      {/* Diagnostics */}
      <ConnectionCheck />

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={handleSaveText} disabled={saving} className="font-cinzel uppercase tracking-widest">
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Company Details &amp; Theme
        </Button>
      </div>
    </div>
  );
}

function ColorField({
  label,
  hex,
  onChange,
}: {
  label: string;
  hex?: string;
  onChange: (value: string) => void;
}) {
  const isSet = !!hex && /^#[0-9a-fA-F]{6}$/.test(hex);
  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isSet ? hex : "#888888"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border border-input cursor-pointer bg-transparent shrink-0"
          title={isSet ? hex : "Not set (using theme default)"}
        />
        <Input
          value={hex ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="theme default"
          className="w-28 font-mono text-xs"
        />
        {isSet && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

function LogoUploadRow({
  label,
  preview,
  inputRef,
  onFile,
}: {
  label: string;
  preview: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onFile: (file: File) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div
        className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer overflow-hidden bg-muted/40 shrink-0"
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img src={preview} alt={label} className="w-full h-full object-contain" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm">{label}</p>
        <div className="flex items-center gap-2 mt-1">
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            Choose Image
          </Button>
          {preview && (
            <button onClick={() => inputRef.current && (inputRef.current.value = "")}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
