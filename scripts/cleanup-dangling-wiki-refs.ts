/**
 * Remove dangling wiki references left behind by older purge behavior.
 *
 * Usage:
 *   npx tsx scripts/cleanup-dangling-wiki-refs.ts --character-slug sarah
 *   npx tsx scripts/cleanup-dangling-wiki-refs.ts --character-slug sarah --apply
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { eq, or } from "drizzle-orm";
import {
  characterKnowledgeBindingsTable,
  charactersTable,
  getDb,
  getWikiStore,
  wikiPagesTable,
  wikisTable,
  type Contradiction,
  type Frontmatter,
  type WikiPageType,
} from "@odyssey/db";
import { parseWikilinks } from "../packages/db/src/wiki-links";

const APPLY = process.argv.includes("--apply");
const characterSlug =
  readArg("--character-slug") ?? readArg("--slug") ?? "sarah";
const explicitWikiId = readArg("--wiki-id");
const explicitWikiSlug = readArg("--wiki-slug");

type PageRow = typeof wikiPagesTable.$inferSelect;

async function main(): Promise<void> {
  const db = getDb();
  if (!db) {
    console.error("[cleanup-dangling-wiki-refs] DATABASE_URL not set.");
    process.exit(1);
  }

  const target = await resolveTarget(db);
  if (!target) {
    console.error(
      `[cleanup-dangling-wiki-refs] No wiki found for character slug "${characterSlug}".`,
    );
    process.exit(1);
  }

  const { characterId, wikiId, label } = target;
  const store = getWikiStore();
  console.log(
    `[cleanup-dangling-wiki-refs] ${APPLY ? "APPLY" : "DRY RUN"} ${label}`,
  );

  const where =
    wikiId && characterId
      ? or(eq(wikiPagesTable.wikiId, wikiId), eq(wikiPagesTable.characterId, characterId))
      : wikiId
        ? eq(wikiPagesTable.wikiId, wikiId)
        : eq(wikiPagesTable.characterId, characterId);

  const pages = await db.select().from(wikiPagesTable).where(where);
  const existingIds = new Set(pages.map((page) => page.id));
  const existingSlugs = new Set(pages.map((page) => page.slug));
  const titleBySlug = new Map(pages.map((page) => [page.slug, page.title] as const));

  let pagesChanged = 0;
  let bodyLinksRemoved = 0;
  let frontmatterRefsRemoved = 0;
  let contradictionRefsRemoved = 0;

  for (const page of pages) {
    const bodyCleanup = unlinkDanglingWikilinks(
      page.body,
      existingSlugs,
      titleBySlug,
    );
    const frontmatterCleanup = removeDanglingFrontmatterRefs(
      page.type as WikiPageType,
      (page.frontmatter as Frontmatter | null) ?? ({} as Frontmatter),
      existingSlugs,
    );
    const contradictions = ((page.contradictions as Contradiction[] | null) ?? []);
    const nextContradictions = contradictions.filter((ref) =>
      existingIds.has(ref.otherPageId),
    );
    const pageChanged =
      bodyCleanup.body !== page.body ||
      frontmatterCleanup.frontmatter !== page.frontmatter ||
      nextContradictions.length !== contradictions.length;

    if (!pageChanged) continue;

    pagesChanged += 1;
    bodyLinksRemoved += bodyCleanup.removed;
    frontmatterRefsRemoved += frontmatterCleanup.removed;
    contradictionRefsRemoved += contradictions.length - nextContradictions.length;

    console.log(
      `  - ${page.slug}: ${bodyCleanup.removed} body link(s), ` +
        `${frontmatterCleanup.removed} frontmatter ref(s), ` +
        `${contradictions.length - nextContradictions.length} contradiction ref(s)`,
    );

    if (!APPLY) continue;

    await db
      .update(wikiPagesTable)
      .set({
        body: bodyCleanup.body,
        frontmatter: frontmatterCleanup.frontmatter,
        contradictions: nextContradictions,
        updatedAt: new Date(),
      })
      .where(eq(wikiPagesTable.id, page.id));

    if (wikiId) {
      await store.reconcileEdgesForWikiPages(wikiId, [page.id]);
    } else if (characterId) {
      await store.rebuildEdges(characterId);
    }
  }

  console.log(
    `[cleanup-dangling-wiki-refs] pages changed: ${pagesChanged}; ` +
      `body links removed: ${bodyLinksRemoved}; ` +
      `frontmatter refs removed: ${frontmatterRefsRemoved}; ` +
      `contradiction refs removed: ${contradictionRefsRemoved}`,
  );
}

async function resolveTarget(db: NonNullable<ReturnType<typeof getDb>>) {
  let characterId: string | null = null;
  const [character] = await db
    .select()
    .from(charactersTable)
    .where(eq(charactersTable.slug, characterSlug))
    .limit(1);
  if (character) characterId = character.id;

  if (explicitWikiId) {
    return {
      characterId,
      wikiId: explicitWikiId,
      label: `wiki=${explicitWikiId} character=${characterSlug}`,
    };
  }

  if (explicitWikiSlug) {
    const [wiki] = await db
      .select()
      .from(wikisTable)
      .where(eq(wikisTable.slug, explicitWikiSlug))
      .limit(1);
    if (!wiki) return null;
    return {
      characterId,
      wikiId: wiki.id,
      label: `wiki=${wiki.slug} (${wiki.id}) character=${characterSlug}`,
    };
  }

  if (!characterId) return null;

  const bindings = await db
    .select({
      binding: characterKnowledgeBindingsTable,
      wiki: wikisTable,
    })
    .from(characterKnowledgeBindingsTable)
    .innerJoin(wikisTable, eq(wikisTable.id, characterKnowledgeBindingsTable.wikiId))
    .where(eq(characterKnowledgeBindingsTable.characterId, characterId));

  const preferred =
    bindings.find(
      (row) => row.binding.isActive && row.binding.priority === "primary",
    ) ??
    bindings.find((row) => row.binding.isActive) ??
    bindings[0];

  return {
    characterId,
    wikiId: preferred?.wiki.id ?? null,
    label: preferred
      ? `wiki=${preferred.wiki.slug} (${preferred.wiki.id}) character=${characterSlug}`
      : `legacy character=${characterSlug} (${characterId})`,
  };
}

function unlinkDanglingWikilinks(
  body: string,
  existingSlugs: Set<string>,
  titleBySlug: Map<string, string>,
): { body: string; removed: number } {
  if (!body) return { body, removed: 0 };
  let next = body;
  let removed = 0;
  const replacements = new Map<string, string>();
  for (const link of parseWikilinks(body)) {
    if (existingSlugs.has(link.slug)) continue;
    replacements.set(
      link.raw,
      link.display ?? titleBySlug.get(link.slug) ?? prettifySlug(link.slug),
    );
  }
  for (const [raw, replacement] of replacements) {
    const count = next.split(raw).length - 1;
    if (count <= 0) continue;
    next = next.split(raw).join(replacement);
    removed += count;
  }
  return { body: next, removed };
}

function removeDanglingFrontmatterRefs(
  type: WikiPageType,
  frontmatter: Frontmatter,
  existingSlugs: Set<string>,
): { frontmatter: Frontmatter; removed: number } {
  const next = { ...(frontmatter as Record<string, unknown>) };
  let removed = 0;

  const removeStringField = (key: string) => {
    if (typeof next[key] === "string" && !existingSlugs.has(next[key] as string)) {
      delete next[key];
      removed += 1;
    }
  };
  const removeStringArrayField = (key: string) => {
    const value = next[key];
    if (!Array.isArray(value)) return;
    const filtered = value.filter(
      (item) => typeof item !== "string" || existingSlugs.has(item),
    );
    const diff = value.length - filtered.length;
    if (diff === 0) return;
    if (filtered.length > 0) next[key] = filtered;
    else delete next[key];
    removed += diff;
  };

  if (type === "entity") {
    removeStringField("firstAppearance");
    removeStringField("lastAppearance");
  } else if (type === "event") {
    removeStringField("where");
    removeStringArrayField("participants");
    removeStringArrayField("causes");
    removeStringArrayField("effects");
  } else if (type === "concept") {
    removeStringArrayField("instances");
    removeStringArrayField("relatedConcepts");
  } else if (type === "relationship") {
    removeStringField("from");
    removeStringField("to");
    removeStringArrayField("evolution");
  }

  return {
    frontmatter: removed > 0 ? (next as Frontmatter) : frontmatter,
    removed,
  };
}

function prettifySlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

main().catch((err) => {
  console.error("[cleanup-dangling-wiki-refs] failed:", err);
  process.exit(1);
});
