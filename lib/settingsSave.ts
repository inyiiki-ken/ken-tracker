"use client";

import { useEffect, useRef } from "react";

/**
 * One "Save all settings" button for the whole Settings page. Each section
 * (Pricing, Dropdown Options, App Settings, Tabs…) registers how to tell if it
 * has unsaved changes and how to save them. Before this, the big floating save
 * button only saved Company Details & Theme, so edits in other sections were
 * lost on refresh unless their own small button was pressed.
 */

export interface SectionSaver {
  label: string;
  isDirty: () => boolean;
  save: () => Promise<void>;
  /** The app must reload for this section's change to apply everywhere. */
  reloads?: boolean;
}

const savers = new Map<string, SectionSaver>();

export function useSectionSaver(id: string, saver: SectionSaver): void {
  const ref = useRef(saver);
  ref.current = saver;
  useEffect(() => {
    savers.set(id, {
      get label() { return ref.current.label; },
      isDirty: () => ref.current.isDirty(),
      save: () => ref.current.save(),
      get reloads() { return ref.current.reloads; },
    });
    return () => { savers.delete(id); };
  }, [id]);
}

export function dirtySections(): string[] {
  return [...savers.values()].filter((s) => s.isDirty()).map((s) => s.label);
}

/** Save every section with unsaved changes. */
export async function saveAllSections(): Promise<{ saved: string[]; failed: { label: string; error: string }[]; needReload: boolean }> {
  const saved: string[] = [];
  const failed: { label: string; error: string }[] = [];
  let needReload = false;
  for (const s of savers.values()) {
    if (!s.isDirty()) continue;
    try {
      await s.save();
      saved.push(s.label);
      if (s.reloads) needReload = true;
    } catch (err) {
      failed.push({ label: s.label, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return { saved, failed, needReload };
}
