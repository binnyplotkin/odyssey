import NextAuth from "next-auth";
import { authConfig } from "@odyssey/auth/config";

const { auth } = NextAuth({
  ...authConfig,
  pages: { signIn: "/login" },
});

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow health, auth routes, and login page through
  if (
    pathname === "/api/healthz" ||
    pathname === "/api/audio/config" ||
    pathname === "/api/audio/speak" ||
    pathname === "/api/audio/transcribe" ||
    pathname === "/api/audio/reply" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/login"
  ) {
    return;
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return;
  }

  const user = req.auth?.user;

  // Redirect unauthenticated users to login
  if (!user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return Response.redirect(loginUrl);
  }

  // Redirect non-admin users to login with error
  if (user.role !== "admin") {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("error", "forbidden");
    return Response.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/((?!api/healthz|_next/static|_next/image|favicon.ico).*)"],
};
