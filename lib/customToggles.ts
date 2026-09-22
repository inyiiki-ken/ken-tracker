"use client";

/**
 * DEVELOPER-DEFINED TOGGLES.
 *
 * The built-in toggles (Free SF, Promo SF, Add Charge, Discount) are wired to
 * pricing logic and stay as they are. This lets the developer add their OWN
 * simple on/off toggles per customer — e.g. "EID Provided", "Gift Wrap",
 * "Fragile", "Priority" — without any code change.
 *
 * Each toggle writes a value into a chosen column of that item's row:
 *   ON  -> onValue   (default "TRUE")
 *   OFF -> offValue  (default "")
 * so the flag is visible in the customer's own Google Sheet too.
 */

import type { DatabaseRowType } from "@/types";

export interface CustomToggle {
  /** Stable id (generated when created). */
  id: string;
  /** What staff see next to the switch. */
  label: string;
  /** Record field the flag is stored in. */
  field: string;
  /** Value written when switched on / off. */
  onValue: string;
  offValue: string;
  /** Accent colour for the label. */
  color: "primary" | "green" | "orange" | "sky" | "purple" | "destructive";
}

/** Fields that are safe to use as a flag column (free-text, not used by pricing). */
export const TOGGLE_FIELD_CHOICES: { value: string; label: string }[] = [
  { value: "reviewChasing", label: "Review Chasing" },
  { value: "remittanceStatus", label: "Remittance Status" },
  { value: "fbProfileName", label: "FB Profile Name" },
  { value: "tog", label: "T.O.G" },
  { value: "source", label: "Source" },
  { value: "modeOfSale", label: "Mode of Sale" },
  { value: "liverAdminRemarks", label: "Liver/Admin Remarks" },
];

export const TOGGLE_COLORS: CustomToggle["color"][] = [
  "primary", "green", "orange", "sky", "purple", "destructive",
];

/**
 * Tailwind text colour per accent.
 *
 * These were fixed Tailwind shades despite the "theme-adaptive" claim — green-600
 * in particular is dark enough to disappear against the dark surface. They now
 * map to the semantic tokens, which swap lightness with the customer's theme.
 */
export function toggleColorClass(color: CustomToggle["color"]): string {
  switch (color) {
    case "green": return "text-success";
    case "orange": return "text-warning";
    case "sky": return "text-info";
    case "purple": return "text-hold";
    case "destructive": return "text-destructive";
    default: return "text-primary";
  }
}

const STORAGE_KEY = "custom_toggles";

let _toggles: CustomToggle[] = loadFromCache();

function normalize(p: unknown): CustomToggle[] {
  if (!Array.isArray(p)) return [];
  const out: CustomToggle[] = [];
  for (const raw of p) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const label = String(t.label ?? "").trim();
    const field = String(t.field ?? "").trim();
    if (!label || !field) continue;
    out.push({
      id: String(t.id ?? `tg_${Math.random().toString(36).slice(2, 9)}`),
      label,
      field,
      onValue: t.onValue === undefined ? "TRUE" : String(t.onValue),
      offValue: t.offValue === undefined ? "" : String(t.offValue),
      color: (TOGGLE_COLORS as string[]).includes(String(t.color)) ? (t.color as CustomToggle["color"]) : "primary",
    });
  }
  return out;
}

function loadFromCache(): CustomToggle[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* ignore */ }
  return [];
}

export function getCustomToggles(): CustomToggle[] {
  return _toggles;
}

export function setCustomToggles(list: CustomToggle[]): void {
  _toggles = normalize(list);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(_toggles));
  } catch { /* ignore */ }
}

export function applyCustomToggles(json: string): void {
  if (!json) return;
  try { setCustomToggles(normalize(JSON.parse(json))); } catch { /* ignore */ }
}

export function serializeCustomToggles(): string {
  return JSON.stringify(_toggles);
}

export function newCustomToggle(): CustomToggle {
  return {
    id: `tg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    label: "",
    field: "reviewChasing",
    onValue: "TRUE",
    offValue: "",
    color: "primary",
  };
}

/** Is this toggle currently on for the given record? */
export function isToggleOn(record: DatabaseRowType, t: CustomToggle): boolean {
  const v = String((record as Record<string, unknown>)[t.field] ?? "").trim();
  return v.toLowerCase() === t.onValue.trim().toLowerCase() && v !== "";
}

/** The field update to apply when flipping a toggle. */
export function toggleUpdate(t: CustomToggle, on: boolean): Partial<DatabaseRowType> {
  return { [t.field]: on ? t.onValue : t.offValue } as Partial<DatabaseRowType>;
}
