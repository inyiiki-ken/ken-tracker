/**
 * Framework-neutral tenancy types shared by server actions and client UI.
 * Kept free of any "server-only" imports so client components can use them.
 */

export interface Tenant {
  tenantId: string;
  displayName: string;
  allowedEmails: string; // comma / pipe / space separated
  emailDomain: string;
  sheetId: string;
  active: boolean;
  plan: string;
  notes: string;
}

export interface MyContext {
  email: string | null;
  isDeveloper: boolean;
  multiTenant: boolean;
  activeTenant: { tenantId: string; displayName: string; sheetId: string } | null;
  tenants: Tenant[]; // populated only for developers
  /** If the Control sheet couldn't be read, why (for God Mode diagnostics). */
  controlError?: string;
}
