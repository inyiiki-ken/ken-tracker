"use client";

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useBrand } from '@/components/BrandThemeLoader';
import { brandInitials } from '@/lib/brandSettings';

/**
 * Sign-in screen. Deliberately quiet: one clear action, the customer's own
 * branding, and nothing competing for attention.
 *
 * (The previous version offered "Sign in with Email Link" as a second button —
 * but it called the exact same Google redirect, so it promised something the
 * app doesn't do. Removed rather than left misleading.)
 */
export default function WelcomeScreen() {
  const { loginWithRedirect } = useAuth();
  const { settings, headerLogo } = useBrand();
  const [busy, setBusy] = useState(false);

  const handleLogin = () => {
    setBusy(true);
    try {
      loginWithRedirect({ redirectUrl: window.location.href });
    } catch {
      setBusy(false);
      toast.error('Could not start sign-in. Please reopen the app and try again.');
    }
  };

  const initials = brandInitials(settings.companyName);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background relative overflow-hidden">
      {/* Soft brand wash — depth without the heavy gradient bars */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background:
            'radial-gradient(60rem 40rem at 50% -10%, hsl(var(--primary)) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Brand mark */}
        <div className="flex flex-col items-center mb-8">
          {headerLogo ? (
            <img
              src={headerLogo}
              alt={settings.companyName}
              className="w-20 h-20 rounded-2xl object-contain bg-primary shadow-lg"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-primary grid place-items-center shadow-lg">
              <span className="font-cinzel text-2xl text-primary-foreground font-bold tracking-wide">
                {initials}
              </span>
            </div>
          )}

          <h1 className="font-cinzel text-xl sm:text-2xl text-foreground text-center mt-5 leading-tight">
            {settings.companyName}
          </h1>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground mt-1.5 text-center">
            {settings.tagline}
          </p>
        </div>

        {/* Action card */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="font-cinzel text-base text-foreground text-center">Sign in</h2>
          <p className="text-xs text-muted-foreground text-center mt-1.5 leading-relaxed">
            Use your work Google account.
          </p>

          <Button
            onClick={handleLogin}
            disabled={busy}
            className="w-full mt-5 h-11 text-sm font-medium"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Opening Google…
              </>
            ) : (
              <>
                <GoogleMark />
                Continue with Google
              </>
            )}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground mt-4">
            <ShieldCheck className="h-3.5 w-3.5" />
            Authorised team members only
          </p>
        </div>

        <p className="text-[10px] text-center text-muted-foreground mt-6">
          © {new Date().getFullYear()} {settings.companyName} {settings.legalSuffix}
          {settings.location ? ` · ${settings.location}` : ''}
        </p>
      </div>
    </div>
  );
}

/** Google "G" — keeps the button recognisable without an extra image request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 mr-2 shrink-0" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}
