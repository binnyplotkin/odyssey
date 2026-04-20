/**
 * Bootstrap the World Graph tables (world_nodes + world_edges).
 *
 * A world is a graph. Nodes are typed entities living inside a world
 * (character | place | event to start — extendable). Edges are typed
 * directed relationships between nodes in the same world.
 *
 * Character nodes reference the global `characters` library via `ref_id`;
 * other kinds are native to the world. Kind-specific fields live in the
 * `data` JSONB column and are validated in the app layer with Zod schemas
 * keyed by kind.
 *
 * Usage:
 *   npx tsx scripts/create-world-graph-tables.ts
 *   npx tsx scripts/create-world-graph-tables.ts --backfill
 *
 * Safe to re-run — every statement is CREATE IF NOT EXISTS / CREATE INDEX
 * IF NOT EXISTS. Pass --backfill to also migrate existing world_characters
 * rows into world_nodes (idempotent via the unique index).
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const DDL = [
  /* ── world_nodes ────────────────────────────────────────────────
   * One row per entity inside a world. `kind` is a discriminator
   * validated in the app (character | place | event | …). `ref_id`
   * is populated when the node is backed by a library row (today:
   * characters.id for kind='character'); null otherwise.
   * Kind-specific fields live in `data` JSONB.
   */
  `CREATE TABLE IF NOT EXISTS world_nodes (
    id          text PRIMARY KEY,
    world_id    text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    kind        text NOT NULL,
    ref_id      text,
    label       text NOT NULL,
    summary     text,
    data        jsonb NOT NULL DEFAULT '{}'::jsonb,
    position    jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS world_nodes_world_idx       ON world_nodes (world_id)`,
  `CREATE INDEX IF NOT EXISTS world_nodes_world_kind_idx  ON world_nodes (world_id, kind)`,
  `CREATE INDEX IF NOT EXISTS world_nodes_ref_idx         ON world_nodes (ref_id)`,
  // Prevent the same character from being imported twice into the same world.
  // Partial unique index: only enforced for library-backed kinds (ref_id NOT NULL).
  `CREATE UNIQUE INDEX IF NOT EXISTS world_nodes_world_ref_uniq
     ON world_nodes (world_id, kind, ref_id)
     WHERE ref_id IS NOT NULL`,

  /* ── world_edges ────────────────────────────────────────────────
   * Typed directed relationships between nodes in the same world.
   * `kind` is a free string validated in the app (knows | happens_at |
   * involves | member_of | plays | …). Both endpoints must belong to
   * the same world — enforced by app logic, not DB (cross-table CHECK
   * on FK column isn't possible in vanilla Postgres).
   */
  `CREATE TABLE IF NOT EXISTS world_edges (
    id            text PRIMARY KEY,
    world_id      text NOT NULL REFERENCES worlds(id)       ON DELETE CASCADE,
    from_node_id  text NOT NULL REFERENCES world_nodes(id)  ON DELETE CASCADE,
    to_node_id    text NOT NULL REFERENCES world_nodes(id)  ON DELETE CASCADE,
    kind          text NOT NULL,
    data          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS world_edges_unique_idx
     ON world_edges (from_node_id, to_node_id, kind)`,
  `CREATE INDEX IF NOT EXISTS world_edges_world_idx    ON world_edges (world_id)`,
  `CREATE INDEX IF NOT EXISTS world_edges_to_node_idx  ON world_edges (to_node_id)`,
];

// Backfill: for each row in world_characters, ensure a matching world_nodes row.
// Generates stable-ish ids with gen_random_uuid() so re-running won't duplicate
// (blocked by the partial unique index on (world_id, kind, ref_id)).
const BACKFILL = `
  INSERT INTO world_nodes (id, world_id, kind, ref_id, label, data)
  SELECT
    gen_random_uuid()::text,
    wc.world_id,
    'character',
    wc.character_id,
    c.title,
    CASE
      WHEN wc.role_in_world IS NOT NULL
        THEN jsonb_build_object('role_in_world', wc.role_in_world)
      ELSE '{}'::jsonb
    END
  FROM world_characters wc
  JOIN characters c ON c.id = wc.character_id
  ON CONFLICT (world_id, kind, ref_id) WHERE ref_id IS NOT NULL DO NOTHING
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const shouldBackfill = process.argv.includes("--backfill");
  const sql = neon(url);

  for (const stmt of DDL) {
    const head = stmt.split("\n")[0].trim();
    process.stdout.write(`  ${head.slice(0, 72)}${head.length > 72 ? "…" : ""} … `);
    try {
      await sql.query(stmt);
      console.log("ok");
    } catch (err: any) {
      console.log("FAIL");
      console.error(err.message ?? err);
      process.exit(1);
    }
  }

  if (shouldBackfill) {
    process.stdout.write(`  backfill world_characters → world_nodes … `);
    try {
      await sql.query(BACKFILL);
      console.log("ok");
    } catch (err: any) {
      console.log("FAIL");
      console.error(err.message ?? err);
      process.exit(1);
    }
  }

  console.log(
    `\nDone. ${DDL.length} DDL statements${shouldBackfill ? " + backfill" : ""} executed.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
