"use client";

/**
 * Runtime-editable branding, stored in the Google Sheet itself (Uploads tab,
 * marker row "__BRAND_SETTINGS__" -- same pattern as rates config and
 * reward inventory). This is what actually changes when a super_admin uses
 * the Design Settings panel; config/brand.ts is now just the fallback used
 * before these settings load for the first time.
 */

export interface BrandSettings {
  companyName: string;
  tagline: string;
  legalSuffix: string;
  location: string;
  primaryColorHex: string; // single color -- gradient stops are derived from this
  themeMode: "dark" | "light";
  fontPairId: string;
  /**
   * Optional per-surface color overrides. Empty string = use the theme default.
   * These win over the dark/light preset, so you can dial in exact contrast
   * without touching code.
   */
  backgroundColorHex?: string; // page background
  textColorHex?: string;       // main text (headings/body) + menu/card text
  mutedTextColorHex?: string;  // secondary labels, placeholders
  cardColorHex?: string;       // panels, cards, dropdown menus
  borderColorHex?: string;     // borders + input outlines
  accentColorHex?: string;     // secondary accent (badges, hovers)
  /** Printed under the company name on invoices (defaults to Location). */
  invoiceAddress?: string;
  /** WhatsApp / contact number printed on invoices. Empty = line hidden. */
  invoiceContact?: string;
  /** Overall look: "modern" (clean, Apple-style) or "classic" (original). */
  uiStyle?: "modern" | "classic";
}

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  companyName: "Your Business Name",
  tagline: "Jewellery Tracker",
  legalSuffix: "LLC",
  location: "Dubai, UAE",
  primaryColorHex: "#FFD700",
  themeMode: "dark",
  fontPairId: "classic-luxury",
  backgroundColorHex: "",
  textColorHex: "",
  mutedTextColorHex: "",
  cardColorHex: "",
  borderColorHex: "",
  accentColorHex: "",
};

export const FONT_PAIRS: { id: string; label: string; heading: string; body: string }[] = [
  { id: "classic-luxury", label: "Classic Luxury (Cinzel + Lato)", heading: "Cinzel:wght@600;700;800;900", body: "Lato:wght@300;400;700;900" },
  { id: "modern-clean", label: "Modern Clean (Poppins + Inter)", heading: "Poppins:wght@600;700;800", body: "Inter:wght@300;400;600" },
  { id: "elegant-serif", label: "Elegant Serif (Playfair Display + Source Sans 3)", heading: "Playfair+Display:wght@600;700;800", body: "Source+Sans+3:wght@300;400;600" },
  { id: "corporate", label: "Corporate (Montserrat + Open Sans)", heading: "Montserrat:wght@600;700;800", body: "Open+Sans:wght@300;400;600" },
  { id: "minimal", label: "Minimal (Space Grotesk + Inter)", heading: "Space+Grotesk:wght@600;700", body: "Inter:wght@300;400;600" },
];

function fontFamilyName(googleFontsSpec: string): string {
  // "Cinzel:wght@600;700" -> "Cinzel"; "Playfair+Display:wght@..." -> "Playfair Display"
  return googleFontsSpec.split(":")[0].replace(/\+/g, " ");
}

/** hex -> {h, s, l} */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

/** "#rrggbb" -> "h s% l%" string for a CSS HSL variable (or null if not a valid hex). */
function hexToHslString(hex: string): string | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return null;
  const [h, s, l] = hexToHsl(hex.trim());
  return `${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%`;
}

/** Derives a 4-stop gradient (matching the existing --gold-1..4 slots) from one chosen color. */
function deriveGradientStops(hex: string): [string, string, string, string] {
  const [h, s, l] = hexToHsl(hex);
  const clamp = (n: number) => Math.max(8, Math.min(92, n));
  return [
    `${h.toFixed(0)} ${s.toFixed(0)}% ${clamp(l - 15).toFixed(0)}%`,
    `${h.toFixed(0)} ${s.toFixed(0)}% ${clamp(l + 5).toFixed(0)}%`,
    `${h.toFixed(0)} ${Math.max(20, s - 25).toFixed(0)}% ${clamp(l + 15).toFixed(0)}%`,
    `${h.toFixed(0)} ${s.toFixed(0)}% ${clamp(l - 30).toFixed(0)}%`,
  ];
}

const THEME_PRESETS = {
  dark: {
    background: "30 5% 8%",
    foreground: "0 0% 98%",
    card: "36 10% 10%",
    border: "217 20% 18%",
    input: "217 20% 18%",
    muted: "36 8% 14%",
    mutedForeground: "51 30% 55%",
    // Semantic meaning colours: bright shades read well on the dark surface.
    success: "142 69% 58%",
    warning: "27 96% 61%",
    info: "187 86% 53%",
    attention: "48 96% 53%",
    hold: "255 92% 76%",
  },
  light: {
    background: "0 0% 100%",
    foreground: "222 20% 12%",
    card: "0 0% 100%",
    border: "220 15% 88%",
    input: "220 15% 90%",
    muted: "220 20% 96%",
    mutedForeground: "220 9% 40%",
    // Darker equivalents — the bright shades above are unreadable on white.
    // Same hue so "green = paid" still holds; only the lightness changes.
    success: "142 72% 29%",
    warning: "21 90% 38%",
    info: "199 89% 33%",
    attention: "38 92% 33%",
    hold: "262 60% 45%",
  },
};

let injectedFontLinkId = "brand-dynamic-font";

/** Applies settings to the live DOM: CSS variables + a dynamically loaded Google Fonts link. */
export function applyBrandSettingsToDom(settings: BrandSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;

  const [g1, g2, g3, g4] = deriveGradientStops(settings.primaryColorHex);
  root.setProperty("--gold-1", g1);
  root.setProperty("--gold-2", g2);
  root.setProperty("--gold-3", g3);
  root.setProperty("--gold-4", g4);
  root.setProperty("--primary", g2);
  root.setProperty("--ring", g2);
  root.setProperty("--accent", g3);

  const preset = THEME_PRESETS[settings.themeMode];
  root.setProperty("--background", preset.background);
  root.setProperty("--foreground", preset.foreground);
  root.setProperty("--card", preset.card);
  root.setProperty("--card-foreground", preset.foreground);
  root.setProperty("--popover", preset.card);
  // CRITICAL: popover/card foreground must follow the theme too, or dropdown
  // menus (which use --popover-foreground) render near-white text on a white
  // popover in light mode — the "can't see the options" bug.
  root.setProperty("--popover-foreground", preset.foreground);
  root.setProperty("--secondary-foreground", preset.foreground);
  root.setProperty("--muted-foreground", preset.mutedForeground);
  root.setProperty("--border", preset.border);
  root.setProperty("--input", preset.input);
  root.setProperty("--muted", preset.muted);
  // Semantic colours follow the theme too, or "paid" green goes invisible on white.
  root.setProperty("--success", preset.success);
  root.setProperty("--warning", preset.warning);
  root.setProperty("--info", preset.info);
  root.setProperty("--attention", preset.attention);
  root.setProperty("--hold", preset.hold);
  root.setProperty("--primary-foreground", settings.themeMode === "dark" ? "30 5% 8%" : "0 0% 100%");

  // Optional per-surface overrides win over the preset. Empty/invalid = skip.
  const override = (varNames: string[], hex?: string) => {
    const hsl = hex ? hexToHslString(hex) : null;
    if (hsl) varNames.forEach((v) => root.setProperty(v, hsl));
  };
  override(["--background"], settings.backgroundColorHex);
  override(["--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground"], settings.textColorHex);
  override(["--muted-foreground"], settings.mutedTextColorHex);
  override(["--card", "--popover"], settings.cardColorHex);
  override(["--border", "--input"], settings.borderColorHex);
  override(["--accent"], settings.accentColorHex);

  // Interface style: all "modern" rules in globals.css are scoped to this attribute,
  // so "classic" is exactly the original look.
  document.documentElement.dataset.ui = settings.uiStyle === "classic" ? "classic" : "modern";
  document.documentElement.dataset.theme = settings.themeMode;
  // Let the modern style refine the page/card tones only when the customer
  // hasn't picked their own colours.
  document.documentElement.dataset.customBg = settings.backgroundColorHex ? "1" : "0";
  document.documentElement.dataset.customCard = settings.cardColorHex ? "1" : "0";

  const pair = FONT_PAIRS.find((f) => f.id === settings.fontPairId) ?? FONT_PAIRS[0];
  // The brand's own heading font stays on the company name in modern style.
  root.setProperty("--font-brand", `"${fontFamilyName(pair.heading)}", serif`);
  root.setProperty("--font-cinzel", `"${fontFamilyName(pair.heading)}", serif`);
  root.setProperty("--font-lato", `"${fontFamilyName(pair.body)}", system-ui, sans-serif`);

  let link = document.getElementById(injectedFontLinkId) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = injectedFontLinkId;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?family=${pair.heading}&family=${pair.body}&display=swap`;

  document.title = `${settings.companyName} | ${settings.tagline}`;
}

/** Resizes + compresses an uploaded image client-side before storing as base64
 * (Google Sheets cells cap out around 50,000 characters -- this keeps logos well under that). */
/** Longest data URL that fits safely in one Google Sheets cell (limit 50,000). */
export const MAX_LOGO_DATAURL = 44000;

/**
 * Resize + compress an image until it fits in one Google Sheets cell.
 * Tries sharp PNG first (keeps transparency), then WebP, then smaller sizes,
 * so detailed/photo-like logos no longer fail with "too large".
 */
export function resizeImageToDataUrl(file: File, maxDimension = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const render = (dim: number, type: string, quality?: number): string => {
          const scale = Math.min(1, dim / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas not supported");
          if (type === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL(type, quality);
        };
        try {
          const dims = [maxDimension, Math.round(maxDimension * 0.8), Math.round(maxDimension * 0.6), 96];
          for (const dim of dims) {
            const png = render(dim, "image/png");
            if (png.length <= MAX_LOGO_DATAURL) return resolve(png);
            for (const q of [0.92, 0.8, 0.65, 0.5]) {
              const webp = render(dim, "image/webp", q);
              if (webp.startsWith("data:image/webp") && webp.length <= MAX_LOGO_DATAURL) return resolve(webp);
              const jpg = render(dim, "image/jpeg", q);
              if (jpg.length <= MAX_LOGO_DATAURL) return resolve(jpg);
            }
          }
          reject(new Error("This image is too detailed to store. Try a simpler logo (plain background, fewer details)."));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error("Couldn't read that image. Use a PNG or JPG file."));
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


/** Initials for the logo mark, derived from the customer's own company name
 * (the old hardcoded "YB" showed on every customer's login screen). */
export function brandInitials(companyName: string): string {
  const words = String(companyName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
