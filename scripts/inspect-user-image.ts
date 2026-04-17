import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { usersTable, accountsTable } from "@odyssey/db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = drizzle({ client: neon(url) });

  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      image: usersTable.image,
    })
    .from(usersTable);

  const accounts = await db
    .select({
      userId: accountsTable.userId,
      provider: accountsTable.provider,
    })
    .from(accountsTable);

  const providersByUser = new Map<string, string[]>();
  for (const a of accounts) {
    if (!providersByUser.has(a.userId)) providersByUser.set(a.userId, []);
    providersByUser.get(a.userId)!.push(a.provider);
  }

  for (const u of users) {
    const providers = providersByUser.get(u.id) ?? [];
    console.log(`${u.name ?? "(no name)"} <${u.email}>`);
    console.log(`  providers: ${providers.length ? providers.join(", ") : "(none)"}`);
    console.log(`  image:     ${u.image ?? "(null)"}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
