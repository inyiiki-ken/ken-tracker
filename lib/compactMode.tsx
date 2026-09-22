"use client";

import { createContext, useContext, useState, useEffect } from 'react';

const STORAGE_KEY = 'ar_compact_mode';

interface CompactModeContextType {
  isCompact: boolean;
  toggle: () => void;
}

const CompactModeContext = createContext<CompactModeContextType>({
  isCompact: false,
  toggle: () => {},
});

export function useCompactMode() {
  return useContext(CompactModeContext);
}

export function CompactModeProvider({ children }: { children: React.ReactNode }) {
  const [isCompact, setIsCompact] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isCompact));
    } catch { /* ignore */ }
  }, [isCompact]);

  return (
    <CompactModeContext.Provider value={{ isCompact, toggle: () => setIsCompact(v => !v) }}>
      {children}
    </CompactModeContext.Provider>
  );
}
