/**
 * Single source of truth for branding across the app. Change these values
 * here instead of hunting through every component -- everywhere the old
 * "AR Universal Trading" text appeared now imports from this file.
 */
export const BRAND = {
  /** Short mark shown in the logo badge (2-3 letters looks best) */
  initials: "YB",
  /** Full company name */
  name: "Your Business Name",
  /** Legal suffix shown separately under the name on the login screen */
  legalSuffix: "LLC",
  /** Shown under the company name (login screen, header) */
  tagline: "Jewellery Tracker",
  /** Shown in the browser tab and page metadata */
  pageTitle: "Your Business Name | Jewellery Tracker",
  /** Shown on printed invoices */
  invoiceBrandLine: "YOUR BUSINESS NAME LLC",
  /** Watermark text on printed invoices */
  invoiceWatermark: "YOUR BUSINESS NAME OFFICIAL",
  /** City/country line on the login screen footer */
  location: "Dubai, UAE",
} as const;
