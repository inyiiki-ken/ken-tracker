"use server";

import { cookies } from "next/headers";
import {
  getMyContextCore,
  getSessionEmail,
  isDeveloper,
  upsertTenantCore,
  DEV_TENANT_COOKIE,
} from "./google-sheets/tenancy-core";
import type { MyContext, Tenant } from "./tenancy-types";
import { verifyConnectionAndHeaders } from "./google-sheets/actions";

/**
 * Server actions the God Mode UI calls. Every mutation re-checks that the
 * caller is a developer using the trusted session email -- never client input.
 * (Types live in lib/tenancy-types.ts; a "use server" module may only export
 * async functions.)
 */

async function assertDeveloper(): Promise<string> {
  const email = await getSessionEmail();
  if (!isDeveloper(email)) throw new Error("Developer access required.");
  return email as string;
}

/** Who am I, which workspace is active, and (for developers) all tenants. */
export async function getMyContext(): Promise<MyContext> {
  return getMyContextCore();
}

/** Developer-only: switch the active workspace by tenant id. */
export async function switchTenant(params: { tenantId: string }): Promise<{ success: boolean }> {
  await assertDeveloper();
  cookies().set(DEV_TENANT_COOKIE, params.tenantId.trim(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return { success: true };
}

/** Developer-only: clear the workspace override (back to default resolution). */
export async function clearTenantOverride(): Promise<{ success: boolean }> {
  await assertDeveloper();
  cookies().delete(DEV_TENANT_COOKIE);
  return { success: true };
}

/** Developer-only: create or update a customer. Validates the sheet first. */
export async function saveTenant(input: {
  tenantId?: string;
  displayName: string;
  allowedEmails: string;
  emailDomain?: string;
  sheetIdOrUrl: string;
  active?: boolean;
  plan?: string;
  notes?: string;
}): Promise<{ success: boolean; tenant: Tenant; warning?: string }> {
  await assertDeveloper();

  // Validate we can reach the sheet and its headers look right before saving.
  const check = await verifyConnectionAndHeaders({ sheetIdOrUrl: input.sheetIdOrUrl });
  if (check.error) {
    throw new Error(`Cannot reach that sheet: ${check.error}. Share it (Editor) with the service account.`);
  }
  const warning = check.ok
    ? undefined
    : "Saved, but some headers don't match the expected layout — run the connection check for details.";

  const tenant = await upsertTenantCore(input);
  return { success: true, tenant, warning };
}
