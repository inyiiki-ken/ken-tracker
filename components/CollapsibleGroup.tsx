"use client";

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  label: string;
  count?: number;
  colorClass?: string;
  lineClass?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  indent?: boolean;
  labelSuffix?: React.ReactNode;
}

export default function CollapsibleGroup({
  label,
  count,
  colorClass = '',
  lineClass = '',
  defaultOpen = true,
  children,
  indent = false,
  labelSuffix,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`mb-3 ${indent ? 'pl-2' : ''}`}>
      <button
        className="flex w-full items-center gap-2 mb-2 text-left focus:outline-none group"
        onClick={() => setOpen(o => !o)}
      >
        <span
          className={`text-[9px] font-cinzel uppercase shrink-0 group-hover:text-primary transition-colors ${colorClass || 'text-primary'}`}
          style={{ letterSpacing: '0.25em' }}
        >
          {label}
        </span>
        {count !== undefined && (
          <span className="text-[10px] font-bold shrink-0 text-muted-foreground">({count})</span>
        )}
        {labelSuffix}
        <div className={`h-px flex-1 ${lineClass || 'bg-border'}`} />
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 text-muted-foreground ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-150">
          {children}
        </div>
      )}
    </div>
  );
}
