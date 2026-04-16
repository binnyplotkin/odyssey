import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, usersTable } from "@odyssey/db";

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ team: [] });

  try {
    const rows = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    const team = rows.map((r) => ({
      id: r.id,
      name: r.name ?? r.email,
      email: r.email,
      role: r.role,
    }));

    return NextResponse.json({ team });
  } catch {
    return NextResponse.json({ team: [] });
  }
}
