"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCharacterStore,
  getWikiStore,
  getWikisStore,
  type Contradiction,
  type Frontmatter,
  type Perspective,
  type TimeIndex,
  type WikiPageType,
} from "@odyssey/db";
import { embedText, EMBEDDING_MODEL } from "@odyssey/engine";
import { computeKnowledgeLayout } from "@/lib/kg-layout";

/**
 * Hooks for `wiki.savePage` triggered from admin quick-edits. On a material
 * change we (a) refresh the embedding and (b) recompute the knowledge-graph
 * 2D layout so the node drifts to its new semantic position. The layout
 * recompute reads pages via the same store, so we instantiate it lazily
 * inside the closure to avoid an import cycle.
 *
 * Ingestion paths intentionally do NOT use these hooks for the layout —
 * they batch many saves and run a single trailing recompute on the next
 * knowledge-page visit (via the route's degeneracy check).
 */
const wikiSaveHooks = {
  embed: embedText,
  embeddingModel: EMBEDDING_MODEL,
  recomputeLayout: async (characterId: string): Promise<void> => {
    const store = getWikiStore();
    const [pages, edges] = await Promise.all([
      store.listPages(characterId),
      store.listCharacterEdges(characterId),
    ]);
    if (pages.length === 0) return;
    const layout = computeKnowledgeLayout(
      pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        embedding: p.embedding,
        seed: null,
      })),
      edges.map((e) => ({
        fromId: e.fromPageId,
        toId: e.toPageId,
        strength: e.strength,
      })),
    );
    if (layout.length === 0) return;
    await store.saveLayout(characterId, layout);
  },
  recomputeWikiLayout: async (wikiId: string): Promise<void> => {
    const store = getWikiStore();
    const [pages, edges] = await Promise.all([
      store.listPagesForWiki(wikiId),
      store.listWikiEdges(wikiId),
    ]);
    if (pages.length === 0) return;
    const layout = computeKnowledgeLayout(
      pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        embedding: p.embedding,
        seed: null,
      })),
      edges.map((e) => ({
        fromId: e.fromPageId,
        toId: e.toPageId,
        strength: e.strength,
      })),
    );
    if (layout.length === 0) return;
    await store.saveLayoutForWiki(wikiId, layout);
  },
};

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function createUnnamedWiki(): Promise<ActionResult<{ id: string }>> {
  const wikis = getWikisStore();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = `wiki-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const existing = await wikis.getWikiBySlug(slug);
    if (existing) continue;

    const wiki = await wikis.createWiki({
      slug,
      title: "Untitled wiki",
      summary: null,
      eras: [],
    });

    revalidatePath("/wikis");
    redirect(`/wikis/${wiki.id}`);
  }

  return { ok: false, error: "Could not create a unique wiki. Try again." };
}

export type WikiMetaPatch = {
  title?: string;
  /** Pass `null` to clear; omit to leave unchanged. */
  summary?: string | null;
};

/**
 * Update wiki metadata (title and/or summary). Trims input, rejects empty
 * titles, and revalidates the affected routes so every consumer sees the
 * change after the optimistic local update settles.
 */
export async function updateWikiMeta(
  id: string,
  patch: WikiMetaPatch,
): Promise<ActionResult<{ title: string; summary: string | null }>> {
  const sanitized: { title?: string; summary?: string | null } = {};

  if (patch.title !== undefined) {
    const trimmed = patch.title.trim();
    if (!trimmed) return { ok: false, error: "Title cannot be empty" };
    sanitized.title = trimmed;
  }

  if (patch.summary !== undefined) {
    if (patch.summary === null) sanitized.summary = null;
    else {
      const trimmed = patch.summary.trim();
      sanitized.summary = trimmed.length === 0 ? null : trimmed;
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return { ok: false, error: "Nothing to update" };
  }

  const wikis = getWikisStore();
  const updated = await wikis.updateWiki(id, sanitized);
  if (!updated) return { ok: false, error: "Wiki not found" };

  revalidatePath("/wikis");
  revalidatePath(`/wikis/${id}`, "layout");

  return {
    ok: true,
    data: { title: updated.title, summary: updated.summary },
  };
}

export type WikiPageContentPatch = {
  title?: string;
  /** Pass `null` to clear; omit to leave unchanged. */
  summary?: string | null;
  body?: string;
};

export async function previewPurgeWikiSource(
  wikiId: string,
  sourceId: string,
): Promise<
  ActionResult<{
    source: { title: string; kind: string; hashPrefix: string };
    pagesRemoved: number;
    edgesRemoved: number;
  }>
> {
  const wiki = getWikiStore();
  const source = await wiki.getSource(sourceId);
  if (!source || source.wikiId !== wikiId) {
    return { ok: false, error: "Source not found for this wiki." };
  }

  const impact = await wiki.previewPurgeSource(sourceId);
  return {
    ok: true,
    data: {
      source: {
        title: source.title,
        kind: source.kind,
        hashPrefix: source.contentHash.slice(0, 8),
      },
      pagesRemoved: impact.pagesRemoved,
      edgesRemoved: impact.edgesRemoved,
    },
  };
}

export async function purgeWikiSource(
  wikiId: string,
  sourceId: string,
): Promise<ActionResult<{ pagesRemoved: number; edgesRemoved: number }>> {
  const wiki = getWikiStore();
  const source = await wiki.getSource(sourceId);
  if (!source || source.wikiId !== wikiId) {
    return { ok: false, error: "Source not found for this wiki." };
  }

  const result = await wiki.purgeSource(sourceId);
  if (result.sourceRemoved === 0) return { ok: false, error: "Delete failed." };

  revalidatePath(`/wikis/${wikiId}`, "layout");
  return {
    ok: true,
    data: {
      pagesRemoved: result.pagesRemoved,
      edgesRemoved: result.edgesRemoved,
    },
  };
}

export async function previewPurgeWikiIngestionRun(
  wikiId: string,
  runId: string,
): Promise<
  ActionResult<{
    source: { title: string; kind: string; hashPrefix: string } | null;
    sourceShared: boolean;
    pagesRemoved: number;
    edgesRemoved: number;
  }>
> {
  const wiki = getWikiStore();
  const runs = await wiki.listIngestionRunsForWiki(wikiId, 1000);
  const run = runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found for this wiki." };

  if (!run.sourceId) {
    return {
      ok: true,
      data: { source: null, sourceShared: false, pagesRemoved: 0, edgesRemoved: 0 },
    };
  }

  const sourceShared = runs.some((r) => r.id !== runId && r.sourceId === run.sourceId);
  const source = await wiki.getSource(run.sourceId);
  if (!source || source.wikiId !== wikiId) {
    return {
      ok: true,
      data: { source: null, sourceShared, pagesRemoved: 0, edgesRemoved: 0 },
    };
  }

  const impact = sourceShared
    ? { pagesRemoved: 0, edgesRemoved: 0 }
    : await wiki.previewPurgeSource(run.sourceId);

  return {
    ok: true,
    data: {
      source: {
        title: source.title,
        kind: source.kind,
        hashPrefix: source.contentHash.slice(0, 8),
      },
      sourceShared,
      pagesRemoved: impact.pagesRemoved,
      edgesRemoved: impact.edgesRemoved,
    },
  };
}

export async function purgeWikiIngestionRun(
  wikiId: string,
  runId: string,
): Promise<
  ActionResult<{
    sourceRemoved: number;
    pagesRemoved: number;
    edgesRemoved: number;
  }>
> {
  const wiki = getWikiStore();
  const runs = await wiki.listIngestionRunsForWiki(wikiId, 1000);
  if (!runs.some((r) => r.id === runId)) {
    return { ok: false, error: "Run not found for this wiki." };
  }

  const result = await wiki.purgeIngestionRun(runId);
  if (result.runRemoved === 0) return { ok: false, error: "Run not found." };

  revalidatePath(`/wikis/${wikiId}`, "layout");
  return {
    ok: true,
    data: {
      sourceRemoved: result.sourceRemoved,
      pagesRemoved: result.pagesRemoved,
      edgesRemoved: result.edgesRemoved,
    },
  };
}

export type UpdateWikiPageInput = {
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  frontmatter: Frontmatter;
  perspective: Perspective;
  confidence: number;
  timeIndex: TimeIndex | null;
  knowsFuture: boolean;
  contradictions: Contradiction[];
};

export async function updateWikiPage(
  wikiId: string,
  pageId: string,
  input: UpdateWikiPageInput,
): Promise<ActionResult<{ slug: string }>> {
  const wiki = getWikiStore();
  const existing = await wiki.getPage(pageId);
  if (!existing || existing.wikiId !== wikiId) {
    return { ok: false, error: "Page not found for this wiki." };
  }
  if (existing.slug !== input.slug) {
    return { ok: false, error: "Slug mismatch — reload and try again." };
  }
  if (existing.type !== input.type) {
    return { ok: false, error: "Page type can't change once the page exists." };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title cannot be empty." };

  await wiki.savePage(
    {
      wikiId,
      type: existing.type,
      slug: existing.slug,
      title,
      summary: input.summary?.trim() ?? null,
      body: input.body,
      frontmatter: input.frontmatter,
      perspective: input.perspective,
      confidence: Math.max(0, Math.min(1, input.confidence)),
      timeIndex: input.timeIndex,
      knowsFuture: input.knowsFuture,
      contradictions: input.contradictions,
      authorKind: "human",
      note: "manual edit from wiki UI",
    },
    wikiSaveHooks,
  );

  revalidatePath(`/wikis/${wikiId}`, "layout");
  return { ok: true, data: { slug: existing.slug } };
}

/**
 * Lightweight page edit from the knowledge-graph panel. Updates title /
 * summary / body only; preserves everything else (frontmatter, perspective,
 * confidence, etc.) by reading the existing record and re-saving.
 *
 * Routes through `savePage` so version snapshots, edge reconciliation, and
 * re-embedding all run.
 */
export async function updateWikiPageContent(
  wikiId: string,
  pageId: string,
  patch: WikiPageContentPatch,
): Promise<
  ActionResult<{ slug: string; title: string; summary: string | null; body: string }>
> {
  const wiki = getWikiStore();
  const existing = await wiki.getPage(pageId);
  if (!existing) return { ok: false, error: "Page not found" };

  const nextTitle =
    patch.title !== undefined ? patch.title.trim() : existing.title;
  if (!nextTitle) return { ok: false, error: "Title cannot be empty" };

  let nextSummary: string | null = existing.summary;
  if (patch.summary !== undefined) {
    if (patch.summary === null) nextSummary = null;
    else {
      const trimmed = patch.summary.trim();
      nextSummary = trimmed.length === 0 ? null : trimmed;
    }
  }

  const nextBody = patch.body !== undefined ? patch.body : existing.body;

  await wiki.savePage(
    {
      wikiId,
      type: existing.type,
      slug: existing.slug,
      title: nextTitle,
      summary: nextSummary,
      body: nextBody,
      frontmatter: existing.frontmatter,
      perspective: existing.perspective,
      confidence: existing.confidence,
      timeIndex: existing.timeIndex,
      knowsFuture: existing.knowsFuture,
      contradictions: existing.contradictions,
      authorKind: "human",
      note: "knowledge graph quick-edit",
    },
    wikiSaveHooks,
  );

  // Revalidate the wiki's pages list + the dedicated page route so the
  // overview, list view, and full editor all reflect the change.
  revalidatePath(`/wikis/${wikiId}`, "layout");
  if (existing.characterId) {
    const character = await getCharacterStore().getById(existing.characterId);
    if (character) revalidatePath(`/characters/${character.slug}/wiki`);
  }

  return {
    ok: true,
    data: {
      slug: existing.slug,
      title: nextTitle,
      summary: nextSummary,
      body: nextBody,
    },
  };
}
