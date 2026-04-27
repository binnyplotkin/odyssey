"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, usersTable, authSessionsTable } from "@odyssey/db";
import { hashPassword } from "@odyssey/auth/password";
import { auth } from "@/lib/auth";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;

async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in." };
  if (session.user.role !== "admin") return { ok: false, error: "Admin only." };
  return { ok: true, userId: session.user.id };
}

/* ── Update profile (name, email, role) ─────────────────────── */

export type UpdateUserProfileInput = {
  userId: string;
  name: string;
  email: string;
  role: "admin" | "user";
};

export async function updateUserProfile(
  input: UpdateUserProfileInput,
): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  if (input.role !== "admin" && input.role !== "user") {
    return { ok: false, error: "Invalid role." };
  }
  if (input.userId === guard.userId && input.role !== "admin") {
    return { ok: false, error: "You can't demote your own admin account." };
  }

  const db = getDb();
  if (!db) return { ok: false, error: "Database unavailable." };

  const existing = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, input.userId))
    .limit(1);

  if (existing.length === 0) return { ok: false, error: "User not found." };
  const before = existing[0];

  if (email !== before.email) {
    const collision = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    if (collision.length > 0 && collision[0].id !== input.userId) {
      return { ok: false, error: "Another user already uses that email." };
    }
  }

  const emailChanged = email !== before.email;

  await db
    .update(usersTable)
    .set({
      name: name || null,
      email,
      role: input.role,
      ...(emailChanged ? { emailVerified: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, input.userId));

  if (emailChanged) {
    await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, input.userId));
  }

  revalidatePath("/users");
  return { ok: true };
}

/* ── Set password directly (admin override) ─────────────────── */

export type SetUserPasswordInput = {
  userId: string;
  newPassword: string;
  signOutEverywhere: boolean;
};

export async function setUserPassword(
  input: SetUserPasswordInput,
): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const db = getDb();
  if (!db) return { ok: false, error: "Database unavailable." };

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, input.userId))
    .limit(1);
  if (existing.length === 0) return { ok: false, error: "User not found." };

  const passwordHash = await hashPassword(input.newPassword);

  await db
    .update(usersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(usersTable.id, input.userId));

  if (input.signOutEverywhere) {
    await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, input.userId));
  }

  revalidatePath("/users");
  return { ok: true };
}

/* ── Change role (single-action shortcut) ───────────────────── */

export async function changeUserRole(
  userId: string,
  role: "admin" | "user",
): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  if (role !== "admin" && role !== "user") {
    return { ok: false, error: "Invalid role." };
  }
  if (userId === guard.userId && role !== "admin") {
    return { ok: false, error: "You can't demote your own admin account." };
  }

  const db = getDb();
  if (!db) return { ok: false, error: "Database unavailable." };

  await db
    .update(usersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  revalidatePath("/users");
  return { ok: true };
}

/* ── Sign out all sessions ──────────────────────────────────── */

export async function signOutAllSessions(userId: string): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const db = getDb();
  if (!db) return { ok: false, error: "Database unavailable." };

  await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, userId));

  revalidatePath("/users");
  return { ok: true };
}

/* ── Delete user ────────────────────────────────────────────── */

export async function deleteUser(userId: string): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  if (userId === guard.userId) {
    return { ok: false, error: "You can't delete your own account." };
  }

  const db = getDb();
  if (!db) return { ok: false, error: "Database unavailable." };

  await db.delete(usersTable).where(eq(usersTable.id, userId));

  revalidatePath("/users");
  return { ok: true };
}
