import "server-only";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getSpreadsheetById } from "./client";
import { SHEET_ID, ROLES_HEADERS } from "./sheet-config";
import { parseSheetId } from "./sheetId";
import type { Tenant, MyContext } from "@/lib/tenancy-types";

export type { Tenant, MyContext };

/**
 * Multi-tenant core (server-only). The developer owns a "Control" spreadsheet
 * (env CONTROL_SHEET_ID) with a "Tenants" tab listing every customer. Each
 * customer's own data lives in their own sheet, referenced here by `sheetId`.
 *
 * Data access is scoped to the *active* tenant, which is derived from the
 * signed-in user's email (never from client input), so one customer can never
 * read another's sheet. Developers may additionally switch the active tenant.
 *
 * If CONTROL_SHEET_ID is unset the app runs single-tenant against
 * GOOGLE_SHEET_ID, exactly as before.
 */

export const DEV_TENANT_COOKIE = "myk_dev_tenant";

const TENANTS_TAB = "Tenants";
const TENANT_HEADERS = {
  tenantId: "tenantId",
  displayName: "displayName",
  allowedEmails: "allowedEmails",
  emailDomain: "emailDomain",
  sheetId: "sheetId",
  active: "active",
  plan: "plan",
  notes: "notes",
} as const;

export function isMultiTenant(): boolean {
  return !!process.env.CONTROL_SHEET_ID;
}

export function isDeveloper(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.DEVELOPER_EMAILS || "")
    .toLowerCase()
    .split(/[|,;\s]+/)
    .filter(Boolean);
  return list.includes(email.toLowerCase().trim());
}

/** Authenticated user's email, read server-side from the session (trusted). */
export async function getSessionEmail(): Promise<string | null> {
  try {
    const session = await getServerSession(authOptions);
    return session?.user?.email ?? null;
  } catch {
    return null;
  }
}

function splitEmails(raw: string): string[] {
  return (raw || "")
    .toLowerCase()
    .split(/[|,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowToTenant(get: (k: string) => unknown): Tenant {
  const activeRaw = String(get(TENANT_HEADERS.active) ?? "").trim().toLowerCase();
  return {
    tenantId: String(get(TENANT_HEADERS.tenantId) ?? "").trim(),
    displayName: String(get(TENANT_HEADERS.displayName) ?? "").trim(),
    allowedEmails: String(get(TENANT_HEADERS.allowedEmails) ?? "").trim(),
    emailDomain: String(get(TENANT_HEADERS.emailDomain) ?? "").trim(),
    sheetId: parseSheetId(String(get(TENANT_HEADERS.sheetId) ?? "").trim()),
    // Blank/"yes"/"true"/"1"/"active" all count as active; only explicit
    // "false"/"no"/"0"/"inactive" disable a tenant.
    active: !["false", "no", "0", "inactive", "disabled"].includes(activeRaw),
    plan: String(get(TENANT_HEADERS.plan) ?? "").trim(),
    notes: String(get(TENANT_HEADERS.notes) ?? "").trim(),
  };
}

// Short-lived cache so the Control sheet isn't re-read on every action (each
// data/config call resolves the active tenant, which used to hammer the Sheets
// API and hit the 429 read quota). Invalidated on tenant writes.
let tenantsCache: { at: number; rows: Tenant[] } | null = null;
const TENANTS_TTL_MS = 20_000;

export function invalidateTenantsCache(): void {
  tenantsCache = null;
}

export async function getTenants(): Promise<Tenant[]> {
  const controlId = process.env.CONTROL_SHEET_ID;
  if (!controlId) return [];
  if (tenantsCache && Date.now() - tenantsCache.at < TENANTS_TTL_MS) return tenantsCache.rows;

  const doc = await getSpreadsheetById(parseSheetId(controlId));
  const ws = doc.sheetsByTitle[TENANTS_TAB];
  if (!ws) throw new Error(`Control sheet has no "${TENANTS_TAB}" tab.`);
  const rows = await ws.getRows();
  const tenants = rows
    .map((r) => rowToTenant((k) => r.get(k)))
    .filter((t) => t.tenantId && t.sheetId);
  tenantsCache = { at: Date.now(), rows: tenants };
  return tenants;
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const id = tenantId.trim();
  if (!id) return null;
  const all = await getTenants();
  return all.find((t) => t.tenantId.toLowerCase() === id.toLowerCase()) ?? null;
}

export async function resolveTenantForEmail(email: string): Promise<Tenant | null> {
  const e = email.toLowerCase().trim();
  if (!e) return null;
  const domain = e.split("@")[1] ?? "";
  const all = await getTenants();
  const active = all.filter((t) => t.active);

  // 1) explicit email allowlist wins
  const byEmail = active.find((t) => splitEmails(t.allowedEmails).includes(e));
  if (byEmail) return byEmail;

  // 2) domain match
  const byDomain = active.find(
    (t) => t.emailDomain && t.emailDomain.toLowerCase().trim() === domain
  );
  if (byDomain) return byDomain;

  // 3) fall back to the customer's own Roles tab. This means you only have to
  // add staff in ONE place (the customer sheet's "Roles" tab) — the Control
  // sheet's allowedEmails is optional. If two tenants list the same email in
  // their Roles tab, the first active one wins.
  for (const t of active) {
    if (await emailInTenantRoles(t, e)) return t;
  }
  return null;
}

// Cache of lowercase emails found in each tenant's Roles tab, to avoid re-reading
// every customer sheet on each request. Short TTL so newly-added staff appear fast.
const rolesEmailCache = new Map<string, { at: number; emails: Set<string> }>();
const ROLES_EMAIL_TTL_MS = 30_000;

async function emailInTenantRoles(tenant: Tenant, lowerEmail: string): Promise<boolean> {
  if (!tenant.sheetId) return false;
  const cached = rolesEmailCache.get(tenant.sheetId);
  if (cached && Date.now() - cached.at < ROLES_EMAIL_TTL_MS) {
    return cached.emails.has(lowerEmail);
  }
  try {
    const doc = await getSpreadsheetById(tenant.sheetId);
    const ws = doc.sheetsByTitle["Roles"];
    if (!ws) {
      rolesEmailCache.set(tenant.sheetId, { at: Date.now(), emails: new Set() });
      return false;
    }
    const rows = await ws.getRows();
    const emails = new Set(
      rows
        .map((r) => String(r.get(ROLES_HEADERS.email) ?? "").toLowerCase().trim())
        .filter(Boolean)
    );
    rolesEmailCache.set(tenant.sheetId, { at: Date.now(), emails });
    return emails.has(lowerEmail);
  } catch {
    return false; // can't read that sheet -> just don't match via this path
  }
}

/**
 * The sheet id whose data the current request should read/write. Single-tenant
 * mode returns the env sheet. Multi-tenant derives it from the trusted session
 * email; developers may override via the switch cookie.
 */
export async function getActiveSheetId(): Promise<string> {
  if (!isMultiTenant()) {
    return process.env.GOOGLE_SHEET_ID || SHEET_ID;
  }

  const email = await getSessionEmail();
  if (!email) throw new Error("Not signed in.");

  if (isDeveloper(email)) {
    const override = cookies().get(DEV_TENANT_COOKIE)?.value;
    if (override) {
      const t = await getTenantById(override);
      if (t) return t.sheetId;
    }
    // Developer with no active selection: fall back to first active tenant.
    const all = await getTenants();
    const first = all.find((t) => t.active);
    if (first) return first.sheetId;
  }

  const tenant = await resolveTenantForEmail(email);
  if (!tenant) throw new Error("No workspace is assigned to your account.");
  return tenant.sheetId;
}

export async function getMyContextCore(): Promise<MyContext> {
  const email = await getSessionEmail();
  const dev = isDeveloper(email);

  if (!isMultiTenant()) {
    return {
      email,
      isDeveloper: dev,
      multiTenant: false,
      activeTenant: null,
      tenants: [],
    };
  }

  let active: Tenant | null = null;
  let tenants: Tenant[] = [];
  let controlError: string | undefined;

  // Reading the Control sheet can fail (not shared yet, no Tenants tab, etc.).
  // That must NOT lock out a developer — they need God Mode to fix it. So the
  // developer flag is always returned; tenant data is best-effort, and the
  // failure reason is surfaced for diagnostics.
  try {
    if (dev) {
      tenants = await getTenants();
      const override = cookies().get(DEV_TENANT_COOKIE)?.value;
      active = override ? await getTenantById(override) : null;
      if (!active) active = tenants.find((t) => t.active) ?? null;
    } else if (email) {
      active = await resolveTenantForEmail(email);
    }
  } catch (err) {
    controlError = err instanceof Error ? err.message : String(err);
    console.error("getMyContextCore: control sheet read failed:", err);
  }

  return {
    email,
    isDeveloper: dev,
    multiTenant: true,
    activeTenant: active
      ? { tenantId: active.tenantId, displayName: active.displayName, sheetId: active.sheetId }
      : null,
    tenants,
    controlError,
  };
}

// ---------- Registry mutations (developer only; caller must verify) ----------

function genTenantId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slug || "tenant"}-${rand}`;
}

export async function upsertTenantCore(input: {
  tenantId?: string;
  displayName: string;
  allowedEmails: string;
  emailDomain?: string;
  sheetIdOrUrl: string;
  active?: boolean;
  plan?: string;
  notes?: string;
}): Promise<Tenant> {
  const controlId = process.env.CONTROL_SHEET_ID;
  if (!controlId) throw new Error("CONTROL_SHEET_ID is not configured.");
  const doc = await getSpreadsheetById(parseSheetId(controlId));
  const ws = doc.sheetsByTitle[TENANTS_TAB];
  if (!ws) throw new Error(`Control sheet has no "${TENANTS_TAB}" tab.`);

  const sheetId = parseSheetId(input.sheetIdOrUrl);
  const tenant: Tenant = {
    tenantId: input.tenantId?.trim() || genTenantId(input.displayName),
    displayName: input.displayName.trim(),
    allowedEmails: input.allowedEmails.trim(),
    emailDomain: (input.emailDomain ?? "").trim(),
    sheetId,
    active: input.active ?? true,
    plan: (input.plan ?? "").trim(),
    notes: (input.notes ?? "").trim(),
  };

  const rows = await ws.getRows();
  const existing = rows.find(
    (r) => String(r.get(TENANT_HEADERS.tenantId) ?? "").trim().toLowerCase() === tenant.tenantId.toLowerCase()
  );

  const payload: Record<string, string> = {
    [TENANT_HEADERS.tenantId]: tenant.tenantId,
    [TENANT_HEADERS.displayName]: tenant.displayName,
    [TENANT_HEADERS.allowedEmails]: tenant.allowedEmails,
    [TENANT_HEADERS.emailDomain]: tenant.emailDomain,
    [TENANT_HEADERS.sheetId]: tenant.sheetId,
    [TENANT_HEADERS.active]: tenant.active ? "true" : "false",
    [TENANT_HEADERS.plan]: tenant.plan,
    [TENANT_HEADERS.notes]: tenant.notes,
  };

  if (existing) {
    for (const [k, v] of Object.entries(payload)) existing.set(k, v);
    await existing.save();
  } else {
    await ws.addRow(payload);
  }
  invalidateTenantsCache();
  return tenant;
}
