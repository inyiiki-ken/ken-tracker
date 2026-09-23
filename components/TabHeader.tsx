"use client";

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState, useEffect, ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  rightContent?: ReactNode;
}

export default function TabHeader({ title, subtitle, searchQuery, onSearchChange, rightContent }: Props) {
  const [localQuery, setLocalQuery] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChange(localQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, onSearchChange]);

  useEffect(() => {
    if (searchQuery === '') setLocalQuery('');
  }, [searchQuery]);

  return (
    <div className="kt-pagehead sticky top-0 z-20 backdrop-blur border-b border-border pb-4 pt-0 px-4 bg-background/95">
      <div className="brand-gradient-bar mb-4" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="kt-pagetitle text-xl sm:text-2xl font-cinzel text-primary">{title}</h1>
          {subtitle && (
            <p className="kt-pagesub text-[10px] mt-1 uppercase text-muted-foreground" style={{ letterSpacing: '0.3em' }}>
              {subtitle}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients, items, or IDs..."
              value={localQuery}
              onChange={(e) => setLocalQuery(e.target.value)}
              className="pl-9 pr-9 h-9 text-xs transition-all"
            />
            {localQuery && (
              <button
                onClick={() => { setLocalQuery(''); onSearchChange(''); }}
                className="absolute right-2.5 top-2.5 transition-colors text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {rightContent && <div className="shrink-0">{rightContent}</div>}
        </div>
      </div>
    </div>
  );
}
