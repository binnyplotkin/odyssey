import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, usersTable, authSessionsTable } from "@odyssey/db";
import { hashPassword } from "@odyssey/auth/password";

type ResetPayload = {
  email?: string;
  newPassword?: string;
  token?: string;
};

function isProductionEnv() {
  return (process.env.NODE_ENV ?? "").toLowerCase() === "production";
}

function readResetToken() {
  return (process.env.DEV_PASSWORD_RESET_TOKEN ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    if (isProductionEnv()) {
      return NextResponse.json(
        { error: "This endpoint is disabled in production." },
        { status: 403 },
      );
    }

    const configuredToken = readResetToken();
    if (!configuredToken) {
      return NextResponse.json(
        {
          error:
            "DEV_PASSWORD_RESET_TOKEN is not configured. Set it locally before using this endpoint.",
        },
        { status: 503 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as ResetPayload;
    const email = body.email?.trim().toLowerCase();
    const newPassword = body.newPassword ?? "";
    const token = body.token?.trim() ?? "";

    if (token !== configuredToken) {
      return NextResponse.json({ error: "Invalid reset token." }, { status: 401 });
    }

    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "newPassword must be at least 8 characters." },
        { status: 400 },
      );
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json({ error: "Database unavailable." }, { status: 500 });
    }

    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email}`)
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const passwordHash = await hashPassword(newPassword);

    await db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    // Invalidate existing sessions so the new password is definitive.
    try {
      await db.delete(authSessionsTable).where(eq(authSessionsTable.userId, user.id));
    } catch (sessionCleanupErr) {
      console.warn("reset-password: unable to delete existing sessions", sessionCleanupErr);
    }

    return NextResponse.json({ success: true, email: user.email });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error while resetting password.";
    console.error("reset-password failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
