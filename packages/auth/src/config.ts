import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import "./types";

/**
 * Edge-compatible auth config — no adapter, no Credentials provider,
 * no bcryptjs/drizzle imports. Safe for middleware.
 */
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  providers: [Google],
  callbacks: {
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
};
