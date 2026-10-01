import "server-only";
import { getActiveWorksheet } from "./tenant-context";
import { ROLES_HEADERS } from "./sheet-config";
import { getSessionEmail, isDeveloper, getActiveSheetId } from "./tenancy-core";
import { getUserRole, EMAIL_TO_LIVER_NAME } from "@/config/roles";

/**
 * Server-side authorization for mutating actions. Roles used to be enforced only
 * in the UI, so a crafted request could do more than a user's role allows. These
 * helpers re-check identity/role on the server, derived from the trusted session.
 *
 * SAFETY VALVE: set DISABLE_SERVER_AUTHZ=true (e.g. in the install's .env) to
 * bypass all checks without a rebuild — an escape hatch if a session ever fails
 * to resolve on a machine. Checks otherwise fail-closed.
 */

function authzEnabled(): boolean {
  return process.env.DISABLE_SERVER_AUTHZ !== "true";
}

// Small cache so we don't re-read the Roles sheet on every action. KEYED BY
// CUSTOMER SHEET: one shared cache let one customer's roles answer permission
// checks for another customer for up to 30s on a shared server (Vercel).
type RoleRow = { email: string; role: string; name: string };
const rolesCache = new Map<string, { at: number; rows: RoleRow[] }>();
const ROLES_TTL_MS = 30_000;

/** The Roles sheet rows, or null when it couldn't be read (never cached). */
async function loadRolesData(): Promise<RoleRow[] | null> {
  let sheetId = "";
  try { sheetId = await getActiveSheetId(); } catch { return null; }
  const cached = rolesCache.get(sheetId);
  if (cached && Date.now() - cached.at < ROLES_TTL_MS) return cached.rows;
  try {
    const sheet = await getActiveWorksheet("roles");
    const rows = await sheet.getRows();
    const data = rows.map((r) => ({
      email: String(r.get(ROLES_HEADERS.email) ?? ""),
      role: String(r.get(ROLES_HEADERS.role) ?? ""),
      name: String(r.get(ROLES_HEADERS.name) ?? ""),
    }));
    rolesCache.set(sheetId, { at: Date.now(), rows: data });
    return data;
  } catch {
    return null;
  }
}

async function getRolesData(): Promise<RoleRow[]> {
  return (await loadRolesData()) ?? [];
}

/** Ensure the caller is signed in; returns their email. Throws otherwise. */
export async function requireSession(): Promise<string | null> {
  if (!authzEnabled()) return null;
  const email = await getSessionEmail();
  if (!email) throw new Error("You must be signed in to do this.");
  return email;
}

/** The signed-in user's roles for the active tenant (developer ⇒ super_admin). */
export async function getSessionRoles(): Promise<string[]> {
  const email = await getSessionEmail();
  if (!email) return [];
  if (isDeveloper(email)) return ["super_admin", "admin"];
  const rolesData = await getRolesData();
  return getUserRole(email, rolesData);
}

/**
 * Throw unless the signed-in user has at least one of the allowed roles.
 * Returns their email for audit lines (null when checks are switched off).
 */
export async function requireRole(allowed: string[]): Promise<string | null> {
  if (!authzEnabled()) return null;
  const email = await getSessionEmail();
  if (!email) throw new Error("You must be signed in to do this.");
  if (isDeveloper(email)) return email; // developer/God Mode always allowed
  const roles = await getSessionRoles();
  if (roles.some((r) => allowed.includes(r))) return email;
  throw new Error("You don't have permission for this action.");
}

/**
 * Who is reading, for actions that return different data per role.
 *   all:   checks switched off, or a developer — no filtering.
 *   roles: the caller's roles; liverName: her "name" in the Roles tab
 *          (upper-cased, as the masterlist's Liver column is compared).
 * Throws when the Roles tab can't be read, so a hiccup never shows a liver
 * everyone's data or an admin an empty list.
 */
export async function getSessionAccess(): Promise<{ all: boolean; email: string; roles: string[]; liverName: string }> {
  if (!authzEnabled()) return { all: true, email: "", roles: [], liverName: "" };
  const email = await getSessionEmail();
  if (!email) throw new Error("You must be signed in to do this.");
  if (isDeveloper(email)) return { all: true, email, roles: ["super_admin", "admin"], liverName: "" };
  const rows = await loadRolesData();
  if (!rows) throw new Error("Couldn't load your account. Tap Refresh to try again.");
  const me = email.toLowerCase().trim();
  const mine = rows.find((r) => r.email.toLowerCase().trim() === me);
  // Same fallback as the app's lockedLiverName (the usually empty static map).
  const fromMap = Object.entries(EMAIL_TO_LIVER_NAME).find(([k]) => k.toLowerCase() === me)?.[1];
  return {
    all: false,
    email,
    roles: getUserRole(email, rows),
    liverName: String(mine?.name || fromMap || "").toUpperCase().trim(),
  };
}
