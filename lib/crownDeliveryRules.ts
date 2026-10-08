import type { PricingConfig } from './pricingConfig';

/** Crown's confirmed delivery and Tabby rules (ken, Oct 2026). */
export const CROWN_RULES_VERSION = 2;
/** Items bought before this day keep the old prices and one fee per customer. */
export const CROWN_NEW_RULES_FROM = '2026-10-10';

type Tenant = { tenantId?: string; displayName?: string } | null | undefined;

/**
 * Whether the active tenant is Crown. Only used for the one-time upgrade: the
 * upgraded settings are then SAVED in Crown's own sheet, so renaming the
 * tenant later changes nothing, and no other tenant's sheet is touched.
 */
export function isCrownTenant(tenant: Tenant): boolean {
  const id = String(tenant?.tenantId ?? '').trim().toLowerCase();
  const name = String(tenant?.displayName ?? '').trim().toLowerCase();
  return id === 'crown' || /^crown-[a-z0-9]{4}$/.test(id) || name === 'crown';
}

/**
 * One-time upgrade of Crown's saved pricing (a successfully read value only:
 * '' = nothing saved yet). Keeps MC and every other setting. Returns null when
 * nothing needs changing, or the stored value is not readable JSON.
 *
 * - Never upgraded: local 30, Western 45, international 450, Tabby 15%, one fee
 *   per parcel, start date 10 Oct 2026, leftover parcels charged.
 * - Upgraded by v0.3.55 (version 1): only adds the start date and leftover
 *   rule, so a Tabby % or per-parcel choice saved since is respected.
 */
export function upgradeCrownDeliveryRules(stored: string, tenant: Tenant): string | null {
  if (!isCrownTenant(tenant)) return null;
  let saved: Partial<PricingConfig>;
  try { saved = stored ? JSON.parse(stored) : {}; } catch { return null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  const version = Number(saved.crownDeliveryRulesVersion) || 0;
  if (version >= CROWN_RULES_VERSION) return null;
  const tenantId = String(tenant?.tenantId ?? '') || undefined;
  if (version === 1) {
    return JSON.stringify({
      ...saved,
      newRulesFrom: saved.newRulesFrom || CROWN_NEW_RULES_FROM,
      leftoverShipping: saved.leftoverShipping === 'free' ? 'free' : 'charge',
      crownDeliveryRulesVersion: CROWN_RULES_VERSION,
      crownTenantId: tenantId,
    });
  }
  const isWestern = (key: string) => /western|dhafra/i.test(key);
  const fees = Object.fromEntries(Object.keys(saved.shippingFees || {}).map(key => [key, isWestern(key) ? 45 : 30]));
  return JSON.stringify({
    ...saved,
    shippingFees: { ...fees, western: 45, 'western region': 45, 'al dhafra': 45 },
    shippingFeeDefault: 30,
    shippingFeeInternational: 450,
    tabbySurchargePct: 15,
    shippingPerShipment: true,
    newRulesFrom: CROWN_NEW_RULES_FROM,
    leftoverShipping: 'charge',
    crownDeliveryRulesVersion: CROWN_RULES_VERSION,
    crownTenantId: tenantId,
  });
}
