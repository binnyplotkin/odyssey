/**
 * Smoke test the wiki store end-to-end against the real DB.
 *
 * Creates a throwaway character with slug `smoke-test-character`, a handful
 * of pages, verifies edges derive correctly, version bumps fire on material
 * change, and cleans up by deleting the character (cascades wipe everything).
 *
 * Usage:
 *   npx tsx scripts/smoke-test-wiki.ts            # run the test
 *   npx tsx scripts/smoke-test-wiki.ts --leave    # don't clean up afterwards
 */

import "dotenv/config";
import { getCharacterStore, getWikiStore } from "@odyssey/db";

const LEAVE = process.argv.includes("--leave");
const SLUG = "smoke-test-character";

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`[${label}] expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
  console.log(`  ✓ ${label}`);
}

async function main() {
  const characters = getCharacterStore();
  const wiki = getWikiStore();

  // Clean slate
  const prior = await characters.getBySlug(SLUG);
  if (prior) {
    console.log(`Removing prior test character ${prior.id} …`);
    await characters.remove(prior.id);
  }

  console.log("\n1. Create character");
  const char = await characters.create({
    slug: SLUG,
    title: "Smoke Test",
    summary: "Throwaway character for wiki store verification.",
    eras: [
      { key: "early", title: "Early Life", order: 0 },
      { key: "later", title: "Later Life", order: 1 },
    ],
  });
  assertEq(char.slug, SLUG, "character slug");
  assertEq(char.eras.length, 2, "character eras count");

  console.log("\n2. Save entity page (new)");
  const entity1 = await wiki.savePage({
    characterId: char.id,
    type: "entity",
    slug: "alice",
    title: "Alice",
    summary: "A person in the test fixture.",
    body: "Alice is described in many places.",
    frontmatter: { kind: "person", aliases: ["Al"] },
    confidence: 0.9,
  });
  assertEq(entity1.created, true, "entity created flag");
  assertEq(entity1.versionCreated, true, "entity first version");
  assertEq(entity1.edgesAdded, 0, "entity no edges yet (no wikilinks, no targets)");
  assertEq(entity1.page.version, 1, "entity version 1");

  console.log("\n3. Save entity page (same content → idempotent, no version bump)");
  const entity1Again = await wiki.savePage({
    characterId: char.id,
    type: "entity",
    slug: "alice",
    title: "Alice",
    summary: "A person in the test fixture.",
    body: "Alice is described in many places.",
    frontmatter: { kind: "person", aliases: ["Al"] },
    confidence: 0.9,
  });
  assertEq(entity1Again.created, false, "idempotent save: not created");
  assertEq(entity1Again.versionCreated, false, "idempotent save: no version bump");
  assertEq(entity1Again.page.version, 1, "still version 1");

  console.log("\n4. Save place entity");
  const place = await wiki.savePage({
    characterId: char.id,
    type: "entity",
    slug: "the-oak",
    title: "The Oak",
    body: "A gathering place.",
    frontmatter: { kind: "place" },
  });
  assertEq(place.created, true, "place created");

  console.log("\n5. Save event with wikilinks and structured edges");
  const event = await wiki.savePage({
    characterId: char.id,
    type: "event",
    slug: "the-gathering",
    title: "The Gathering",
    body: "At [[the-oak|the old oak]], [[alice]] met the others.",
    frontmatter: {
      when: { era: "early", index: 1 },
      where: "the-oak",
      participants: ["alice"],
    },
    timeIndex: { era: "early", index: 1 },
    authorKind: "llm",
  });
  assertEq(event.created, true, "event created");
  // Expected edges: mentions→the-oak, mentions→alice (from body),
  //                 happens_at→the-oak, participates_in→alice (frontmatter)
  assertEq(event.edgesAdded, 4, "event edges added");

  console.log("\n6. Verify outgoing edges by kind");
  const outgoing = await wiki.listOutgoing(event.page.id);
  const byKind = outgoing.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  assertEq(byKind.mentions, 2, "outgoing mentions");
  assertEq(byKind.happens_at, 1, "outgoing happens_at");
  assertEq(byKind.participates_in, 1, "outgoing participates_in");

  console.log("\n7. Verify incoming edges on the-oak");
  const oakIncoming = await wiki.listIncoming(place.page.id);
  assertEq(oakIncoming.length, 2, "the-oak has 2 incoming edges (mentions + happens_at)");

  console.log("\n8. Material change → version bump");
  const event2 = await wiki.savePage({
    characterId: char.id,
    type: "event",
    slug: "the-gathering",
    title: "The Gathering",
    body: "At [[the-oak|the old oak]], [[alice]] met the others. A storm rolled in.",
    frontmatter: {
      when: { era: "early", index: 1 },
      where: "the-oak",
      participants: ["alice"],
    },
    timeIndex: { era: "early", index: 1 },
    authorKind: "human",
    note: "added storm detail",
  });
  assertEq(event2.created, false, "event not re-created");
  assertEq(event2.versionCreated, true, "version bumped on body change");
  assertEq(event2.page.version, 2, "version 2");

  console.log("\n9. Version history retrievable");
  const versions = await wiki.listPageVersions(event.page.id);
  assertEq(versions.length, 2, "event has 2 versions");
  assertEq(versions[0].version, 2, "newest version first");
  assertEq(versions[1].version, 1, "oldest version last");

  console.log("\n10. Drop a participant → edge removed");
  const event3 = await wiki.savePage({
    characterId: char.id,
    type: "event",
    slug: "the-gathering",
    title: "The Gathering",
    body: "At [[the-oak|the old oak]], Alice met the others. A storm rolled in.",
    // Body no longer has [[alice]], frontmatter drops participants
    frontmatter: {
      when: { era: "early", index: 1 },
      where: "the-oak",
    },
    timeIndex: { era: "early", index: 1 },
  });
  assertEq(event3.edgesAdded, 0, "no new edges");
  assertEq(event3.edgesRemoved, 2, "alice mentions + participates_in both removed");

  console.log("\n11. Rebuild edges (safety valve)");
  const rebuilt = await wiki.rebuildEdges(char.id);
  console.log(`  rebuild: added=${rebuilt.added} removed=${rebuilt.removed}`);
  // After rebuild the total edge count should match what we derive
  const allEdges = await wiki.listCharacterEdges(char.id);
  console.log(`  final edge count: ${allEdges.length}`);

  console.log("\n12. Sources + source refs");
  const source = await wiki.createSource({
    characterId: char.id,
    title: "Test Source",
    kind: "note",
    content: "The gathering happened at the oak.",
  });
  await wiki.addSourceRefs([
    {
      pageId: event.page.id,
      sourceId: source.id,
      passage: "line 1",
      quote: "The gathering happened at the oak.",
      relevanceNote: "direct reference",
    },
  ]);
  const refs = await wiki.listSourceRefsForPage(event.page.id);
  assertEq(refs.length, 1, "source ref created");

  console.log("\n13. Dedupe source by hash");
  const dup = await wiki.findSourceByHash(char.id, source.contentHash);
  assertEq(dup?.id, source.id, "source findable by hash");

  console.log("\n14. Ingestion log lifecycle");
  const run = await wiki.startIngestion({
    characterId: char.id,
    sourceId: source.id,
    notes: "smoke test run",
  });
  assertEq(run.status, "running", "ingestion run started");
  const finished = await wiki.finishIngestion(run.id, {
    status: "succeeded",
    pagesCreated: 3,
    pagesUpdated: 1,
    edgesAdded: 4,
    tokensUsed: 1234,
  });
  assertEq(finished?.status, "succeeded", "ingestion run finished");
  assertEq(finished?.pagesCreated, 3, "ingestion metrics recorded");

  console.log("\n15. Cleanup");
  if (LEAVE) {
    console.log(`  Left character ${char.id} in place (--leave).`);
  } else {
    await characters.remove(char.id);
    const gone = await characters.getBySlug(SLUG);
    assertEq(gone, null, "character + wiki cascaded away");
  }

  console.log("\n✓ All smoke tests passed.");
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err);
  process.exit(1);
});
