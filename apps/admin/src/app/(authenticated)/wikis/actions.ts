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
import { call, extractToolUse } from "@odyssey/wiki-ingest";
import { computeKnowledgeLayout } from "@/lib/kg-layout";
import { parseSourceFrontmatter } from "@/lib/source-frontmatter";

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

const SOURCE_FRONTMATTER_KEYS = [
  "title",
  "book",
  "chapter",
  "verses",
  "source_type",
  "passage_type",
  "canonicality",
  "character_focus",
  "chronological_order",
  "time_period",
  "location",
  "participants",
  "speaker",
  "knowledge_accessible",
  "themes",
  "relationships",
  "emotions",
  "confidence",
];

const MAX_FRONTMATTER_SOURCE_CHARS = 12000;
const LLM_RETRY_DELAYS_MS = [800, 1800];

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isProviderOverloadedError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  const message = err instanceof Error ? err.message : String(err);
  return status === 529 || /529|overloaded_error|overloaded/i.test(message);
}

function formatLlmError(err: unknown): string {
  if (isProviderOverloadedError(err)) {
    return "Model provider is overloaded. Try generating again in a moment.";
  }
  return err instanceof Error ? err.message : String(err);
}

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

export async function generateSourceFrontmatter(input: {
  wikiTitle: string;
  sourceTitle: string;
  tags: string[];
  sourceText: string;
  existingFrontmatter: string;
}): Promise<ActionResult<{ frontmatter: string }>> {
  const sourceText = input.sourceText.trim();
  if (sourceText.length < 40) {
    return {
      ok: false,
      error: "Add more source text before generating metadata.",
    };
  }

  const sourceTitle = input.sourceTitle.trim();
  const wikiTitle = input.wikiTitle.trim() || "Untitled wiki";
  const tags = input.tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
  const existingFrontmatter = input.existingFrontmatter.trim();
  const sourceExcerpt =
    sourceText.length <= MAX_FRONTMATTER_SOURCE_CHARS
      ? sourceText
      : `${sourceText.slice(0, MAX_FRONTMATTER_SOURCE_CHARS)}\n\n...[truncated ${sourceText.length - MAX_FRONTMATTER_SOURCE_CHARS} more chars]`;

  const system = [
    "You generate YAML frontmatter for source documents before they are ingested into a wiki knowledge graph.",
    "",
    "Return valid YAML only through the tool. Do not include markdown fences.",
    "The YAML must be a top-level mapping/object, not a list or scalar.",
    "Generate complete YAML frontmatter from the provided source.",
    "Infer chronology, participants, speaker(s), locations, themes, relationships, emotions, canonicality, and whether the knowledge is accessible to the character at that point in their life.",
    "Prefer explicit textual evidence over inference.",
    "When uncertain, lower confidence rather than inventing facts.",
    "Use concise, factual values grounded in the source text and provided context.",
    "Do not invent details that are not supported by the source text or context.",
    "The suggested common keys are optional, not mandatory:",
    SOURCE_FRONTMATTER_KEYS.join(", "),
    "",
    "Prefer these conventions when applicable:",
    "- sequence fields as YAML arrays",
    "- knowledge_accessible as a boolean",
    "- chapter and chronological_order as numbers when clear",
    "- relationships as a nested mapping",
    "- confidence as low, medium, or high",
    "- passage_type when inferable, using one of: primary_narrative, surrounding_narrative_context, commentary, midrash, historical_background, synthetic_memory",
    "- source_type for broad source category, such as primary, commentary, midrash, historical_background, synthetic_memory, reference, transcript, or note",
    "Arbitrary additional valid YAML keys are allowed when useful.",
    "",
    "For character-focused wikis, infer whether knowledge_accessible is true when the character could plausibly know or experience the information in-world, and false when it is curator-only context, later interpretation, narrator-only framing, scholarship, or synthesis unavailable to the character.",
    "If a field cannot be confidently inferred, omit it or set it to null.",
  ].join("\n");

  const userMessage = [
    "<wiki>",
    wikiTitle,
    "</wiki>",
    "",
    "<source-title>",
    sourceTitle || "(not provided)",
    "</source-title>",
    "",
    "<tags>",
    tags.length > 0 ? tags.join(", ") : "(none)",
    "</tags>",
    "",
    "<existing-frontmatter>",
    existingFrontmatter || "(none)",
    "</existing-frontmatter>",
    "",
    "<source-text>",
    sourceExcerpt,
    "</source-text>",
    "",
    "Generate reviewed-draft YAML frontmatter for this source. Preserve useful existing frontmatter fields, improve or add fields when justified by the source text, and leave unsupported fields out.",
    "Infer chronology, participants, speaker(s), locations, themes, relationships, emotions, canonicality, and character-accessible knowledge whenever the evidence supports it. Prefer explicit textual evidence over inference. When uncertain, lower confidence rather than inventing facts.",
  ].join("\n");

  try {
    let result: Awaited<ReturnType<typeof call>> | null = null;
    for (let attempt = 0; attempt <= LLM_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        result = await call({
          model: "claude-haiku-4-5",
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: [
            {
              name: "generate_frontmatter",
              description:
                "Return valid YAML frontmatter for the source document.",
              input_schema: {
                type: "object",
                properties: {
                  yaml: {
                    type: "string",
                    description:
                      "Valid YAML top-level mapping. No markdown fences.",
                  },
                },
                required: ["yaml"],
              },
            },
          ],
          toolChoice: { type: "tool", name: "generate_frontmatter" },
          maxTokens: 1200,
        });
        break;
      } catch (err: unknown) {
        const retryDelay = LLM_RETRY_DELAYS_MS[attempt];
        if (retryDelay !== undefined && isProviderOverloadedError(err)) {
          await sleep(retryDelay);
          continue;
        }
        throw err;
      }
    }

    if (!result) {
      throw new Error("Metadata generation did not return a response.");
    }

    const out = extractToolUse<{ yaml: string }>(
      result,
      "generate_frontmatter",
    );
    const frontmatter = cleanGeneratedYaml(out.yaml);
    const parsed = parseSourceFrontmatter(frontmatter);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    return { ok: true, data: { frontmatter } };
  } catch (err: unknown) {
    return { ok: false, error: formatLlmError(err) };
  }
}

function cleanGeneratedYaml(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  return raw
    .replace(/^```(?:ya?ml)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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
