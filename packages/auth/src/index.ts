import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { usersTable, accountsTable, authSessionsTable, verificationTokensTable } from "@odyssey/db";
import { hashPassword, verifyPassword } from "./password";
import { authConfig } from "./config";

/* ── Adapter ────────────────���─────────────────────────��─────── */

function createAdapter() {
  const url = resolveDatabaseUrl();
  if (!url) return undefined;
  const db = drizzle({ client: neon(url) });
  return DrizzleAdapter(db, {
    usersTable,
    accountsTable,
    sessionsTable: authSessionsTable,
    verificationTokensTable,
  });
}

/* ── DB helpers ─────────────────────────────────��───────────── */

function getDb() {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is required for auth");
  return drizzle({ client: neon(url) });
}

function resolveDatabaseUrl() {
  const raw = process.env.DATABASE_URL;

  if (!raw) {
    return null;
  }

  const url = raw.trim();
  if (!url) {
    return null;
  }

  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function getUserByEmail(email: string) {
  const db = getDb();
  const rows = await db.select().from(usersTable).where(eq(usersTable.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}

async function getUserRole(id: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return rows[0]?.role ?? "user";
}

/* ── Registration ────────────────────────────��──────────────── */

export async function registerUser(input: { name: string; email: string; password: string }) {
  const { name, password } = input;
  const email = normalizeEmail(input.email);

  if (!email || !password || password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await hashPassword(password);
  const db = getDb();
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash, role: "user" })
    .returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role });

  return user;
}

/* ── Factory ───────────────��───────────────────────────��────── */

export function createAuth(overrides?: Partial<NextAuthConfig>) {
  return NextAuth({
    ...authConfig,
    adapter: createAdapter(),
    providers: [
      ...authConfig.providers,
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          const email = credentials?.email as string | undefined;
          const password = credentials?.password as string | undefined;
          if (!email || !password) return null;

          const user = await getUserByEmail(email);
          if (!user || !user.passwordHash) return null;

          const valid = await verifyPassword(password, user.passwordHash);
          if (!valid) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
          };
        },
      }),
    ],
    callbacks: {
      async jwt({ token, user, trigger, session }) {
        if (user) {
          token.id = user.id!;
          token.role = (user as any).role ?? await getUserRole(user.id!);
        }
        if (trigger === "update") {
          const updatedName =
            (session as { name?: string | null } | undefined)?.name ??
            (session as { user?: { name?: string | null } } | undefined)?.user?.name;
          if (updatedName && updatedName.trim()) {
            token.name = updatedName.trim();
          }
        }
        return token;
      },
      session({ session, token }) {
        session.user.id = token.id;
        session.user.role = token.role;
        return session;
      },
      ...overrides?.callbacks,
    },
    pages: {
      ...authConfig.pages,
      ...overrides?.pages,
    },
    ...overrides,
  });
}

export { authConfig } from "./config";
export { hashPassword } from "./password";
export type { Session } from "next-auth";
