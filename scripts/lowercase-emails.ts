/**
 * One-off: lowercase all existing user emails.
 *
 * Usage:
 *   npx tsx scripts/lowercase-emails.ts
 *
 * Safe to re-run — rows already lowercase are skipped. If two rows would
 * collide after lowercasing (e.g. "foo@x.com" and "Foo@x.com"), the script
 * aborts and lists them so a human can decide which to keep.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, sql } from "drizzle-orm";
import { usersTable } from "@odyssey/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = drizzle({ client: neon(url) });

  const rows = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable);

  const toUpdate = rows.filter((r) => r.email !== r.email.toLowerCase());
  if (toUpdate.length === 0) {
    console.log("All emails are already lowercase. Nothing to do.");
    return;
  }

  // Detect collisions: normalized email that would clash with an existing row.
  const existingLower = new Set(rows.map((r) => r.email.toLowerCase()));
  const seen = new Map<string, string>(); // lowered -> original id
  const collisions: Array<{ a: string; b: string; lowered: string }> = [];

  for (const r of rows) {
    const lowered = r.email.toLowerCase();
    if (seen.has(lowered) && seen.get(lowered) !== r.id) {
      collisions.push({ a: seen.get(lowered)!, b: r.id, lowered });
    } else {
      seen.set(lowered, r.id);
    }
    void existingLower;
  }

  if (collisions.length > 0) {
    console.error("Aborting — multiple rows would collide after lowercasing:");
    for (const c of collisions) {
      console.error(`  ${c.lowered}: user ids ${c.a} and ${c.b}`);
    }
    process.exit(1);
  }

  for (const r of toUpdate) {
    const lowered = r.email.toLowerCase();
    await db
      .update(usersTable)
      .set({ email: lowered })
      .where(eq(usersTable.id, r.id));
    console.log(`${r.email} -> ${lowered}`);
  }

  console.log(`\nUpdated ${toUpdate.length} row(s).`);
  void sql;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
