"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCharacterStore,
  getWikiStore,
  getWikisStore,
  isValidSlug,
  slugifyTitle,
  type Contradiction,
  type EraConfig,
  type Frontmatter,
  type Perspective,
  type TimeIndex,
  type UpdateCharacterInput,
  type VoiceSettingsOverride,
  type WikiPageType,
} from "@odyssey/db";
import { embedText, EMBEDDING_MODEL } from "@odyssey/engine";
import { call, extractToolUse } from "@odyssey/wiki-ingest";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

/** Hooks passed to wiki.savePage so writes get a fresh embedding when the
 * textual content materially changes. Single shared object so manual edits,
 * imports, and ingestion-pipeline writes use the same model. */
const wikiSaveHooks = { embed: embedText, embeddingModel: EMBEDDING_MODEL };

/* ── Shared result shapes ──────────────────────────────────────── */

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ── Create ────────────────────────────────────────────────────── */

export async function createCharacter(input: {
  title: string;
  slug?: string;
  summary?: string;
  brief?: string;
  ingestionPrompt?: string;
  eras?: EraConfig[];
}): Promise<ActionResult<{ slug: string }>> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required." };

  let slug = (input.slug?.trim() || slugifyTitle(title)).toLowerCase();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error:
        "Slug must be lowercase kebab-case, start with a letter, 2–64 chars.",
    };
  }

  const store = getCharacterStore();
  const existing = await store.getBySlug(slug);
  if (existing) {
    return { ok: false, error: `Slug "${slug}" is already taken.` };
  }

  // Normalize eras: trim, dedupe keys, reindex order 0..N-1.
  const normalizedEras = normalizeEras(input.eras ?? []);

  const character = await store.create({
    slug,
    title,
    summary: input.summary?.trim() || undefined,
    brief: input.brief?.trim() || undefined,
    ingestionPrompt: input.ingestionPrompt?.trim() || undefined,
    eras: normalizedEras,
  });

  revalidatePath("/characters");
  invalidateCharactersList();
  redirect(`/characters/${character.id}`);
}

export async function createUnnamedCharacter(): Promise<ActionResult<{ id: string }>> {
  const store = getCharacterStore();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug = `character-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const existing = await store.getBySlug(slug);
    if (existing) continue;

    const character = await store.create({
      slug,
      title: "Untitled character",
      summary: undefined,
      eras: [],
    });

    revalidatePath("/characters");
    invalidateCharactersList();
    redirect(`/characters/${character.id}`);
  }

  return { ok: false, error: "Could not create a unique character. Try again." };
}

function normalizeEras(eras: EraConfig[]): EraConfig[] {
  const seen = new Set<string>();
  const cleaned: EraConfig[] = [];
  for (const e of eras) {
    const key = e.key?.trim();
    const title = e.title?.trim();
    if (!key || !title) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ key, title, order: e.order ?? 0 });
  }
  return cleaned
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ ...e, order: i }));
}

/* ── Update ────────────────────────────────────────────────────── */

export async function updateCharacterIngestionPrompt(
  id: string,
  ingestionPrompt: string,
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  await store.update(id, { ingestionPrompt: ingestionPrompt.trim() || null } as UpdateCharacterInput);
  revalidatePath(`/characters/${existing.slug}`);
  revalidatePath("/characters");
  invalidateCharactersList();
  return { ok: true };
}

export async function updateCharacterEras(
  id: string,
  eras: EraConfig[],
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  // Normalize: sort by order, reindex 0..N-1 to keep it dense.
  const normalized = [...eras]
    .sort((a, b) => a.order - b.order)
    .map((e, i) => ({ ...e, order: i }));
  await store.update(id, { eras: normalized });
  revalidatePath(`/characters/${existing.slug}`);
  return { ok: true };
}

export async function updateCharacterMeta(
  id: string,
  meta: {
    title?: string;
    summary?: string;
    image?: string | null;
    thumbnailColor?: string | null;
  },
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  const patch: UpdateCharacterInput = {};
  if (meta.title !== undefined) {
    const t = meta.title.trim();
    if (!t) return { ok: false, error: "Title cannot be empty." };
    patch.title = t;
  }
  if (meta.summary !== undefined) patch.summary = meta.summary.trim() || null;
  if (meta.image !== undefined) patch.image = meta.image;
  if (meta.thumbnailColor !== undefined) patch.thumbnailColor = meta.thumbnailColor;
  await store.update(id, patch);
  revalidatePath(`/characters/${existing.slug}`);
  revalidatePath(`/characters/${existing.id}`);
  revalidatePath("/characters");
  invalidateCharactersList();
  invalidateCharacterDetail(existing.id);
  return { ok: true };
}

/* ── Voice settings override ──────────────────────────────────── */

/**
 * Per-binding override of the bound voice's runtime tuning. `null` clears
 * the override (inherit the voice row's `providerConfig` as-is); a non-
 * null value overlays specific fields at synth time. Provider-keyed so
 * the engine resolver can narrow safely.
 */
export async function updateCharacterVoiceSettings(
  id: string,
  voiceSettings: VoiceSettingsOverride | null,
): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  await store.update(id, { voiceSettings });
  revalidatePath(`/characters/${existing.slug}`);
  return { ok: true };
}

/* ── Rebuild edges (safety valve) ──────────────────────────────── */

export async function rebuildCharacterEdges(
  id: string,
): Promise<ActionResult<{ added: number; removed: number }>> {
  const wiki = getWikiStore();
  const result = await wiki.rebuildEdges(id);
  const existing = await getCharacterStore().getById(id);
  if (existing) revalidatePath(`/characters/${existing.slug}`);
  return { ok: true, data: result };
}

export async function recomputeKnowledgeLayout(
  id: string,
): Promise<ActionResult<{ updated: number }>> {
  const { computeKnowledgeLayout } = await import("@/lib/kg-layout");
  const wiki = getWikiStore();
  const pages = await wiki.listPages(id);
  // Cold recompute — ignore existing seeds so the layout fully re-settles.
  const layout = computeKnowledgeLayout(
    pages.map((p) => ({ id: p.id, slug: p.slug, embedding: p.embedding, seed: null })),
  );
  const result = await wiki.saveLayout(id, layout);
  const existing = await getCharacterStore().getById(id);
  if (existing) revalidatePath(`/characters/${existing.slug}/knowledge`);
  return { ok: true, data: result };
}

/* ── Wiki pages ───────────────────────────────────────────────── */

export type UpdateWikiPageInput = {
  title: string;
  summary: string | null;
  body: string;
  /** Page type — reads only, cannot change (changing invalidates frontmatter). */
  type: WikiPageType;
  /** Immutable slug the caller supplies so the server can double-check identity. */
  slug: string;
  frontmatter: Frontmatter;
  perspective: Perspective;
  confidence: number;
  timeIndex: TimeIndex | null;
  knowsFuture: boolean;
  contradictions: Contradiction[];
};

export async function updateWikiPage(
  characterId: string,
  pageId: string,
  input: UpdateWikiPageInput,
): Promise<ActionResult<{ slug: string }>> {
  const wiki = getWikiStore();
  const existing = await wiki.getPage(pageId);
  if (!existing || existing.characterId !== characterId) {
    return { ok: false, error: "Page not found for this character." };
  }
  if (existing.slug !== input.slug) {
    return { ok: false, error: "Slug mismatch — reload and try again." };
  }
  if (existing.type !== input.type) {
    return { ok: false, error: "Page type can't change once the page exists." };
  }

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title cannot be empty." };

  const confidence = Math.max(0, Math.min(1, input.confidence));

  // savePage handles material-change detection, version snapshotting, edge
  // reconciliation, and the authorKind / note fields. Pass authorKind:"human"
  // so the version history distinguishes user edits from LLM writes.
  await wiki.savePage({
    characterId,
    type: existing.type,
    slug: existing.slug,
    title,
    summary: input.summary?.trim() ?? null,
    body: input.body,
    frontmatter: input.frontmatter,
    perspective: input.perspective,
    confidence,
    timeIndex: input.timeIndex,
    knowsFuture: input.knowsFuture,
    contradictions: input.contradictions,
    authorKind: "human",
    note: "manual edit from admin UI",
  }, wikiSaveHooks);

  const character = await getCharacterStore().getById(characterId);
  if (character) revalidatePath(`/characters/${character.slug}/wiki`);
  return { ok: true, data: { slug: existing.slug } };
}

/* ── Sources ───────────────────────────────────────────────────── */

/**
 * AI-assisted classification for a pasted source body. Feeds Haiku 4.5 a
 * prefix of the content plus the character's existing tag vocabulary, and
 * returns a suggested {title, kind, tags} trio. The ingestion form fires
 * this on paste when the form is still pristine — the user keeps every
 * field editable, so a bad classification is a small cost.
 */
export type SourceKindClassification =
  | "primary"
  | "commentary"
  | "annotation"
  | "transcript"
  | "reference";

const KIND_DESCRIPTIONS: Record<SourceKindClassification, string> = {
  primary: "foundational source material (scripture, historical text, first-person account)",
  commentary: "third-party analysis or interpretation of primary material",
  annotation: "marginalia, short notes, or remarks keyed to another text",
  transcript: "spoken/recorded material rendered to text (interview, sermon, lecture)",
  reference: "encyclopedic/factual lookup material (timeline, glossary, table)",
};

const MAX_CLASSIFY_CHARS = 4000;
const CLASSIFY_RETRY_DELAYS_MS = [800, 1800];

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isProviderOverloadedError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  const message = err instanceof Error ? err.message : String(err);
  return status === 529 || /529|overloaded_error|overloaded/i.test(message);
}

function formatClassifyError(err: unknown): string {
  if (isProviderOverloadedError(err)) {
    return "Model provider is overloaded. Try regenerate again in a moment.";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Rank a source list's tag vocabulary by frequency (top 40) so the classifier
 * reuses established tags instead of inventing near-duplicates.
 */
function harvestTagVocabulary(
  sources: Array<{ metadata?: Record<string, unknown> | null }>,
): string[] {
  const tagCounts = new Map<string, number>();
  for (const s of sources) {
    const tags = (s.metadata?.tags as string[] | undefined) ?? [];
    for (const t of tags) {
      if (typeof t !== "string" || !t.trim()) continue;
      const norm = t.trim().toLowerCase();
      tagCounts.set(norm, (tagCounts.get(norm) ?? 0) + 1);
    }
  }
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([t]) => t);
}

/** Optional `<character>` context block to bias the title toward the world. */
function buildCharacterContext(character: {
  title: string;
  summary?: string | null;
  ingestionPrompt?: string | null;
}): string {
  return [
    `<character>`,
    `Title: ${character.title}`,
    character.summary ? `Summary: ${character.summary}` : null,
    character.ingestionPrompt
      ? `Ingestion-prompt excerpt: ${character.ingestionPrompt.slice(0, 400)}`
      : null,
    `</character>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Classify a source text for the composer: short title + evidentiary kind +
 * 2–5 domain tags. Wiki-first — the character context is an optional bias,
 * not a requirement, so wikis with no bound character still auto-classify.
 */
export async function classifySourceForWiki(
  wikiId: string,
  content: string,
): Promise<
  ActionResult<{ title: string; kind: SourceKindClassification; tags: string[] }>
> {
  const existingTags = harvestTagVocabulary(
    await getWikiStore().listSourcesForWiki(wikiId),
  );
  // If the wiki has a bound character, bias the title toward it — but a
  // characterless wiki (e.g. William Shakespeare) classifies just fine.
  let characterContext: string | undefined;
  try {
    const bindings = await getWikisStore().listBindingsForWiki(wikiId);
    const primary =
      bindings.find((b) => b.isActive && b.priority === "primary") ??
      bindings.find((b) => b.isActive) ??
      null;
    if (primary) {
      const character = await getCharacterStore().getById(primary.characterId);
      if (character) characterContext = buildCharacterContext(character);
    }
  } catch {
    // Character context is a nicety; never block classification on it.
  }
  return classifyText({ content, existingTags, characterContext });
}

export async function classifySource(
  characterId: string,
  content: string,
): Promise<
  ActionResult<{ title: string; kind: SourceKindClassification; tags: string[] }>
> {
  const character = await getCharacterStore().getById(characterId);
  if (!character) return { ok: false, error: "Character not found." };
  const existingTags = harvestTagVocabulary(
    await getWikiStore().listSources(characterId),
  );
  return classifyText({
    content,
    existingTags,
    characterContext: buildCharacterContext(character),
  });
}

async function classifyText(args: {
  content: string;
  existingTags: string[];
  characterContext?: string;
}): Promise<
  ActionResult<{ title: string; kind: SourceKindClassification; tags: string[] }>
> {
  const trimmed = args.content.trim();
  if (trimmed.length < 80) {
    return { ok: false, error: "Content too short to classify." };
  }
  const existingTags = args.existingTags;

  const snippet =
    trimmed.length <= MAX_CLASSIFY_CHARS
      ? trimmed
      : `${trimmed.slice(0, MAX_CLASSIFY_CHARS)}\n\n…[truncated ${trimmed.length - MAX_CLASSIFY_CHARS} more chars]`;

  const system = [
    "You classify source texts for a simulation engine that ingests knowledge into a character's wiki.",
    "",
    "Produce a short descriptive title, the most appropriate kind, and 2–5 lowercase domain tags.",
    "",
    "Kinds:",
    ...Object.entries(KIND_DESCRIPTIONS).map(
      ([k, d]) => `- "${k}": ${d}`,
    ),
    "",
    "Tag guidance:",
    "- 2–5 tags, lowercase, short (single word or hyphenated).",
    "- Prefer existing tags from the character's vocabulary when the topic matches.",
    "- Avoid the character's own name as a tag unless the tag is specifically about them.",
    "",
    "Title guidance:",
    "- 60 characters max.",
    "- Describe what the text IS (its source or subject), not the character.",
    "- If the text is a named passage (e.g. \"Genesis 22\"), use that; a short descriptive tail is fine.",
  ].join("\n");

  const characterBlock = args.characterContext ?? "";

  const vocabBlock = existingTags.length
    ? `<existing-tags>\n${existingTags.join(", ")}\n</existing-tags>`
    : `<existing-tags>\n(none yet — pick fresh tags)\n</existing-tags>`;

  const userMessage = [
    ...(characterBlock ? [characterBlock] : []),
    vocabBlock,
    `<source-text>`,
    snippet,
    `</source-text>`,
    ``,
    `Classify the source-text above using the classify_source tool.`,
  ].join("\n\n");

  try {
    let result: Awaited<ReturnType<typeof call>> | null = null;
    for (let attempt = 0; attempt <= CLASSIFY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        result = await call({
          model: "claude-haiku-4-5",
          system,
          messages: [{ role: "user", content: userMessage }],
          tools: [
            {
              name: "classify_source",
              description:
                "Return the classification for the provided source text.",
              input_schema: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    description:
                      "Short descriptive title (≤60 chars). Describe the text, not the character.",
                  },
                  kind: {
                    type: "string",
                    enum: [
                      "primary",
                      "commentary",
                      "annotation",
                      "transcript",
                      "reference",
                    ],
                  },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 2,
                    maxItems: 5,
                  },
                },
                required: ["title", "kind", "tags"],
              },
            },
          ],
          toolChoice: { type: "tool", name: "classify_source" },
          maxTokens: 400,
        });
        break;
      } catch (err: unknown) {
        const retryDelay = CLASSIFY_RETRY_DELAYS_MS[attempt];
        if (retryDelay !== undefined && isProviderOverloadedError(err)) {
          await sleep(retryDelay);
          continue;
        }
        throw err;
      }
    }

    if (!result) throw new Error("Classification did not return a response.");

    const out = extractToolUse<{
      title: string;
      kind: SourceKindClassification;
      tags: string[];
    }>(result, "classify_source");

    const title = out.title.trim().slice(0, 120);
    const tags = Array.isArray(out.tags)
      ? out.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toLowerCase())
          .filter((t, i, arr) => t.length > 0 && arr.indexOf(t) === i)
          .slice(0, 5)
      : [];

    return { ok: true, data: { title, kind: out.kind, tags } };
  } catch (err: unknown) {
    return { ok: false, error: formatClassifyError(err) };
  }
}

export async function deleteSource(
  characterId: string,
  sourceId: string,
): Promise<ActionResult<{ pagesRemoved: number; edgesRemoved: number }>> {
  const wiki = getWikiStore();
  const source = await wiki.getSource(sourceId);
  if (!source || source.characterId !== characterId) {
    return { ok: false, error: "Source not found." };
  }
  const result = await wiki.purgeSource(sourceId);
  if (result.sourceRemoved === 0) return { ok: false, error: "Delete failed." };
  const character = await getCharacterStore().getById(characterId);
  if (character) {
    revalidatePath(`/characters/${character.slug}`);
    revalidatePath(`/characters/${character.slug}/sources`);
    revalidatePath(`/characters/${character.slug}/wiki`);
    revalidatePath(`/characters/${character.slug}/ingestion`);
  }
  return {
    ok: true,
    data: { pagesRemoved: result.pagesRemoved, edgesRemoved: result.edgesRemoved },
  };
}

export async function previewPurgeSource(
  characterId: string,
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
  if (!source || source.characterId !== characterId) {
    return { ok: false, error: "Source not found." };
  }
  const impact = await wiki.previewPurgeSource(sourceId);
  return {
    ok: true,
    data: {
      source: {
        title: source.title,
        kind: source.kind,
        hashPrefix: (source.contentHash ?? "").slice(0, 8),
      },
      pagesRemoved: impact.pagesRemoved,
      edgesRemoved: impact.edgesRemoved,
    },
  };
}

export async function previewPurgeIngestionRun(
  characterId: string,
  runId: string,
): Promise<
  ActionResult<{
    source: { title: string; kind: string; hashPrefix: string } | null;
    sourceShared: boolean;
    pagesRemoved: number;
    edgesRemoved: number;
  }>
> {
  const character = await getCharacterStore().getById(characterId);
  if (!character) return { ok: false, error: "Character not found." };

  const wiki = getWikiStore();
  const runs = await wiki.listIngestionRuns(characterId, 1000);
  const run = runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "Run not found." };

  if (!run.sourceId) {
    return {
      ok: true,
      data: { source: null, sourceShared: false, pagesRemoved: 0, edgesRemoved: 0 },
    };
  }

  const sourceShared = runs.some((r) => r.id !== runId && r.sourceId === run.sourceId);
  const source = await wiki.getSource(run.sourceId);
  if (!source) {
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
        hashPrefix: (source.contentHash ?? "").slice(0, 8),
      },
      sourceShared,
      pagesRemoved: impact.pagesRemoved,
      edgesRemoved: impact.edgesRemoved,
    },
  };
}

export async function purgeIngestionRun(
  characterId: string,
  runId: string,
): Promise<
  ActionResult<{
    sourceRemoved: number;
    pagesRemoved: number;
    edgesRemoved: number;
  }>
> {
  const character = await getCharacterStore().getById(characterId);
  if (!character) return { ok: false, error: "Character not found." };
  const result = await getWikiStore().purgeIngestionRun(runId);
  if (result.runRemoved === 0) return { ok: false, error: "Run not found." };
  revalidatePath(`/characters/${character.slug}`);
  revalidatePath(`/characters/${character.slug}/sources`);
  revalidatePath(`/characters/${character.slug}/wiki`);
  revalidatePath(`/characters/${character.slug}/ingestion`);
  return {
    ok: true,
    data: {
      sourceRemoved: result.sourceRemoved,
      pagesRemoved: result.pagesRemoved,
      edgesRemoved: result.edgesRemoved,
    },
  };
}

/* ── Delete ────────────────────────────────────────────────────── */

export async function resetCharacterData(id: string): Promise<
  ActionResult<{
    pagesRemoved: number;
    edgesRemoved: number;
    sourcesRemoved: number;
    runsRemoved: number;
  }>
> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  const result = await getWikiStore().resetCharacterData(id);
  revalidatePath(`/characters/${existing.slug}`);
  revalidatePath(`/characters/${existing.slug}/wiki`);
  revalidatePath(`/characters/${existing.slug}/sources`);
  revalidatePath(`/characters/${existing.slug}/ingestion`);
  return { ok: true, data: result };
}

export async function deleteCharacter(id: string): Promise<ActionResult> {
  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return { ok: false, error: "Character not found." };
  await store.remove(id);
  revalidatePath("/characters");
  invalidateCharactersList();
  redirect("/characters");
}
