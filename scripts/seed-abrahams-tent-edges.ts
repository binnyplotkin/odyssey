/**
 * Seed knows-edges between Abraham's Tent cast members.
 *
 * Runs after scripts/seed-abrahams-tent-cast.ts. Looks up each character's
 * world_node by slug → characterStore → graph.listNodes(worldId), then creates
 * directional knows edges with attitude + context.
 *
 * Each pair produces two edges (one in each direction) so inspector queries
 * on either node surface the relationship.
 *
 * Usage:
 *   npx tsx scripts/seed-abrahams-tent-edges.ts          # dry run
 *   npx tsx scripts/seed-abrahams-tent-edges.ts --apply  # perform writes
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import {
  getCharacterStore,
  getWorldGraphStore,
} from "@odyssey/db";

const APPLY = process.argv.includes("--apply");
const WORLD_ID = "abrahams-tent-base";

type Attitude = "loving" | "loyal" | "wary" | "resentful" | "protective" | "grieving";

type EdgeSpec = {
  from: string; // character slug
  to: string;
  attitude: Attitude;
  context: string;
};

/**
 * Directional knows-edges. We hand-write both directions so each side can
 * carry its own attitude (Abraham → Hagar is different from Hagar → Abraham).
 */
const EDGES: EdgeSpec[] = [
  // Abraham ↔ Sarah — husband/wife, covenant partners
  { from: "abraham", to: "sarah",  attitude: "loving",     context: "Wife, half-sister, covenant partner. Laughed at the promise; bore Isaac." },
  { from: "sarah",   to: "abraham", attitude: "loyal",     context: "Husband of sixty-plus years. Followed him from Ur. Held him to the promise." },

  // Abraham ↔ Lot — uncle/nephew, same journey different choices
  { from: "abraham", to: "lot",    attitude: "protective", context: "Nephew. Traveled together from Ur; parted at the Jordan. Rescued from the kings' war." },
  { from: "lot",     to: "abraham", attitude: "loyal",     context: "Uncle. Left Ur together. His blessing still shadows Lot's choices." },

  // Abraham ↔ Hagar — master/servant, complicated by Ishmael
  { from: "abraham", to: "hagar",  attitude: "grieving",   context: "Egyptian maidservant; mother of Ishmael. Sent away twice under duress." },
  { from: "hagar",   to: "abraham", attitude: "wary",      context: "Master and father of her son. The hand that gave her Ishmael and then the wilderness." },

  // Sarah ↔ Hagar — mistress/handmaid, rivalry over the promise
  { from: "sarah",   to: "hagar",  attitude: "resentful",  context: "Her Egyptian handmaid. Gave her to Abraham; demanded her expulsion when Isaac was born." },
  { from: "hagar",   to: "sarah",  attitude: "wary",       context: "Her mistress. Raised her up as surrogate; cast her out twice." },
];

type NodeIndex = Map<string, string>; // slug → nodeId

async function buildNodeIndex(): Promise<NodeIndex> {
  const characterStore = getCharacterStore();
  const graph = getWorldGraphStore();
  const nodes = await graph.listNodes(WORLD_ID);

  const index: NodeIndex = new Map();
  const slugs = new Set(EDGES.flatMap((e) => [e.from, e.to]));

  for (const slug of slugs) {
    const c = await characterStore.getBySlug(slug);
    if (!c) {
      console.log(`  ! no global character for slug "${slug}" — skipping`);
      continue;
    }
    const node = nodes.find((n) => n.kind === "character" && n.refId === c.id);
    if (!node) {
      console.log(`  ! ${slug} (id=${c.id}) has no node in ${WORLD_ID} — run seed-abrahams-tent-cast first`);
      continue;
    }
    index.set(slug, node.id);
  }
  return index;
}

async function main() {
  console.log(`\nSeed Abraham's Tent knows-edges · mode=${APPLY ? "APPLY" : "dry-run"} · world=${WORLD_ID}\n`);

  const index = await buildNodeIndex();
  const graph = getWorldGraphStore();

  let created = 0;
  let skipped = 0;

  for (const spec of EDGES) {
    const fromNodeId = index.get(spec.from);
    const toNodeId = index.get(spec.to);
    if (!fromNodeId || !toNodeId) {
      console.log(`  · skip ${spec.from} → ${spec.to} (missing node)`);
      skipped++;
      continue;
    }

    if (!APPLY) {
      console.log(`  · would create knows(${spec.from} → ${spec.to}) attitude=${spec.attitude}`);
      created++;
      continue;
    }

    try {
      const edge = await graph.createEdge({
        worldId: WORLD_ID,
        fromNodeId,
        toNodeId,
        kind: "knows",
        data: { attitude: spec.attitude, context: spec.context },
      });
      console.log(`  · knows(${spec.from} → ${spec.to}) [${edge.id}]`);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${spec.from} → ${spec.to}: ${msg}`);
    }
  }

  console.log(`\nDone. ${created} edges ${APPLY ? "written" : "planned"}, ${skipped} skipped.`);
  if (!APPLY) console.log("Dry run — re-run with --apply to perform writes.");
}

main().catch((err) => {
  console.error("\nError:", err);
  process.exit(1);
});
