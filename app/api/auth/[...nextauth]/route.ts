import NextAuth from "next-auth";
import { authOptions } from "@/lib/authOptions";

/**
 * Route handler only. The NextAuth configuration lives in lib/authOptions.ts
 * because Next 14's App Router forbids non-handler exports from a route file
 * (exporting `authOptions` here fails `next build`).
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
