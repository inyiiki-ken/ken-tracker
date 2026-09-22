/**
 * ZOHO INVOICE INTEGRATION — shared types + per-customer settings.
 *
 * Zoho is the customer's system of record for MONEY (tax invoices, sequential
 * invoice numbers, receivables). This app stays the system of record for
 * OPERATIONS. So the rule throughout: Zoho owns invoice numbers, we never
 * invent them, and we never send the same invoice twice.
 */

export interface ZohoSettings {
  /** Master switch. Off = the app will not touch Zoho at all, even if
   * credentials are present. Lets you configure and test before going live. */
  enabled: boolean;
  /** Zoho organisation this customer invoices from. */
  organizationId: string;
  /** Self-client credentials created in the customer's own Zoho console. */
  clientId: string;
  clientSecret: string;
  /** Long-lived token used to mint short-lived access tokens. */
  refreshToken: string;
  /** Zoho data centre domain — .com, .eu, .in, .com.au, .sa … */
  apiDomain: string;
  accountsDomain: string;
  /** Tax applied to invoice lines. MUST be confirmed by the customer's
   * accountant — a wrong rate is their legal problem, not a cosmetic bug. */
  taxPercent: number;
  /** true = the prices in this app already include tax. */
  pricesIncludeTax: boolean;
  /** Optional Zoho tax id to attach to lines (overrides taxPercent if set). */
  taxId: string;
  /** Create invoices as drafts so the accounts person reviews before sending. */
  createAsDraft: boolean;
}

export const DEFAULT_ZOHO_SETTINGS: ZohoSettings = {
  enabled: false,
  organizationId: "",
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  apiDomain: "https://www.zohoapis.com",
  accountsDomain: "https://accounts.zoho.com",
  taxPercent: 0,
  pricesIncludeTax: true,
  taxId: "",
  createAsDraft: true,
};

/** Zoho data centres — the API host differs per region. */
export const ZOHO_REGIONS: { label: string; api: string; accounts: string }[] = [
  { label: "United States (.com)", api: "https://www.zohoapis.com", accounts: "https://accounts.zoho.com" },
  { label: "Europe (.eu)", api: "https://www.zohoapis.eu", accounts: "https://accounts.zoho.eu" },
  { label: "India (.in)", api: "https://www.zohoapis.in", accounts: "https://accounts.zoho.in" },
  { label: "Australia (.com.au)", api: "https://www.zohoapis.com.au", accounts: "https://accounts.zoho.com.au" },
  { label: "Saudi Arabia (.sa)", api: "https://www.zohoapis.sa", accounts: "https://accounts.zoho.sa" },
  { label: "Canada (.ca)", api: "https://www.zohoapis.ca", accounts: "https://accounts.zoho.ca" },
];

export interface ZohoContactMatch {
  contactId: string;
  contactName: string;
  email?: string;
  phone?: string;
  /** What Zoho says this customer still owes — useful context before invoicing. */
  outstanding?: number;
}

export interface ZohoPushResult {
  success: boolean;
  contactId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
  /** Invoice reached Zoho but the tracker couldn't record it on every row. */
  warning?: string;
}

export function isZohoConfigured(s: ZohoSettings | null | undefined): boolean {
  return !!(s && s.organizationId && s.clientId && s.clientSecret && s.refreshToken);
}

/** Configured AND switched on. Writes must check this, not just isZohoConfigured. */
export function isZohoLive(s: ZohoSettings | null | undefined): boolean {
  return isZohoConfigured(s) && !!s?.enabled;
}
