/**
 * Backfill characters out of WorldDefinition.characters[] into the unified
 * world graph (characters library + world_nodes/edges).
 *
 * For each world in the DB with a definition:
 *   - upsert each character by slug (= source id) into the global library
 *   - call graph.ingestCharacter with the per-world overlay (archetype,
 *     motivations, emotionalBaseline, speakingStyle, behaviorTriggers,
 *     plus everything else stashed into overrides.*)
 *   - expand npcRelationships into world_edges of kind "knows"
 *
 * Usage:
 *   npx tsx scripts/backfill-character-nodes.ts             # dry-run (preview only)
 *   npx tsx scripts/backfill-character-nodes.ts --apply     # actually write
 *   npx tsx scripts/backfill-character-nodes.ts --world ID  # limit to one world
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import {
  getCharacterStore,
  getDb,
  getWorldGraphStore,
  worldsTable,
  type CharacterNodeData,
  type CharacterRecord,
} from "@odyssey/db";
import type { CharacterDefinition, WorldDefinition } from "@odyssey/types";

const APPLY = process.argv.includes("--apply");
const worldFlagIdx = process.argv.indexOf("--world");
const SCOPE_WORLD_ID =
  worldFlagIdx >= 0 && process.argv[worldFlagIdx + 1]
    ? process.argv[worldFlagIdx + 1]
    : null;

type Stats = {
  worlds: number;
  charactersUpserted: number;
  charactersCreated: number;
  nodesCreated: number;
  nodesMerged: number;
  edgesCreated: number;
  errors: string[];
};

function buildOverlay(c: CharacterDefinition): CharacterNodeData {
  const overrides: Record<string, unknown> = {};
  if (c.groupId) overrides.groupId = c.groupId;
  if (c.groupIds?.length) overrides.groupIds = c.groupIds;
  if (c.voice) overrides.voice = c.voice;
  if (c.backstory) overrides.backstory = c.backstory;
  if (c.visualDescription) overrides.visualDescription = c.visualDescription;
  if (c.knowledgeDomains?.length) overrides.knowledgeDomains = c.knowledgeDomains;
  if (c.dialogueExamples?.length) overrides.dialogueExamples = c.dialogueExamples;
  if (c.secrets?.length) overrides.secrets = c.secrets;
  if (c.deathCondition) overrides.deathCondition = c.deathCondition;
  if (c.tags?.length) overrides.tags = c.tags;
  if (c.emotionalBaseline) overrides.emotionalBaselineScores = c.emotionalBaseline;
  if (c.motivations?.length) overrides.motivationsList = c.motivations;

  const overlay: CharacterNodeData = {};
  if (c.archetype) overlay.archetype = c.archetype;
  if (c.emotionalBaseline) {
    overlay.emotionalBaseline = Object.entries(c.emotionalBaseline)
      .map(([k, v]) => `${k}:${v}`)
      .join(", ");
  }
  if (c.motivations?.length) overlay.motivations = c.motivations.join("; ");
  if (c.speakingStyle) overlay.speakingStyle = c.speakingStyle;
  if (c.behaviorTriggers?.length) {
    overlay.behaviorTriggers = c.behaviorTriggers.map((t) => ({
      condition: t.condition,
      behavior: t.behavior,
    }));
  }
  if (Object.keys(overrides).length > 0) overlay.overrides = overrides;
  return overlay;
}

async function upsertGlobalCharacter(
  c: CharacterDefinition,
  stats: Stats,
): Promise<CharacterRecord | null> {
  const store = getCharacterStore();
  const slug = c.id;
  const existing = await store.getBySlug(slug);
  if (existing) {
    stats.charactersUpserted++;
    return existing;
  }

  if (!APPLY) {
    console.log(`      · would create global character ${slug} — ${c.name}`);
    stats.charactersCreated++;
    return null;
  }

  const created = await store.create({
    slug,
    title: c.name,
    ...(c.title ? { summary: c.title } : {}),
    eras: [],
  });
  stats.charactersCreated++;
  return created;
}

async function backfillWorld(
  worldId: string,
  definition: WorldDefinition,
  stats: Stats,
) {
  const graph = getWorldGraphStore();
  console.log(`\n→ ${worldId}  (${definition.characters.length} characters)`);

  // Track ref_id → node id so we can wire edges after all nodes exist.
  const refToNodeId = new Map<string, string>();

  for (const c of definition.characters) {
    const overlay = buildOverlay(c);
    const global = await upsertGlobalCharacter(c, stats);

    if (!global) {
      console.log(`      · would ingest node for ${c.id} with overlay keys: ${Object.keys(overlay).join(", ") || "(none)"}`);
      stats.nodesCreated++;
      continue;
    }

    // Did the node already exist for this world?
    const preNodes = await graph.listNodes(worldId);
    const preExisting = preNodes.find(
      (n) => n.kind === "character" && n.refId === global.id,
    );

    if (!APPLY) {
      if (preExisting) {
        console.log(`      · would merge into existing node for ${c.id}`);
        stats.nodesMerged++;
      } else {
        console.log(`      · would create node for ${c.id} (overlay: ${Object.keys(overlay).join(", ") || "none"})`);
        stats.nodesCreated++;
      }
      refToNodeId.set(c.id, preExisting?.id ?? `__dry_${c.id}`);
      continue;
    }

    const node = await graph.ingestCharacter(worldId, global.id, {
      label: c.name,
      data: overlay,
      mergeOnExist: true,
    });
    refToNodeId.set(c.id, node.id);
    if (preExisting) {
      stats.nodesMerged++;
      console.log(`      · merged node for ${c.id}`);
    } else {
      stats.nodesCreated++;
      console.log(`      · created node for ${c.id}`);
    }
  }

  // Edges — npcRelationships → knows
  for (const c of definition.characters) {
    if (!c.npcRelationships?.length) continue;
    const fromNodeId = refToNodeId.get(c.id);
    if (!fromNodeId) continue;
    for (const rel of c.npcRelationships) {
      const toNodeId = refToNodeId.get(rel.targetCharacterId);
      if (!toNodeId) {
        console.log(`      · skip knows(${c.id} → ${rel.targetCharacterId}) — target not ingested`);
        continue;
      }
      if (fromNodeId === toNodeId) continue;

      if (!APPLY) {
        console.log(`      · would create edge knows(${c.id} → ${rel.targetCharacterId})  attitude=${rel.attitude}`);
        stats.edgesCreated++;
        continue;
      }

      try {
        await getWorldGraphStore().createEdge({
          worldId,
          fromNodeId,
          toNodeId,
          kind: "knows",
          data: {
            attitude: rel.attitude,
            ...(rel.context ? { context: rel.context } : {}),
          },
        });
        stats.edgesCreated++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        stats.errors.push(`edge ${worldId} ${c.id}→${rel.targetCharacterId}: ${msg}`);
      }
    }
  }
}

async function main() {
  const db = getDb();
  if (!db) {
    console.error("DATABASE_URL not set — nothing to do.");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: worldsTable.id,
      title: worldsTable.title,
      status: worldsTable.status,
      definition: worldsTable.definition,
    })
    .from(worldsTable);

  const targets = rows.filter((r) => {
    if (SCOPE_WORLD_ID && r.id !== SCOPE_WORLD_ID) return false;
    if (r.status === "archived") return false;
    return r.definition && typeof r.definition === "object";
  });

  console.log(
    `Mode: ${APPLY ? "APPLY" : "dry-run"}   ` +
      `Scope: ${SCOPE_WORLD_ID ? `world=${SCOPE_WORLD_ID}` : "all worlds"}   ` +
      `Candidates: ${targets.length} / ${rows.length}`,
  );

  const stats: Stats = {
    worlds: 0,
    charactersUpserted: 0,
    charactersCreated: 0,
    nodesCreated: 0,
    nodesMerged: 0,
    edgesCreated: 0,
    errors: [],
  };

  for (const row of targets) {
    const def = row.definition as WorldDefinition;
    if (!def?.characters?.length) {
      console.log(`\n→ ${row.id}: no characters in definition — skip`);
      continue;
    }
    stats.worlds++;
    try {
      await backfillWorld(row.id, def, stats);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      stats.errors.push(`world ${row.id}: ${msg}`);
      console.error(`  ✗ ${row.id}: ${msg}`);
    }
  }

  console.log("\n─── Summary ────────────────────");
  console.log(`Worlds processed:         ${stats.worlds}`);
  console.log(`Global chars reused:      ${stats.charactersUpserted}`);
  console.log(`Global chars created:     ${stats.charactersCreated}`);
  console.log(`World nodes created:      ${stats.nodesCreated}`);
  console.log(`World nodes merged:       ${stats.nodesMerged}`);
  console.log(`Edges created:            ${stats.edgesCreated}`);
  if (stats.errors.length) {
    console.log(`\nErrors (${stats.errors.length}):`);
    for (const e of stats.errors) console.log(`  · ${e}`);
  }
  if (!APPLY) console.log("\nDry run. Re-run with --apply to perform writes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
