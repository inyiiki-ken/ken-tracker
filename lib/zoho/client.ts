import "server-only";
import { DEFAULT_ZOHO_SETTINGS, type ZohoSettings, type ZohoContactMatch } from "./types";

/**
 * Thin Zoho Invoice REST client (API v3).
 *
 * Runs SERVER-side only — the customer's Zoho credentials must never reach a
 * browser. Access tokens are short-lived, so we mint them from the refresh
 * token and cache them in memory until just before they expire.
 */

interface TokenCacheEntry { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenCacheEntry>();

async function getAccessToken(s: ZohoSettings): Promise<string> {
  const key = `${s.organizationId}:${s.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const url = new URL(`${s.accountsDomain || DEFAULT_ZOHO_SETTINGS.accountsDomain}/oauth/v2/token`);
  url.searchParams.set("refresh_token", s.refreshToken);
  url.searchParams.set("client_id", s.clientId);
  url.searchParams.set("client_secret", s.clientSecret);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Zoho sign-in failed (${res.status}). Check the Client ID, Client Secret and Refresh Token in Settings. ${data?.error ?? ""}`.trim()
    );
  }
  // Zoho tokens last ~1h; refresh a minute early.
  const ttl = (Number(data.expires_in) || 3600) * 1000 - 60_000;
  tokenCache.set(key, { token: data.access_token, expiresAt: Date.now() + ttl });
  return data.access_token;
}

async function zohoFetch(
  s: ZohoSettings,
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {}
): Promise<Record<string, unknown>> {
  const token = await getAccessToken(s);
  const base = s.apiDomain || DEFAULT_ZOHO_SETTINGS.apiDomain;
  const url = new URL(`${base}/invoice/v3${path}`);
  url.searchParams.set("organization_id", s.organizationId);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "X-com-zoho-invoice-organizationid": s.organizationId,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = String((data as { message?: string }).message ?? `HTTP ${res.status}`);
    throw new Error(`Zoho: ${msg}`);
  }
  return data;
}

/** Search Zoho's customer list by name. */
export async function searchContacts(s: ZohoSettings, name: string): Promise<ZohoContactMatch[]> {
  const q = String(name ?? "").trim();
  if (!q) return [];
  const data = await zohoFetch(s, "/contacts", {
    method: "GET",
    query: { search_text: q.slice(0, 100), per_page: "20" },
  });
  const list = (data.contacts as Record<string, unknown>[]) ?? [];
  return list.map((c) => ({
    contactId: String(c.contact_id ?? ""),
    contactName: String(c.contact_name ?? ""),
    email: c.email ? String(c.email) : undefined,
    phone: c.phone ? String(c.phone) : undefined,
    outstanding:
      typeof c.outstanding_receivable_amount === "number"
        ? (c.outstanding_receivable_amount as number)
        : undefined,
  }));
}

/** Fetch one contact — used to confirm a saved link still exists. */
export async function getContact(s: ZohoSettings, contactId: string): Promise<ZohoContactMatch | null> {
  try {
    const data = await zohoFetch(s, `/contacts/${encodeURIComponent(contactId)}`, { method: "GET" });
    const c = data.contact as Record<string, unknown> | undefined;
    if (!c) return null;
    return {
      contactId: String(c.contact_id ?? ""),
      contactName: String(c.contact_name ?? ""),
      email: c.email ? String(c.email) : undefined,
      phone: c.phone ? String(c.phone) : undefined,
      outstanding:
        typeof c.outstanding_receivable_amount === "number"
          ? (c.outstanding_receivable_amount as number)
          : undefined,
    };
  } catch {
    return null; // deleted or inaccessible — caller falls back to search
  }
}

export async function createContact(
  s: ZohoSettings,
  input: { name: string; email?: string; phone?: string; address?: string }
): Promise<ZohoContactMatch> {
  const billing = input.address ? { address: input.address } : undefined;
  const body: Record<string, unknown> = {
    contact_name: input.name,
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(billing ? { billing_address: billing } : {}),
  };
  const data = await zohoFetch(s, "/contacts", { method: "POST", body: JSON.stringify(body) });
  const c = (data.contact as Record<string, unknown>) ?? {};
  return {
    contactId: String(c.contact_id ?? ""),
    contactName: String(c.contact_name ?? input.name),
  };
}

export interface ZohoLineItem {
  name: string;
  description?: string;
  quantity: number;
  rate: number;
}

/** Create an invoice for a contact. Zoho assigns the invoice number. */
export async function createInvoice(
  s: ZohoSettings,
  input: { contactId: string; lineItems: ZohoLineItem[]; reference?: string; date?: string; notes?: string }
): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const line_items = input.lineItems.map((li) => ({
    name: li.name.slice(0, 100),
    ...(li.description ? { description: li.description.slice(0, 500) } : {}),
    quantity: li.quantity,
    rate: li.rate,
    ...(s.taxId ? { tax_id: s.taxId } : {}),
  }));

  const body: Record<string, unknown> = {
    customer_id: input.contactId,
    line_items,
    ...(input.reference ? { reference_number: input.reference } : {}),
    ...(input.date ? { date: input.date } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    // Tell Zoho whether the rates we send already include tax.
    is_inclusive_tax: !!s.pricesIncludeTax,
  };

  const data = await zohoFetch(s, "/invoices", {
    method: "POST",
    body: JSON.stringify(body),
    // Zoho creates as draft unless told to send; keep the customer in control.
    query: s.createAsDraft ? {} : { send: "false" },
  });
  const inv = (data.invoice as Record<string, unknown>) ?? {};
  return {
    invoiceId: String(inv.invoice_id ?? ""),
    invoiceNumber: String(inv.invoice_number ?? ""),
  };
}

/**
 * IDEMPOTENCY GUARD.
 *
 * If the network drops after Zoho creates an invoice but before we write the
 * number back to the sheet, a retry would raise a SECOND real invoice in the
 * customer's books. Every push therefore carries a deterministic reference
 * number; before creating anything we ask Zoho whether that reference already
 * exists and reuse it if so.
 */
export async function findInvoiceByReference(
  s: ZohoSettings,
  reference: string
): Promise<{ invoiceId: string; invoiceNumber: string } | null> {
  const ref = String(reference ?? "").trim();
  if (!ref) return null;
  try {
    const data = await zohoFetch(s, "/invoices", {
      method: "GET",
      query: { reference_number: ref, per_page: "5" },
    });
    const list = (data.invoices as Record<string, unknown>[]) ?? [];
    const hit = list.find((i) => String(i.reference_number ?? "").trim() === ref);
    if (!hit) return null;
    return {
      invoiceId: String(hit.invoice_id ?? ""),
      invoiceNumber: String(hit.invoice_number ?? ""),
    };
  } catch {
    return null; // can't confirm — caller decides
  }
}

/** Cheap credentials check for the Settings panel. */
export async function testConnection(s: ZohoSettings): Promise<{ ok: boolean; organization?: string; error?: string }> {
  try {
    const data = await zohoFetch(s, "/contacts", { method: "GET", query: { per_page: "1" } });
    const info = data.page_context ? "connected" : "connected";
    return { ok: true, organization: info };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}
