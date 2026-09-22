"use client";

import { useBrand } from '@/components/BrandThemeLoader';
import { brandInitials } from '@/lib/brandSettings';

/**
 * Loading state. Previously this showed a pulsing logo AND a set of grey
 * skeleton boxes underneath — two different loading metaphors fighting each
 * other, which read as unfinished. Now it's one calm, centred brand moment.
 */
export default function LoadingSkeleton() {
  const { settings, headerLogo } = useBrand();
  const initials = brandInitials(settings.companyName);

  return (
    <div className="min-h-screen grid place-items-center bg-background relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          background:
            'radial-gradient(50rem 34rem at 50% 0%, hsl(var(--primary)) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center">
        {/* Brand mark with a soft breathing halo */}
        <div className="relative">
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-primary/30 blur-xl animate-pulse"
          />
          {headerLogo ? (
            <img
              src={headerLogo}
              alt=""
              className="relative w-16 h-16 rounded-2xl object-contain bg-primary shadow-lg"
            />
          ) : (
            <div className="relative w-16 h-16 rounded-2xl bg-primary grid place-items-center shadow-lg">
              <span className="font-cinzel text-xl text-primary-foreground font-bold">{initials}</span>
            </div>
          )}
        </div>

        <p className="font-cinzel text-sm text-foreground mt-5">{settings.companyName}</p>

        {/* Indeterminate progress — a real motion cue instead of static dots */}
        <div className="mt-4 h-1 w-40 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-primary loading-sweep" />
        </div>

        <p className="text-[11px] text-muted-foreground mt-3">Loading your workspace…</p>
      </div>
    </div>
  );
}
