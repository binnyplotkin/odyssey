/**
 * Promote a user to admin role.
 *
 * Usage:
 *   npx tsx scripts/promote-admin.ts user@email.com
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { usersTable } from "@odyssey/db";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx scripts/promote-admin.ts <email>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const db = drizzle({ client: neon(url) });

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  if (user.role === "admin") {
    console.log(`${user.name ?? user.email} is already an admin.`);
    return;
  }

  await db
    .update(usersTable)
    .set({ role: "admin" })
    .where(eq(usersTable.id, user.id));

  console.log(`Promoted ${user.name ?? user.email} (${user.email}) to admin.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
