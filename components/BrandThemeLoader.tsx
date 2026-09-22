"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getBrandSettings, getBrandLogo, getPageLogos } from "@/lib/api";
import { applyBrandSettingsToDom, DEFAULT_BRAND_SETTINGS, type BrandSettings } from "@/lib/brandSettings";

interface BrandContextValue {
  settings: BrandSettings;
  headerLogo: string | null;
  invoiceLogo: string | null;
  /** page/brand name -> logo dataUrl (used on invoices per page). */
  pageLogos: Record<string, string>;
  loaded: boolean;
  refresh: () => void;
}

const BrandContext = createContext<BrandContextValue>({
  settings: DEFAULT_BRAND_SETTINGS,
  headerLogo: null,
  invoiceLogo: null,
  pageLogos: {},
  loaded: false,
  refresh: () => {},
});

export function useBrand() {
  return useContext(BrandContext);
}

/**
 * Mounted once near the root (app/page.tsx's outer App component) so it
 * applies before AND after login -- WelcomeScreen and the authenticated app
 * both read from the same saved settings.
 */
export function BrandThemeLoader({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<BrandSettings>(DEFAULT_BRAND_SETTINGS);
  const [headerLogo, setHeaderLogo] = useState<string | null>(null);
  const [invoiceLogo, setInvoiceLogo] = useState<string | null>(null);
  const [pageLogos, setPageLogos] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const load = () => {
    Promise.all([getBrandSettings(), getBrandLogo("header"), getBrandLogo("invoice"), getPageLogos({}).catch(() => [])])
      .then(([settingsRes, headerRes, invoiceRes, pageLogosRes]) => {
        let parsed = DEFAULT_BRAND_SETTINGS;
        if (settingsRes.config) {
          try {
            parsed = { ...DEFAULT_BRAND_SETTINGS, ...JSON.parse(settingsRes.config) };
          } catch {
            /* keep defaults on parse failure */
          }
        }
        setSettings(parsed);
        setHeaderLogo(headerRes.dataUrl);
        setInvoiceLogo(invoiceRes.dataUrl);
        const map: Record<string, string> = {};
        for (const pl of pageLogosRes) map[pl.page] = pl.dataUrl;
        setPageLogos(map);
        applyBrandSettingsToDom(parsed);
      })
      .catch((err) => console.error("Failed to load brand settings:", err))
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BrandContext.Provider value={{ settings, headerLogo, invoiceLogo, pageLogos, loaded, refresh: load }}>
      {children}
    </BrandContext.Provider>
  );
}
