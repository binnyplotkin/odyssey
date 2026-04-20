/**
 * Seed the three formerly-static worlds into the DB. Mirrors prior code state:
 *   abrahams-tent-base → status=draft   (the one visible in /worlds)
 *   abrahams-tent      → status=archived (was hidden via ARCHIVED_WORLD_IDS)
 *   the-king (kingdom) → status=archived (was hidden via ARCHIVED_WORLD_IDS)
 *
 * Idempotent: skips rows that already exist.
 *
 * Usage:
 *   npx tsx scripts/seed-static-worlds.ts             # dry-run
 *   npx tsx scripts/seed-static-worlds.ts --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getDb, worldsTable } from "@odyssey/db";
import { eq } from "drizzle-orm";
import { abrahamsTentWorld } from "../packages/engine/src/__tests__/fixtures/abrahams-tent";
import { abrahamsTentBaseWorld } from "../packages/engine/src/__tests__/fixtures/abrahams-tent-base";
import { kingdomWorld } from "../packages/engine/src/__tests__/fixtures/kingdom";
import type { WorldDefinition } from "@odyssey/types";

const APPLY = process.argv.includes("--apply");

type Seed = {
  definition: WorldDefinition;
  status: "draft" | "archived" | "published";
  prompt: string;
};

const SEEDS: Seed[] = [
  {
    definition: abrahamsTentBaseWorld,
    status: "draft",
    prompt: "Abraham's Tent — base shell. Starting point for building the world in the /worlds editor.",
  },
  {
    definition: abrahamsTentWorld,
    status: "archived",
    prompt: "Abraham's Tent — original demo world. Archived.",
  },
  {
    definition: kingdomWorld,
    status: "archived",
    prompt: "The Young King — kingdom simulation. Archived.",
  },
];

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? "APPLY" : "dry-run"}\n`);

  let inserted = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    const { definition, status, prompt } = seed;
    const existing = await db
      .select({ id: worldsTable.id, status: worldsTable.status })
      .from(worldsTable)
      .where(eq(worldsTable.id, definition.id))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  = ${definition.id} already exists (status=${existing[0].status}) — skip`);
      skipped++;
      continue;
    }

    if (!APPLY) {
      console.log(`  + would insert ${definition.id} (status=${status}, title="${definition.title}")`);
      inserted++;
      continue;
    }

    const now = new Date();
    await db.insert(worldsTable).values({
      id: definition.id,
      title: definition.title,
      prompt,
      status,
      definition,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  + inserted ${definition.id} (status=${status})`);
    inserted++;
  }

  console.log(`\nSummary: ${inserted} ${APPLY ? "inserted" : "would insert"}, ${skipped} skipped`);
  if (!APPLY) console.log("Dry run. Re-run with --apply to seed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
