"use client";

/**
 * Motion on/off, per user and per device.
 *
 * Deliberately a LOCAL preference, not a per-customer setting: whether
 * animation helps or annoys is personal, and someone doing 200 edits an hour
 * during a live sale should be able to switch it off without affecting anyone
 * else. The OS "reduce motion" setting is always respected on top of this.
 */

const KEY = "motion_pref"; // "on" | "off"

export function getMotionEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setMotionEnabled(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, on ? "on" : "off");
  } catch { /* ignore */ }
  applyMotionToDom(on);
}

/** Sets the flag globals.css keys off. Call once at app start. */
export function applyMotionToDom(on: boolean = getMotionEnabled()): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-motion", on ? "on" : "off");
}
