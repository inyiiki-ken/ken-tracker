import "server-only";
import { getActiveWorksheet } from "./tenant-context";
import { ROLES_HEADERS } from "./sheet-config";
import { getSessionEmail, isDeveloper, getActiveSheetId } from "./tenancy-core";
import { getUserRole } from "@/config/roles";

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
const rolesCache = new Map<string, { at: number; rows: { email: string; role: string }[] }>();
const ROLES_TTL_MS = 30_000;

async function getRolesData(): Promise<{ email: string; role: string }[]> {
  let sheetId = "";
  try { sheetId = await getActiveSheetId(); } catch { return []; }
  const cached = rolesCache.get(sheetId);
  if (cached && Date.now() - cached.at < ROLES_TTL_MS) return cached.rows;
  try {
    const sheet = await getActiveWorksheet("roles");
    const rows = await sheet.getRows();
    const data = rows.map((r) => ({
      email: String(r.get(ROLES_HEADERS.email) ?? ""),
      role: String(r.get(ROLES_HEADERS.role) ?? ""),
    }));
    rolesCache.set(sheetId, { at: Date.now(), rows: data });
    return data;
  } catch {
    return [];
  }
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

/** Throw unless the signed-in user has at least one of the allowed roles. */
export async function requireRole(allowed: string[]): Promise<void> {
  if (!authzEnabled()) return;
  const email = await getSessionEmail();
  if (!email) throw new Error("You must be signed in to do this.");
  if (isDeveloper(email)) return; // developer/God Mode always allowed
  const roles = await getSessionRoles();
  if (roles.some((r) => allowed.includes(r))) return;
  throw new Error("You don't have permission for this action.");
}
