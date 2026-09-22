"use client";

/**
 * Real Google sign-in via NextAuth.js, replacing the temporary dev stub.
 * Keeps the EXACT same useAuth() shape (user.email, user.firstName,
 * isLoading, logout, loginWithRedirect) that WelcomeScreen.tsx,
 * AccessDenied.tsx, DailyRatesEditor.tsx, and app/page.tsx already call --
 * so this swap required zero changes to any of those ported files.
 */

import { useMemo } from "react";
import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";

export interface AuthUser {
  email: string;
  firstName?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  logout: (opts?: { returnTo?: string }) => void;
  loginWithRedirect: (opts?: { redirectUrl?: string }) => void;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

export function useAuth(): AuthContextValue {
  const { data: session, status } = useSession();

  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;

  // IMPORTANT: without this useMemo, a new `user` object was created on
  // every render. app/page.tsx's fetchData useEffect depends on `user` by
  // reference, so a changing reference every render re-triggered fetchData
  // forever -- which is exactly what hammered the Google Sheets API into
  // its rate limit. Keying on the primitive email/name values means the
  // object reference only changes when the actual data changes.
  const user: AuthUser | null = useMemo(() => {
    if (!email) return null;
    return { email, firstName: name?.split(" ")[0] };
  }, [email, name]);

  return {
    user,
    isLoading: status === "loading",
    logout: (opts) => signOut({ callbackUrl: opts?.returnTo ?? "/" }),
    loginWithRedirect: (opts) => signIn("google", { callbackUrl: opts?.redirectUrl ?? "/" }),
  };
}
