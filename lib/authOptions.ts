import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

/**
 * NextAuth configuration, kept in its own module so it can be imported both
 * by the route handler and anywhere else (e.g. getServerSession) without
 * tripping Next 14's App Router rule that a `route.ts` file may only export
 * HTTP handlers (GET/POST/...). Exporting `authOptions` directly from the
 * route file fails `next build` with a type error.
 *
 * Real Google sign-in: any Google account can authenticate here -- access
 * control (who sees which tabs, or is locked out) is enforced separately by
 * config/roles.ts + AccessDenied.tsx inside the app.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async session({ session }) {
      return session;
    },
  },
  pages: {
    // No custom sign-in page -- WelcomeScreen.tsx renders our own
    // "Sign in with Google" button and calls signIn() directly.
  },
};
