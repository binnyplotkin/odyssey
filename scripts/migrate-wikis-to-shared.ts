/**
 * One-shot migration: convert per-character wikis into shared wikis.
 *
 * For each character in the `characters` table this script:
 *   1. Creates a row in `wikis` (slug = `${character.slug}-wiki`,
 *      title/summary/eras/ingestionPrompt cloned from the character).
 *   2. Backfills `wiki_id` on the character's wiki_pages, wiki_edges,
 *      wiki_sources, and wiki_ingestion_log rows.
 *   3. Inserts a `character_knowledge_bindings` row binding the character to
 *      its newly-created wiki with priority='primary', isActive=true.
 *   4. Sets `voice_identity_page_id` on the character to the id of its
 *      voice_identity wiki page (if one exists).
 *
 * The script is idempotent:
 *   - If a wiki with the expected slug already exists, it's reused.
 *   - Wiki rows whose wiki_id is already set are skipped.
 *   - Existing bindings are not duplicated.
 *
 * The original `character_id` columns on the wiki_* tables are left
 * populated for back-compat. A future cleanup migration will drop them
 * once all consumers read by wiki_id.
 *
 * Usage:
 *   npx tsx scripts/migrate-wikis-to-shared.ts          # dry run (no writes)
 *   npx tsx scripts/migrate-wikis-to-shared.ts --apply  # perform writes
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { and, eq, isNull } from "drizzle-orm";
import {
  getDb,
  charactersTable,
  characterKnowledgeBindingsTable,
  wikisTable,
  wikiPagesTable,
  wikiEdgesTable,
  wikiSourcesTable,
  wikiIngestionLogTable,
} from "@odyssey/db";

const APPLY = process.argv.includes("--apply");

type Counts = {
  wikisCreated: number;
  wikisReused: number;
  pagesUpdated: number;
  edgesUpdated: number;
  sourcesUpdated: number;
  ingestionLogsUpdated: number;
  bindingsCreated: number;
  bindingsReused: number;
  voiceIdentityLinked: number;
};

async function main() {
  const db = getDb();
  if (!db) {
    console.error("[migrate-wikis] DATABASE_URL not set. Aborting.");
    process.exit(1);
  }

  console.log(`[migrate-wikis] ${APPLY ? "APPLY" : "DRY RUN"} mode`);

  const characters = await db.select().from(charactersTable);
  console.log(`[migrate-wikis] found ${characters.length} characters`);

  const counts: Counts = {
    wikisCreated: 0,
    wikisReused: 0,
    pagesUpdated: 0,
    edgesUpdated: 0,
    sourcesUpdated: 0,
    ingestionLogsUpdated: 0,
    bindingsCreated: 0,
    bindingsReused: 0,
    voiceIdentityLinked: 0,
  };

  for (const character of characters) {
    const wikiSlug = `${character.slug}-wiki`;
    console.log(`\n[migrate-wikis] character: ${character.slug} (${character.id})`);

    // Step 1: prefer an already-bound wiki. Only create/reuse the legacy
    // `${character.slug}-wiki` container when the character has no binding yet.
    const boundWikis = await db
      .select({
        binding: characterKnowledgeBindingsTable,
        wiki: wikisTable,
      })
      .from(characterKnowledgeBindingsTable)
      .innerJoin(
        wikisTable,
        eq(wikisTable.id, characterKnowledgeBindingsTable.wikiId),
      )
      .where(eq(characterKnowledgeBindingsTable.characterId, character.id));

    const preferred =
      boundWikis.find(
        (row) => row.binding.isActive && row.binding.priority === "primary",
      ) ??
      boundWikis.find((row) => row.binding.isActive) ??
      boundWikis[0];

    let wikiId: string;
    if (preferred) {
      wikiId = preferred.wiki.id;
      counts.wikisReused += 1;
      console.log(
        `  ↳ bound wiki reused: ${preferred.wiki.slug} (${wikiId})`,
      );
    } else {
      const [existingWiki] = await db
        .select()
        .from(wikisTable)
        .where(eq(wikisTable.slug, wikiSlug));

      if (existingWiki) {
        wikiId = existingWiki.id;
        counts.wikisReused += 1;
        console.log(`  ↳ wiki exists: ${wikiSlug} (${wikiId})`);
      } else {
        if (APPLY) {
          const [created] = await db
            .insert(wikisTable)
            .values({
              slug: wikiSlug,
              title: `${character.title} — wiki`,
              summary: character.summary ?? null,
              eras: character.eras ?? [],
              ingestionPrompt: character.ingestionPrompt ?? null,
            })
            .returning({ id: wikisTable.id });
          wikiId = created.id;
        } else {
          wikiId = "<dry-run-wiki-id>";
        }
        counts.wikisCreated += 1;
        console.log(`  ↳ wiki created: ${wikiSlug} (${wikiId})`);
      }
    }

    // Step 2: backfill wiki_id on child rows that don't have it yet.
    if (APPLY) {
      const pagesResult = await db
        .update(wikiPagesTable)
        .set({ wikiId })
        .where(
          and(
            eq(wikiPagesTable.characterId, character.id),
            isNull(wikiPagesTable.wikiId),
          ),
        )
        .returning({ id: wikiPagesTable.id });
      counts.pagesUpdated += pagesResult.length;
      console.log(`  ↳ pages updated: ${pagesResult.length}`);

      const edgesResult = await db
        .update(wikiEdgesTable)
        .set({ wikiId })
        .where(
          and(
            eq(wikiEdgesTable.characterId, character.id),
            isNull(wikiEdgesTable.wikiId),
          ),
        )
        .returning({ id: wikiEdgesTable.id });
      counts.edgesUpdated += edgesResult.length;
      console.log(`  ↳ edges updated: ${edgesResult.length}`);

      const sourcesResult = await db
        .update(wikiSourcesTable)
        .set({ wikiId })
        .where(
          and(
            eq(wikiSourcesTable.characterId, character.id),
            isNull(wikiSourcesTable.wikiId),
          ),
        )
        .returning({ id: wikiSourcesTable.id });
      counts.sourcesUpdated += sourcesResult.length;
      console.log(`  ↳ sources updated: ${sourcesResult.length}`);

      const ingestionResult = await db
        .update(wikiIngestionLogTable)
        .set({ wikiId })
        .where(
          and(
            eq(wikiIngestionLogTable.characterId, character.id),
            isNull(wikiIngestionLogTable.wikiId),
          ),
        )
        .returning({ id: wikiIngestionLogTable.id });
      counts.ingestionLogsUpdated += ingestionResult.length;
      console.log(`  ↳ ingestion logs updated: ${ingestionResult.length}`);
    } else {
      // Dry run — count what would be updated.
      const pagesToUpdate = await db
        .select({ id: wikiPagesTable.id })
        .from(wikiPagesTable)
        .where(
          and(
            eq(wikiPagesTable.characterId, character.id),
            isNull(wikiPagesTable.wikiId),
          ),
        );
      counts.pagesUpdated += pagesToUpdate.length;
      console.log(`  ↳ pages to update: ${pagesToUpdate.length}`);

      const edgesToUpdate = await db
        .select({ id: wikiEdgesTable.id })
        .from(wikiEdgesTable)
        .where(
          and(
            eq(wikiEdgesTable.characterId, character.id),
            isNull(wikiEdgesTable.wikiId),
          ),
        );
      counts.edgesUpdated += edgesToUpdate.length;
      console.log(`  ↳ edges to update: ${edgesToUpdate.length}`);

      const sourcesToUpdate = await db
        .select({ id: wikiSourcesTable.id })
        .from(wikiSourcesTable)
        .where(
          and(
            eq(wikiSourcesTable.characterId, character.id),
            isNull(wikiSourcesTable.wikiId),
          ),
        );
      counts.sourcesUpdated += sourcesToUpdate.length;
      console.log(`  ↳ sources to update: ${sourcesToUpdate.length}`);

      const ingestionToUpdate = await db
        .select({ id: wikiIngestionLogTable.id })
        .from(wikiIngestionLogTable)
        .where(
          and(
            eq(wikiIngestionLogTable.characterId, character.id),
            isNull(wikiIngestionLogTable.wikiId),
          ),
        );
      counts.ingestionLogsUpdated += ingestionToUpdate.length;
      console.log(`  ↳ ingestion logs to update: ${ingestionToUpdate.length}`);
    }

    // Step 3: create the character → wiki binding (skip if it exists).
    const [existingBinding] = await db
      .select()
      .from(characterKnowledgeBindingsTable)
      .where(
        and(
          eq(characterKnowledgeBindingsTable.characterId, character.id),
          eq(characterKnowledgeBindingsTable.wikiId, wikiId),
        ),
      );

    if (existingBinding) {
      counts.bindingsReused += 1;
      console.log(`  ↳ binding exists`);
    } else {
      if (APPLY) {
        await db.insert(characterKnowledgeBindingsTable).values({
          characterId: character.id,
          wikiId,
          priority: "primary",
          isActive: true,
        });
      }
      counts.bindingsCreated += 1;
      console.log(`  ↳ binding created (primary, active)`);
    }

    // Step 4: link voice_identity page if present.
    const [voicePage] = await db
      .select({ id: wikiPagesTable.id })
      .from(wikiPagesTable)
      .where(
        and(
          eq(wikiPagesTable.characterId, character.id),
          eq(wikiPagesTable.type, "voice_identity"),
        ),
      );

    if (voicePage) {
      if (character.voiceIdentityPageId === voicePage.id) {
        console.log(`  ↳ voice_identity already linked (${voicePage.id})`);
      } else {
        if (APPLY) {
          await db
            .update(charactersTable)
            .set({ voiceIdentityPageId: voicePage.id })
            .where(eq(charactersTable.id, character.id));
        }
        counts.voiceIdentityLinked += 1;
        console.log(`  ↳ voice_identity linked: ${voicePage.id}`);
      }
    } else {
      console.log(`  ↳ no voice_identity page found`);
    }
  }

  console.log("\n[migrate-wikis] summary:");
  console.log(`  wikis created:           ${counts.wikisCreated}`);
  console.log(`  wikis reused:            ${counts.wikisReused}`);
  console.log(`  pages updated:           ${counts.pagesUpdated}`);
  console.log(`  edges updated:           ${counts.edgesUpdated}`);
  console.log(`  sources updated:         ${counts.sourcesUpdated}`);
  console.log(`  ingestion logs updated:  ${counts.ingestionLogsUpdated}`);
  console.log(`  bindings created:        ${counts.bindingsCreated}`);
  console.log(`  bindings reused:         ${counts.bindingsReused}`);
  console.log(`  voice_identity linked:   ${counts.voiceIdentityLinked}`);

  if (!APPLY) {
    console.log("\n[migrate-wikis] DRY RUN complete. Re-run with --apply to perform writes.");
  } else {
    console.log("\n[migrate-wikis] migration complete.");
  }
}

main().catch((err) => {
  console.error("[migrate-wikis] failed:", err);
  process.exit(1);
});
