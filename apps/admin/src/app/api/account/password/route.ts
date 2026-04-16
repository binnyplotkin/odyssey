import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, usersTable } from "@odyssey/db";
import { hashPassword, verifyPassword } from "@odyssey/auth/password";
import { auth } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  const { currentPassword, newPassword } = await req.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Both current and new password are required" }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
  }

  try {
    const [user] = await db
      .select({ id: usersTable.id, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.id, session.user.id));

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Password authentication not available for this account" }, { status: 400 });
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
    }

    const newHash = await hashPassword(newPassword);
    await db
      .update(usersTable)
      .set({ passwordHash: newHash })
      .where(eq(usersTable.id, session.user.id));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update password" }, { status: 500 });
  }
}
