import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
export function getDb() {
    const rawDatabaseUrl = process.env.DATABASE_URL;
    if (!rawDatabaseUrl) {
        return null;
    }
    const databaseUrl = rawDatabaseUrl.trim();
    if (!databaseUrl) {
        return null;
    }
    try {
        new URL(databaseUrl);
    }
    catch (_a) {
        console.warn("DATABASE_URL is not a valid URL. Falling back to memory store.");
        return null;
    }
    const sql = neon(databaseUrl);
    return drizzle({ client: sql });
}
