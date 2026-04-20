/**
 * Smoke test for the World Graph store.
 *
 * Picks any existing world + any two existing characters, runs the full
 * cycle: ingestCharacter → createEdge → getGraph → remove. Idempotent,
 * cleans up after itself.
 *
 * Usage: npx tsx scripts/smoke-test-world-graph.ts
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { getWorldGraphStore } from "../packages/db/src/world-graph-store";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const sql = neon(url);

  const worlds = (await sql.query(
    `SELECT id, title FROM worlds ORDER BY created_at ASC LIMIT 1`,
  )) as Array<{ id: string; title: string }>;
  const characters = (await sql.query(
    `SELECT id, title FROM characters ORDER BY created_at ASC LIMIT 2`,
  )) as Array<{ id: string; title: string }>;

  if (worlds.length === 0 || characters.length < 2) {
    console.log(`skipping smoke test — worlds=${worlds.length}, characters=${characters.length}`);
    return;
  }

  const world = worlds[0];
  const [charA, charB] = characters;
  const store = getWorldGraphStore();

  console.log(`world:      ${world.title} (${world.id})`);
  console.log(`character A: ${charA.title} (${charA.id})`);
  console.log(`character B: ${charB.title} (${charB.id})`);
  console.log();

  // 1. Ingest two characters (idempotent)
  const nodeA = await store.ingestCharacter(world.id, charA.id, { roleInWorld: "host" });
  const nodeB = await store.ingestCharacter(world.id, charB.id);
  console.log(`  ingested:  ${nodeA.label} (${nodeA.id}), ${nodeB.label} (${nodeB.id})`);

  // Re-ingest A — should be idempotent
  const nodeA2 = await store.ingestCharacter(world.id, charA.id);
  if (nodeA2.id !== nodeA.id) throw new Error("ingestCharacter not idempotent");
  console.log(`  re-ingest A: ok (same id ${nodeA2.id})`);

  // 2. Create a place node (native to world)
  const place = await store.createNode({
    worldId: world.id,
    kind: "place",
    label: "Smoke Tent",
    data: { region: "desert" },
  });
  console.log(`  created place: ${place.label} (${place.id})`);

  // 3. Create edges
  const edge1 = await store.createEdge({
    worldId: world.id,
    fromNodeId: nodeA.id,
    toNodeId: nodeB.id,
    kind: "knows",
  });
  const edge2 = await store.createEdge({
    worldId: world.id,
    fromNodeId: nodeA.id,
    toNodeId: place.id,
    kind: "happens_at",
  });
  console.log(`  created edges: ${edge1.id}, ${edge2.id}`);

  // Idempotent edge
  const edge1Again = await store.createEdge({
    worldId: world.id,
    fromNodeId: nodeA.id,
    toNodeId: nodeB.id,
    kind: "knows",
  });
  if (edge1Again.id !== edge1.id) throw new Error("createEdge not idempotent");
  console.log(`  re-create edge1: ok (same id)`);

  // 4. Read full graph
  const graph = await store.getGraph(world.id);
  console.log(`  graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  // 5. Clean up
  await store.removeNode(nodeA.id);
  await store.removeNode(nodeB.id);
  await store.removeNode(place.id);
  const afterRemoval = await store.getGraph(world.id);
  console.log(`  after cleanup: ${afterRemoval.nodes.length} nodes, ${afterRemoval.edges.length} edges`);

  console.log("\n✓ smoke test passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
