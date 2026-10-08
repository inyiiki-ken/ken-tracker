import type { PricingConfig } from './pricingConfig';

/** One-time tenant-scoped upgrade. Other tenants retain their own pricing.
 * Saving the returned config records the version, so later edits are respected. */
export function upgradeCrownDeliveryRules(config: string, tenantName: string): string {
  if (tenantName.trim().toLowerCase() !== 'crown') return config;
  let saved: Partial<PricingConfig> = {};
  try { saved = config ? JSON.parse(config) : {}; } catch { /* use the confirmed delivery settings */ }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  if (saved.crownDeliveryRulesVersion === 1) return config;
  const fees = Object.fromEntries(Object.keys(saved.shippingFees || {}).map(key => [key, /western/i.test(key) ? 45 : 30]));
  return JSON.stringify({
    ...saved,
    shippingFees: { ...fees, western: 45, 'western region': 45 },
    shippingFeeDefault: 30,
    shippingFeeInternational: 450,
    tabbySurchargePct: 15,
    shippingPerShipment: true,
    crownDeliveryRulesVersion: 1,
  });
}
