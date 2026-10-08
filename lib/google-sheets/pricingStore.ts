import "server-only";
import { createHash } from "crypto";
import { readConfig, readConfigStrict, writeConfig } from "./config-store";
import { getMyContextCore } from "./tenancy-core";
import { upgradeCrownDeliveryRules } from "@/lib/crownDeliveryRules";
import { shipRulesFor, type ShipRules } from "@/lib/calculations";

export const PRICING_MARKER = "__PRICING_CONFIG__";

/** Fingerprint of the stored pricing, so a save can tell it was made from the current copy. */
export function pricingVersion(stored: string): string {
  return createHash("sha256").update(stored).digest("hex").slice(0, 16);
}

/**
 * The active tenant's stored pricing (throws ConfigReadError when the sheet
 * couldn't be read). Crown's one-time rules upgrade is applied and saved to
 * Crown's own sheet here, only after a successful read.
 */
export async function loadStoredPricing(opts: { persistUpgrade: boolean }): Promise<{ stored: string; config: string }> {
  const stored = await readConfigStrict(PRICING_MARKER);
  let tenant = null;
  try { tenant = (await getMyContextCore()).activeTenant; } catch { /* no upgrade without a known tenant */ }
  const upgraded = upgradeCrownDeliveryRules(stored, tenant);
  if (!upgraded) return { stored, config: stored };
  if (opts.persistUpgrade) {
    try {
      await writeConfig(PRICING_MARKER, upgraded);
      return { stored: upgraded, config: upgraded };
    } catch (err) {
      console.error("Crown pricing upgrade not saved:", err);
    }
  }
  return { stored, config: upgraded };
}

/**
 * Save pricing, refused unless the sheet can be read now and still holds the
 * copy the editor loaded (baseVersion): a screen that never loaded, or a stale
 * one, can't overwrite real settings (e.g. MC) with defaults. Returns the new version.
 */
export async function savePricingChecked(config: string, baseVersion: unknown): Promise<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(config); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pricing is not valid; nothing was saved.");
  const current = await readConfigStrict(PRICING_MARKER);
  if (typeof baseVersion !== "string" || baseVersion !== pricingVersion(current)) {
    throw new Error("Pricing was changed somewhere else or didn't load. Reload Settings and try again; nothing was saved.");
  }
  await writeConfig(PRICING_MARKER, config);
  return pricingVersion(config);
}

/** This tenant's shipping rules for server-side money (old rules if pricing can't be read). */
export async function serverShipRules(): Promise<ShipRules> {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse((await loadStoredPricing({ persistUpgrade: false })).config || "{}"); }
  catch (err) { console.error("Pricing unreadable for shipping rules; using one fee per customer:", err); }
  let hours = 4;
  try {
    const business = JSON.parse((await readConfig("__BUSINESS_CONFIG__")) || "{}");
    if (typeof business.timezoneOffsetHours === "number") hours = business.timezoneOffsetHours;
  } catch { /* default business clock */ }
  return shipRulesFor(cfg as Parameters<typeof shipRulesFor>[0], hours * 60 * 60 * 1000);
}
