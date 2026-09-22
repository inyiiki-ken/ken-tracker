"use server";

import { readConfig, writeConfig } from "@/lib/google-sheets/config-store";
import { requireRole, requireSession } from "@/lib/google-sheets/authz";
import { getActiveWorksheet } from "@/lib/google-sheets/tenant-context";
import { DATABASE_HEADERS } from "@/lib/google-sheets/sheet-config";
import {
  DEFAULT_ZOHO_SETTINGS,
  isZohoConfigured,
  isZohoLive,
  type ZohoContactMatch,
  type ZohoPushResult,
  type ZohoSettings,
} from "./types";
import { searchContacts, getContact, createContact, createInvoice, findInvoiceByReference, testConnection } from "./client";

const MARKER = "__ZOHO_SETTINGS__";

async function loadSettings(): Promise<ZohoSettings> {
  const raw = await readConfig(MARKER);
  if (!raw) return { ...DEFAULT_ZOHO_SETTINGS };
  try {
    return { ...DEFAULT_ZOHO_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_ZOHO_SETTINGS };
  }
}

/**
 * Settings for the UI — secrets are REDACTED so credentials never travel to a
 * browser. Saving preserves any field left as the redaction placeholder.
 */
const REDACTED = "••••••••";

export async function getZohoSettings(): Promise<{ settings: ZohoSettings; configured: boolean }> {
  await requireRole(["admin", "super_admin"]);
  const s = await loadSettings();
  return {
    configured: isZohoConfigured(s),
    settings: {
      ...s,
      clientSecret: s.clientSecret ? REDACTED : "",
      refreshToken: s.refreshToken ? REDACTED : "",
    },
  };
}

export async function saveZohoSettings(params: { settings: ZohoSettings }): Promise<{ success: boolean }> {
  await requireRole(["super_admin"]);
  const existing = await loadSettings();
  const incoming = params.settings;
  const merged: ZohoSettings = {
    ...existing,
    ...incoming,
    // Keep the stored secret when the form sent back the placeholder.
    clientSecret: incoming.clientSecret === REDACTED ? existing.clientSecret : incoming.clientSecret,
    refreshToken: incoming.refreshToken === REDACTED ? existing.refreshToken : incoming.refreshToken,
  };
  await writeConfig(MARKER, JSON.stringify(merged));
  return { success: true };
}

export async function testZohoConnection(): Promise<{ ok: boolean; error?: string }> {
  await requireRole(["admin", "super_admin"]);
  const s = await loadSettings();
  if (!isZohoConfigured(s)) return { ok: false, error: "Fill in the Zoho credentials first." };
  return testConnection(s);
}

/** Cheap check for the UI — is Zoho on for this customer? No secrets returned. */
export async function isZohoEnabled(): Promise<boolean> {
  try {
    await requireSession();
    return isZohoLive(await loadSettings());
  } catch {
    return false;
  }
}

/** Candidate matches for a client name, so the user confirms before we link. */
export async function findZohoContacts(params: { name: string }): Promise<ZohoContactMatch[]> {
  await requireSession();
  const s = await loadSettings();
  if (!isZohoConfigured(s)) return [];
  return searchContacts(s, params.name);
}

/**
 * Push one client's items to Zoho.
 *
 * Duplicate safety, in order:
 *   1. a contact id already linked on the row  → use it (no search, exact)
 *   2. an id the user just confirmed in the UI → use it, then remember it
 *   3. otherwise create a new Zoho customer
 *
 * Refuses to run if any row already carries a Zoho invoice number, so the same
 * sale can't be invoiced twice.
 */
export async function pushToZoho(params: {
  minerName: string;
  rowIds: number[];
  lineItems: { name: string; description?: string; quantity: number; rate: number }[];
  /** Existing link or a match the user picked. */
  contactId?: string;
  email?: string;
  phone?: string;
  address?: string;
  reference?: string;
  date?: string;
  /** Set true only after the user acknowledges an existing invoice number. */
  force?: boolean;
}): Promise<ZohoPushResult> {
  await requireRole(["admin", "super_admin"]);
  const s = await loadSettings();
  if (!isZohoConfigured(s)) {
    return { success: false, error: "Zoho isn't set up yet — add the credentials in Settings." };
  }
  if (!isZohoLive(s)) {
    return { success: false, error: "Zoho is configured but switched off. Turn on 'Send to Zoho' in Settings when you're ready to go live." };
  }
  if (params.lineItems.length === 0) {
    return { success: false, error: "Nothing to invoice." };
  }

  const sheet = await getActiveWorksheet("database");
  const rows = await sheet.getRows();
  const targets = rows.filter((r) => params.rowIds.includes(r.rowNumber));
  if (targets.length === 0) return { success: false, error: "Those records were not found. Refresh and try again." };

  // Guard: never invoice the same rows twice.
  if (!params.force) {
    const already = targets
      .map((r) => String(r.get(ZOHO_INVOICE_HEADER) ?? "").trim())
      .filter(Boolean);
    if (already.length > 0) {
      return {
        success: false,
        error: `Already invoiced in Zoho (${already[0]}). Sending again would create a duplicate.`,
      };
    }
  }

  // 1/2 — resolve the Zoho customer.
  let contactId = String(params.contactId ?? "").trim();
  if (contactId) {
    const still = await getContact(s, contactId);
    if (!still) contactId = ""; // link is stale (deleted in Zoho) — fall through
  }
  if (!contactId) {
    const created = await createContact(s, {
      name: params.minerName,
      email: params.email,
      phone: params.phone,
      address: params.address,
    });
    contactId = created.contactId;
  }

  // 3 — raise the invoice. Zoho owns the number.
  //
  // Deterministic reference = idempotency key. If a previous attempt actually
  // reached Zoho but we never saw the response, this finds that invoice instead
  // of creating a duplicate in the customer's books.
  const reference = params.reference || `KT-${params.rowIds.slice().sort((a, b) => a - b).join("-")}`;

  let invoiceId: string;
  let invoiceNumber: string;
  const existing = await findInvoiceByReference(s, reference);
  if (existing) {
    invoiceId = existing.invoiceId;
    invoiceNumber = existing.invoiceNumber;
  } else {
    const created = await createInvoice(s, {
      contactId,
      lineItems: params.lineItems,
      reference,
      date: params.date,
    });
    invoiceId = created.invoiceId;
    invoiceNumber = created.invoiceNumber;
  }

  // 4 — write the link + number back so we never duplicate or re-search.
  //
  // This used to save one row per request and swallow every failure. Two
  // problems: a 30-item invoice meant 30 sequential Sheets writes, and if any
  // of them failed the row kept an empty "ZOHO Invoice" cell — so the dialog's
  // already-invoiced warning never fired and staff were free to send again.
  // (The reference_number check above still stops a real duplicate reaching
  // Zoho, but the user had no idea anything was wrong.) Now: one save attempt
  // per row, and we report back how many landed so the caller can warn.
  let writtenBack = 0;
  let writeBackError = "";
  for (const r of targets) {
    try {
      r.set(ZOHO_INVOICE_HEADER, invoiceNumber);
      if (hasHeader(sheet, ZOHO_CONTACT_HEADER)) r.set(ZOHO_CONTACT_HEADER, contactId);
      await r.save();
      writtenBack++;
    } catch (err) {
      writeBackError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    success: true,
    contactId,
    invoiceId,
    invoiceNumber,
    // Surfaced so the UI can tell the user the invoice exists in Zoho even
    // though the tracker didn't finish recording it.
    ...(writtenBack < targets.length
      ? {
          warning:
            `Invoice ${invoiceNumber} was created in Zoho, but only ${writtenBack} of ` +
            `${targets.length} row(s) were marked in the tracker. Do not send again — ` +
            `set the invoice number manually.` + (writeBackError ? ` (${writeBackError})` : ""),
        }
      : {}),
  };
}

const ZOHO_INVOICE_HEADER = "ZOHO Invoice";
const ZOHO_CONTACT_HEADER = "Zoho Contact ID";

function hasHeader(sheet: { headerValues?: string[] }, header: string): boolean {
  return (sheet.headerValues ?? []).includes(header);
}

void DATABASE_HEADERS;
