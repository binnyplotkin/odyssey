import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, usersTable } from "@odyssey/db";
import { auth } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: "Database unavailable. Check DATABASE_URL in your local environment." },
        { status: 500 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (name.length > 80) {
      return NextResponse.json({ error: "Name is too long" }, { status: 400 });
    }

    const updated = await db
      .update(usersTable)
      .set({
        name,
        updatedAt: new Date(),
      })
      // Cast DB id to text for compatibility when production uses UUID while local schema is text.
      .where(sql`${usersTable.id}::text = ${session.user.id}`)
      .returning({ id: usersTable.id });

    if (!updated.length) {
      return NextResponse.json(
        { error: "Profile row not found for current user." },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, name });
  } catch (error) {
    const message = formatErrorMessage(error);
    console.error("Failed to update profile", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Failed to update profile";
  }

  const candidates = [
    error.message,
    readProp(error, "cause.message"),
    readProp(error, "cause.cause.message"),
    readProp(error, "cause.detail"),
    readProp(error, "cause.code"),
    readProp(error, "detail"),
    readProp(error, "code"),
  ].filter((v): v is string => Boolean(v && v.trim()));

  return candidates[0] ?? "Failed to update profile";
}

function readProp(source: unknown, path: string): string | undefined {
  const keys = path.split(".");
  let cur: unknown = source;
  for (const key of keys) {
    if (typeof cur !== "object" || cur === null || !(key in cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : undefined;
}
