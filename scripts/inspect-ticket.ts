#!/usr/bin/env npx tsx
/**
 * inspect-ticket.ts <ticket-id> [<ticket-id> ...]
 *
 * Print title / description / status / domain / feature for one or more
 * tickets by id. Handy for diagnosing sync-backlog matches.
 *
 * Usage:  npx tsx scripts/inspect-ticket.ts ca908a50-0d69-...
 */

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// Load .env if DATABASE_URL isn't already set
if (!process.env.DATABASE_URL) {
  try {
    const env = readFileSync(".env", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env; rely on shell env */
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL required (set in env or .env).");
  process.exit(1);
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("Usage: npx tsx scripts/inspect-ticket.ts <id> [<id> ...]");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  for (const id of ids) {
    const rows = (await sql`
      SELECT t.id, t.title, t.description, t.status, t.domain, t.priority,
             t.feature_id, f.title AS feature_title,
             jsonb_array_length(COALESCE(t.activity, '[]'::jsonb)) AS activity_count
      FROM tickets t
      LEFT JOIN features f ON f.id = t.feature_id
      WHERE t.id = ${id}
    `) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      console.log(`\n[${id}] NOT FOUND\n`);
      continue;
    }
    const r = rows[0];
    console.log(`\n[${r.id}]`);
    console.log(`  title:       ${r.title}`);
    console.log(`  description: ${r.description ?? "(none)"}`);
    console.log(`  status:      ${r.status}`);
    console.log(`  domain:      ${r.domain ?? "(none)"}`);
    console.log(`  priority:    ${r.priority ?? "(none)"}`);
    console.log(`  feature:     ${r.feature_title ?? "(none)"} (${r.feature_id ?? "no feature"})`);
    console.log(`  activity:    ${r.activity_count} entries`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
