/**
 * Set password for an existing user (e.g. one created via OAuth).
 *
 * Usage:
 *   npx tsx scripts/set-password.ts user@email.com newpassword
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { usersTable } from "@odyssey/db";
import { hashPassword } from "@odyssey/auth";

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/set-password.ts <email> <password>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const db = drizzle({ client: neon(url) });

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, user.id));

  console.log(`Password set for ${user.name ?? user.email}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
