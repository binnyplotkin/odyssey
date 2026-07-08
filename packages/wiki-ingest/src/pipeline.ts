/**
 * Ingestion pipeline orchestrator.
 *
 * Wires the planner, writer, and wiki-store together into a single
 * async-iterable run. The FE consumes the event stream over SSE to render
 * the live-run view on the Ingestion tab.
 *
 * Shape of a run:
 *   1. Load character, source, existing wiki.
 *   2. Open a wiki_ingestion_log row (status=running).
 *   3. Call planner → receive ops.
 *   4. Run writer calls with bounded concurrency.
 *   5. Persist each completed page and reconcile edges after all pages exist.
 *   6. Close the log row with final counters.
 */

import {
  deriveSourceTypeFromKind,
  getWikiStore,
  getWikisStore,
  type SavePageInput,
  type WikiStore,
  type WikiPageRecord,
  wikiEmbeddingSource,
} from "@odyssey/db";
import { loadWikiContext } from "./context";
import { DEFAULT_MODEL, resolveModel, type ModelId } from "./models";
import { plan, PlanTruncatedError } from "./planner";
import {
  applyExclusions,
  attributionsForRef,
  explodeCitations,
  resolveExcludeRanges,
  survey,
} from "./survey";
import {
  ENGINE_INSTRUCTIONS_PLANNER,
  ENGINE_INSTRUCTIONS_WRITER,
} from "./prompts";
import { write, WriterToolUseError } from "./writer";
import type {
  IngestionEvent,
  IngestionInput,
  IngestionResult,
  OpPlan,
  PlanOp,
  WrittenPage,
} from "./types";

const PLANNER_CHUNK_CHAR_BUDGET = 24_000;
const DEFAULT_WRITER_CONCURRENCY = 3;
const MAX_WRITER_CONCURRENCY = 6;
/** Above this, the writer falls back to planner passages only — the full
 * source would dominate the context. ~12k tokens; cheap once prompt-cached. */
const WRITER_SOURCE_CHAR_BUDGET = 48_000;
/** Plans below this confidence get a note on the run log (not a gate). */
const LOW_PLAN_CONFIDENCE = 0.6;

export async function* runIngestion(
  input: IngestionInput,
): AsyncGenerator<IngestionEvent, void, void> {
  const model: ModelId = resolveModel(input.model ?? DEFAULT_MODEL);
  const wiki = getWikiStore();
  const wikis = getWikisStore();

  // ── Load context ─────────────────────────────────────────────
  const wikiRecord = await wikis.getWikiById(input.wikiId);
  if (!wikiRecord) {
    yield {
      type: "failed",
      error: `wiki not found: ${input.wikiId}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    return;
  }

  const source = await wiki.getSource(input.sourceId);
  if (!source || source.wikiId !== input.wikiId) {
    yield {
      type: "failed",
      error: `source not found or mismatched wiki: ${input.sourceId}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    return;
  }

  // STUB sources (nested provenance) are citation-only — nothing to ingest
  // until hydrated (P2). Narrows `content` to string for the rest of the run.
  const sourceContent = source.content;
  if (sourceContent == null) {
    yield {
      type: "failed",
      error: `source is a citation stub with no content (hydrate it before ingesting): ${input.sourceId}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    return;
  }

  const sourceTags = extractTags(source.metadata);
  const wikiContext = await loadWikiContext(wikiRecord);
  // Version stamp for the run log: covers the FULL prompt surface the models
  // see (engine instructions, injected wiki context, domain prompt) — not
  // just the domain prompt, so engine changes are distinguishable in logs.
  const promptHash = await shortSha(
    [
      ENGINE_INSTRUCTIONS_PLANNER,
      ENGINE_INSTRUCTIONS_WRITER,
      wikiContext,
      wikiRecord.ingestionPrompt ?? "",
    ].join("\n\0\n"),
  );

  // ── Resolve/open the run log row ─────────────────────────────
  const existingRun = input.runId ? await wiki.getIngestionRun(input.runId) : null;
  if (
    input.runId &&
    (!existingRun ||
      existingRun.wikiId !== wikiRecord.id ||
      existingRun.sourceId !== source.id)
  ) {
    yield {
      type: "failed",
      error: `ingestion run not found or mismatched wiki: ${input.runId}`,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    return;
  }

  const logRow = existingRun ?? await wiki.startIngestion({
    wikiId: wikiRecord.id,
    sourceId: source.id,
    model,
    promptHash,
    notes: input.dryRun ? "dry run" : null,
  });

  yield { type: "started", runId: logRow.id, model };

  let totalTokens = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let totalEdgesAdded = 0;
  let totalEdgesRemoved = 0;
  const opFailures: string[] = [];

  try {
    // ── Load existing wiki ─────────────────────────────────────
    const existingPages = await wiki.listPagesForWiki(wikiRecord.id);
    const existingEdges = await wiki.listWikiEdges(wikiRecord.id);

    yield {
      type: "loaded-index",
      pageCount: existingPages.length,
      edgeCount: existingEdges.length,
    };

    const isRetryRun = input.retryOps !== undefined;

    // ── Survey (nested provenance P1, opt-in) ──────────────────
    // Classify the document's anatomy; explode a citing document's
    // bibliography into stub sources + citation edges; strip non-content
    // sections from what the PLANNER sees (the writer keeps the original).
    let plannerContent = sourceContent;
    let markerMap = new Map<string, string>();
    if (input.survey && !isRetryRun) {
      const surveyed = await survey({
        model,
        source: { title: source.title, content: sourceContent },
      });
      totalTokens += surveyed.tokens;
      totalInputTokens += surveyed.inputTokens;
      totalOutputTokens += surveyed.outputTokens;
      totalCacheReadTokens += surveyed.cacheReadTokens;
      totalCacheWriteTokens += surveyed.cacheWriteTokens;

      // Relocate what the composer's Classify tab used to author: the
      // document's OWN citation + browse facets, filled from the survey.
      // Additive (never clobbers human input) and best-effort — browse
      // metadata must never fail an ingestion.
      try {
        await wiki.enrichSourceClassify(source.id, {
          citation: surveyed.selfCitation,
          facets: surveyed.selfFacets,
        });
      } catch (err) {
        console.warn(
          `[survey] enrichSourceClassify failed for ${source.id}:`,
          err instanceof Error ? err.message : err,
        );
      }

      let stubsOrMatches = 0;
      let skippedThin = 0;
      let excludedRanges: Array<{ start: number; end: number; reason: string }> = [];
      if (surveyed.anatomy !== "direct") {
        const exploded = await explodeCitations({
          store: wiki,
          wikiId: wikiRecord.id,
          carrierId: source.id,
          bibliography: surveyed.bibliography,
          content: sourceContent,
        });
        markerMap = exploded.markerMap;
        stubsOrMatches = exploded.stubsOrMatches;
        skippedThin = exploded.skippedThin;
        excludedRanges = resolveExcludeRanges(
          sourceContent,
          surveyed.excludeSections,
        );
        plannerContent = applyExclusions(sourceContent, excludedRanges);
      }

      yield {
        type: "survey-complete",
        anatomy: surveyed.anatomy,
        citedWorks: surveyed.bibliography.length,
        stubsOrMatches,
        skippedThin,
        markersMapped: markerMap.size,
        excludedSections: excludedRanges.length,
        tokens: surveyed.tokens,
        inputTokens: surveyed.inputTokens,
        outputTokens: surveyed.outputTokens,
      };
    }

    // ── Plan ───────────────────────────────────────────────────
    yield { type: "planning" };

    const retryOps = (input.retryOps ?? []).filter((o) => o.action !== "skip");
    const opPlan = isRetryRun
      ? buildRetryPlan(retryOps)
      : await planChunked({
          model,
          characterDomainPrompt: wikiRecord.ingestionPrompt,
          wikiContext,
          source: {
            title: source.title,
            sourceType:
              source.sourceType ?? deriveSourceTypeFromKind(source.kind),
            tags: sourceTags,
            content: plannerContent,
          },
          existingPages,
        });
    totalTokens += opPlan.tokens;
    totalInputTokens += opPlan.inputTokens;
    totalOutputTokens += opPlan.outputTokens;
    totalCacheReadTokens += opPlan.cacheReadTokens;
    totalCacheWriteTokens += opPlan.cacheWriteTokens;

    // ── Execute ops (excluding "skip") ─────────────────────────
    const actionableOps = opPlan.ops.filter((o) => o.action !== "skip");

    // Low planner confidence doesn't gate the run (the ops still execute)
    // but it must not vanish either: it rides the plan-complete event and
    // lands on the run log so shaky runs are auditable in history.
    const confidenceNote =
      opPlan.confidence < LOW_PLAN_CONFIDENCE
        ? `low plan confidence: ${opPlan.confidence.toFixed(2)}`
        : undefined;

    yield {
      type: "plan-complete",
      opCount: actionableOps.length,
      contradictionCount: opPlan.contradictions.length,
      confidence: opPlan.confidence,
      contradictions: opPlan.contradictions,
      tokens: opPlan.tokens,
      inputTokens: opPlan.inputTokens,
      outputTokens: opPlan.outputTokens,
      ops: actionableOps,
    };

    const existingById = new Map(existingPages.map((p) => [p.id, p]));
    const existingSlugToId = new Map(existingPages.map((p) => [p.slug, p.id]));
    const writerContextPages = buildWriterContextPages(
      existingPages,
      wikiRecord.id,
      actionableOps,
    );
    const writerConcurrency = resolveWriterConcurrency(input.writerConcurrency);
    const writerSourceContent =
      sourceContent.trim().length <= WRITER_SOURCE_CHAR_BUDGET
        ? sourceContent
        : null;
    // Prompt-cache warm-up: the writers share a cached system prefix
    // (instructions + source document), but the cache entry only exists once
    // the first call finishes. Run op 0 solo so ops 1..N hit the cache
    // instead of all paying the full prefix concurrently.
    let cacheWarm = actionableOps.length <= 1;
    const inFlight = new Map<number, Promise<WriteTaskResult>>();
    const savedPages: Array<{ op: PlanOp; written: WrittenPage; page: WikiPageRecord }> = [];
    const pagesNeedingEmbedding = new Map<string, WikiPageRecord>();
    let nextOpIndex = 0;

    const startWriter = (index: number) => {
      const op = actionableOps[index];
      const existingPage = op.existingPageId
        ? existingById.get(op.existingPageId) ?? null
        : null;
      const task = write({
        model,
        characterDomainPrompt: wikiRecord.ingestionPrompt,
        wikiContext,
        op,
        source: {
          title: source.title,
          tags: sourceTags,
          content: writerSourceContent,
        },
        existingPage,
        allPages: writerContextPages,
        slugToId: existingSlugToId,
        plannerContradictions: opPlan.contradictions.filter(
          (c) => c.slugA === op.slug || c.slugB === op.slug,
        ),
      })
        .then((written): WriteTaskResult => ({ index, op, existingPage, written }))
        .catch((error: unknown): WriteTaskResult => ({
          index,
          op,
          existingPage,
          error,
        }));
      inFlight.set(index, task);
    };

    while (nextOpIndex < actionableOps.length || inFlight.size > 0) {
      const concurrencyLimit = cacheWarm ? writerConcurrency : 1;
      while (
        nextOpIndex < actionableOps.length &&
        inFlight.size < concurrencyLimit
      ) {
        const op = actionableOps[nextOpIndex];
        yield {
          type: "op-start",
          op,
          index: nextOpIndex,
          total: actionableOps.length,
        };
        startWriter(nextOpIndex);
        nextOpIndex++;
      }

      if (inFlight.size === 0) break;

      const result = await Promise.race(inFlight.values());
      inFlight.delete(result.index);
      // First writer call has completed (success or not) — the shared prefix
      // is cached now, so the rest can fan out at full concurrency.
      cacheWarm = true;

      if ("error" in result) {
        const msg =
          result.error instanceof Error ? result.error.message : String(result.error);
        let failedUsage:
          | { tokens: number; inputTokens: number; outputTokens: number }
          | null = null;
        if (result.error instanceof WriterToolUseError) {
          failedUsage = {
            tokens: result.error.tokens,
            inputTokens: result.error.inputTokens,
            outputTokens: result.error.outputTokens,
          };
          totalTokens += failedUsage.tokens;
          totalInputTokens += failedUsage.inputTokens;
          totalOutputTokens += failedUsage.outputTokens;
        }
        opFailures.push(`${result.op.slug}: ${msg}`);
        yield {
          type: "op-failed",
          op: result.op,
          error: msg,
          ...(failedUsage ?? {}),
        };
        continue;
      }

      const { op, written, existingPage } = result;
      totalTokens += written.tokens;
      totalInputTokens += written.inputTokens;
      totalOutputTokens += written.outputTokens;
      totalCacheReadTokens += written.cacheReadTokens;
      totalCacheWriteTokens += written.cacheWriteTokens;

      try {
        if (input.dryRun) {
          yield {
            type: "op-complete",
            op,
            page: buildDryRunPage(wikiRecord.id, written, existingPage),
            edgesAdded: 0,
            edgesRemoved: 0,
            tokens: written.tokens,
            inputTokens: written.inputTokens,
            outputTokens: written.outputTokens,
          };
          continue;
        }

        const saveResult = await wiki.savePage(
          buildSavePageInput(wikiRecord.id, logRow.id, op, written),
        );

        if (saveResult.created) pagesCreated++;
        else if (saveResult.versionCreated) pagesUpdated++;
        if (saveResult.created || saveResult.versionCreated) {
          pagesNeedingEmbedding.set(saveResult.page.id, saveResult.page);
        }

        totalEdgesAdded += saveResult.edgesAdded;
        totalEdgesRemoved += saveResult.edgesRemoved;

        if (written.sourceRefs.length > 0) {
          await wiki.addSourceRefs(
            written.sourceRefs.flatMap((r) => {
              const base = {
                pageId: saveResult.page.id,
                sourceId: source.id,
                passage: r.passage,
                quote: r.quote,
                relevanceNote: r.relevanceNote,
              };
              // Nested provenance: a passage carrying an inline marker
              // ("[8]") attributes its claim to the cited work. Mechanical
              // string match against the survey's marker map — no LLM
              // judgment. Multiple markers → one ref row per attribution.
              const attributed = attributionsForRef(r, markerMap);
              if (attributed.length === 0) return [base];
              return attributed.map((attributedSourceId) => ({
                ...base,
                attributedSourceId,
              }));
            }),
          );
        }

        savedPages.push({ op, written, page: saveResult.page });

        yield {
          type: "op-complete",
          op,
          page: saveResult.page,
          edgesAdded: saveResult.edgesAdded,
          edgesRemoved: saveResult.edgesRemoved,
          tokens: written.tokens,
          inputTokens: written.inputTokens,
          outputTokens: written.outputTokens,
        };
      } catch (opErr: unknown) {
        const msg = opErr instanceof Error ? opErr.message : String(opErr);
        opFailures.push(`${op.slug}: ${msg}`);
        yield { type: "op-failed", op, error: msg };
      }
    }

    // Parallel writers can link to pages that were planned but not saved yet.
    // Reconcile edges after all pages exist so the slug index is complete.
    if (!input.dryRun && savedPages.length > 1) {
      const reconcileResult = await wiki.reconcileEdgesForWikiPages(
        wikiRecord.id,
        savedPages.map((saved) => saved.page.id),
      );
      totalEdgesAdded += reconcileResult.added;
      totalEdgesRemoved += reconcileResult.removed;
    }

    if (!input.dryRun && pagesNeedingEmbedding.size > 0) {
      await embedChangedPages({
        wiki,
        pages: Array.from(pagesNeedingEmbedding.values()),
        embed: input.embed,
        embedMany: input.embedMany,
        embeddingModel: input.embeddingModel,
      });
    }

    // ── Finalize ───────────────────────────────────────────────
    yield {
      type: "edges-reconciled",
      added: totalEdgesAdded,
      removed: totalEdgesRemoved,
    };

    if (opFailures.length > 0) {
      const errorMessage = `Failed ${opFailures.length} op(s): ${opFailures.join("; ")}`;
      if (!input.dryRun) {
        await wiki.finishIngestion(logRow.id, {
          status: "failed",
          pagesCreated,
          pagesUpdated,
          edgesAdded: totalEdgesAdded,
          contradictionsFound: opPlan.contradictions.length,
          tokensUsed: totalTokens,
          errorMessage,
          notes: confidenceNote,
        });
      }
      yield {
        type: "failed",
        error: errorMessage,
        tokensUsed: totalTokens,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
      return;
    }

    const result: IngestionResult = {
      runId: logRow.id,
      status: "succeeded",
      pagesCreated,
      pagesUpdated,
      edgesAdded: totalEdgesAdded,
      edgesRemoved: totalEdgesRemoved,
      contradictionsFound: opPlan.contradictions.length,
      tokensUsed: totalTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheWriteTokens: totalCacheWriteTokens,
      model,
    };

    if (!input.dryRun) {
      await wiki.finishIngestion(logRow.id, {
        status: "succeeded",
        pagesCreated,
        pagesUpdated,
        edgesAdded: totalEdgesAdded,
        contradictionsFound: opPlan.contradictions.length,
        tokensUsed: totalTokens,
        notes: confidenceNote,
      });
    }

    yield { type: "succeeded", result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await wiki.finishIngestion(logRow.id, {
      status: "failed",
      pagesCreated,
      pagesUpdated,
      edgesAdded: totalEdgesAdded,
      tokensUsed: totalTokens,
      errorMessage: msg,
    });
    yield {
      type: "failed",
      error: msg,
      tokensUsed: totalTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

type WriteTaskResult =
  | {
      index: number;
      op: PlanOp;
      existingPage: WikiPageRecord | null;
      written: WrittenPage;
    }
  | {
      index: number;
      op: PlanOp;
      existingPage: WikiPageRecord | null;
      error: unknown;
    };

function resolveWriterConcurrency(input: number | undefined): number {
  const raw = input ?? Number(process.env.WIKI_INGEST_WRITER_CONCURRENCY ?? "");
  const parsed =
    Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_WRITER_CONCURRENCY;
  return Math.max(1, Math.min(MAX_WRITER_CONCURRENCY, parsed));
}

function buildRetryPlan(ops: PlanOp[]): OpPlan {
  return {
    ops,
    contradictions: [],
    confidence: 1,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function buildSavePageInput(
  wikiId: string,
  runId: string,
  op: PlanOp,
  written: WrittenPage,
): SavePageInput {
  return {
    wikiId,
    type: written.type,
    slug: written.slug,
    title: written.title,
    summary: written.summary,
    body: written.body,
    frontmatter: written.frontmatter,
    perspective: written.perspective,
    confidence: written.confidence,
    timeIndex: written.timeIndex,
    knowsFuture: written.knowsFuture,
    contradictions: written.contradictions,
    authorKind: "llm",
    authorId: runId,
    note: `ingest: ${op.rationale.slice(0, 120)}`,
  };
}

function buildWriterContextPages(
  existingPages: WikiPageRecord[],
  wikiId: string,
  ops: PlanOp[],
): WikiPageRecord[] {
  const bySlug = new Map(existingPages.map((page) => [page.slug, page]));
  const out = [...existingPages];
  const now = new Date().toISOString();

  for (const op of ops) {
    if (bySlug.has(op.slug)) continue;
    const page: WikiPageRecord = {
      id: `planned-${op.slug}`,
      characterId: "",
      wikiId,
      type: op.type,
      slug: op.slug,
      title: op.title,
      summary: op.rationale,
      body: "",
      frontmatter: {},
      perspective: {},
      confidence: 0.5,
      timeIndex: null,
      knowsFuture: false,
      contradictions: [],
      version: 0,
      lastCompiledAt: null,
      embedding: null,
      embeddingModel: null,
      embeddedAt: null,
      layoutX: null,
      layoutY: null,
      layoutComputedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    bySlug.set(op.slug, page);
    out.push(page);
  }

  return out;
}

async function embedChangedPages(args: {
  wiki: WikiStore;
  pages: WikiPageRecord[];
  embed?: (text: string) => Promise<number[] | null>;
  embedMany?: (texts: string[]) => Promise<Array<number[] | null>>;
  embeddingModel?: string;
}): Promise<void> {
  const embeddingModel = args.embeddingModel ?? "unspecified";
  const texts = args.pages.map((page) => wikiEmbeddingSource(page));
  if (!args.embedMany && !args.embed) return;

  try {
    const vectors = args.embedMany
      ? await args.embedMany(texts)
      : await Promise.all(texts.map((text) => args.embed!(text)));

    const updates = args.pages.flatMap((page, index) => {
      const embedding = vectors[index];
      return embedding ? [{ pageId: page.id, embedding, embeddingModel }] : [];
    });

    if (updates.length > 0) {
      await args.wiki.savePageEmbeddings(updates);
    }
  } catch (error) {
    console.error(
      "[wiki-ingest] batch embedding failed; pages saved without embeddings",
      error,
    );
  }
}

// Exported for tests/evals — the public ingestion path is runIngestion().
export async function planChunked(args: {
  model: ModelId;
  characterDomainPrompt: string | null;
  wikiContext: string | null;
  source: {
    title: string;
    sourceType: string;
    tags: string[];
    content: string;
  };
  existingPages: WikiPageRecord[];
}): Promise<OpPlan> {
  const chunks = splitSourceForPlanning(args.source.content);

  const plans: OpPlan[] = [];
  // Cross-chunk slug memory: each chunk sees the slugs earlier chunks
  // claimed, so the same entity gets the same slug in every chunk instead
  // of drifting variants that mergeChunkPlans can't reconcile.
  const plannedSoFar = new Map<string, PlanOp>();
  for (let i = 0; i < chunks.length; i++) {
    const title =
      chunks.length > 1
        ? `${args.source.title} (part ${i + 1} of ${chunks.length})`
        : args.source.title;
    plans.push(
      ...(await planChunkWithSplit(args, chunks[i], title, plannedSoFar, 0)),
    );
  }

  // Single complete plan → return as-is (preserves its exact confidence);
  // multiple (chunked and/or split) → merge.
  return plans.length === 1 ? plans[0] : mergeChunkPlans(plans, args.existingPages);
}

/** Truncation-split depth cap: 24k-char chunks → 12k → 6k. A 6k-char piece
 * that still overflows the planner budget is pathological — fail loudly. */
const MAX_PLAN_SPLIT_DEPTH = 2;

/**
 * Plan one chunk; if the planner's output hits max_tokens (op-dense content —
 * e.g. a chronology table planning 25+ event pages), split the chunk at a
 * paragraph boundary and re-plan each half. Slug memory threads through the
 * recursion so the second half sees the first half's slugs.
 */
async function planChunkWithSplit(
  args: {
    model: ModelId;
    characterDomainPrompt: string | null;
    wikiContext: string | null;
    source: { title: string; sourceType: string; tags: string[]; content: string };
    existingPages: WikiPageRecord[];
  },
  content: string,
  title: string,
  plannedSoFar: Map<string, PlanOp>,
  depth: number,
): Promise<OpPlan[]> {
  try {
    const chunkPlan = await plan({
      ...args,
      source: { ...args.source, title, content },
      plannedSoFar: Array.from(plannedSoFar.values()),
    });
    for (const op of chunkPlan.ops) {
      if (op.action !== "skip" && !plannedSoFar.has(op.slug)) {
        plannedSoFar.set(op.slug, op);
      }
    }
    return [chunkPlan];
  } catch (err) {
    if (!(err instanceof PlanTruncatedError) || depth >= MAX_PLAN_SPLIT_DEPTH) {
      throw err;
    }
    const mid = findPlanSplitPoint(content);
    const head = content.slice(0, mid).trim();
    const tail = content.slice(mid).trim();
    if (!head || !tail) throw err;
    console.warn(
      `[wiki-ingest] planner output truncated on "${title}" (${content.length} chars) — splitting and re-planning`,
    );
    return [
      ...(await planChunkWithSplit(args, head, `${title} (split a)`, plannedSoFar, depth + 1)),
      ...(await planChunkWithSplit(args, tail, `${title} (split b)`, plannedSoFar, depth + 1)),
    ];
  }
}

/** Nearest paragraph boundary to the midpoint; falls back to line break,
 * then the raw midpoint. */
function findPlanSplitPoint(content: string): number {
  const mid = Math.floor(content.length / 2);
  const window = Math.floor(content.length / 4);
  for (const sep of ["\n\n", "\n"]) {
    const after = content.indexOf(sep, mid);
    const before = content.lastIndexOf(sep, mid);
    const candidates = [after, before].filter(
      (idx) => idx !== -1 && Math.abs(idx - mid) <= window,
    );
    if (candidates.length > 0) {
      return candidates.reduce((best, idx) =>
        Math.abs(idx - mid) < Math.abs(best - mid) ? idx : best,
      );
    }
  }
  return mid;
}

function splitSourceForPlanning(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.length <= PLANNER_CHUNK_CHAR_BUDGET) return [trimmed];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    const hardEnd = Math.min(cursor + PLANNER_CHUNK_CHAR_BUDGET, trimmed.length);
    if (hardEnd === trimmed.length) {
      chunks.push(trimmed.slice(cursor).trim());
      break;
    }

    const window = trimmed.slice(cursor, hardEnd);
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(" "),
    ];
    const breakAt = Math.max(...candidates);
    const minUseful = Math.floor(PLANNER_CHUNK_CHAR_BUDGET * 0.6);
    const end = breakAt >= minUseful ? cursor + breakAt + 1 : hardEnd;
    chunks.push(trimmed.slice(cursor, end).trim());
    cursor = end;
  }

  return chunks.filter(Boolean);
}

function mergeChunkPlans(plans: OpPlan[], existingPages: WikiPageRecord[]): OpPlan {
  const existingBySlug = new Map(existingPages.map((page) => [page.slug, page]));
  const merged = new Map<string, PlanOp>();

  for (const planResult of plans) {
    for (const op of planResult.ops) {
      const prior = merged.get(op.slug);
      if (!prior) {
        merged.set(op.slug, resolvePlanOpScope(op, existingBySlug));
        continue;
      }

      const existing = existingBySlug.get(op.slug);
      const preferredAction = chooseMergedAction(prior.action, op.action);
      const action = preferredAction === "update" && !existing ? "create" : preferredAction;
      const passages = dedupeStrings([
        ...(prior.sourcePassages ?? []),
        ...(op.sourcePassages ?? []),
      ]);
      merged.set(op.slug, {
        ...prior,
        action,
        title: prior.title || op.title,
        type: prior.type,
        rationale: dedupeStrings([prior.rationale, op.rationale]).join(" | "),
        sourcePassages: passages.length > 0 ? passages : undefined,
        existingPageId: existing?.id ?? prior.existingPageId,
      });
    }
  }

  const contradictions = dedupeContradictions(plans.flatMap((p) => p.contradictions));
  const confidence =
    plans.length > 0
      ? Math.min(...plans.map((p) => p.confidence).filter(Number.isFinite))
      : 0.75;

  return {
    ops: Array.from(merged.values()),
    contradictions,
    confidence: Number.isFinite(confidence) ? confidence : 0.75,
    tokens: plans.reduce((sum, p) => sum + p.tokens, 0),
    inputTokens: plans.reduce((sum, p) => sum + p.inputTokens, 0),
    outputTokens: plans.reduce((sum, p) => sum + p.outputTokens, 0),
    cacheReadTokens: plans.reduce((sum, p) => sum + p.cacheReadTokens, 0),
    cacheWriteTokens: plans.reduce((sum, p) => sum + p.cacheWriteTokens, 0),
  };
}

function resolvePlanOpScope(
  op: PlanOp,
  existingBySlug: Map<string, WikiPageRecord>,
): PlanOp {
  const existing = existingBySlug.get(op.slug);
  if (op.action === "update" && !existing) {
    return {
      ...op,
      action: "create",
      rationale: `${op.rationale} [auto-demoted from update — slug not found]`,
      existingPageId: undefined,
    };
  }
  return { ...op, existingPageId: existing?.id };
}

function chooseMergedAction(a: PlanOp["action"], b: PlanOp["action"]): PlanOp["action"] {
  if (a === "update" || b === "update") return "update";
  if (a === "create" || b === "create") return "create";
  return "skip";
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function dedupeContradictions(
  values: OpPlan["contradictions"],
): OpPlan["contradictions"] {
  const seen = new Set<string>();
  const out: OpPlan["contradictions"] = [];
  for (const value of values) {
    const key = `${value.slugA}\u0000${value.slugB}\u0000${value.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function shortSha(input: string): Promise<string | null> {
  if (!input) return null;
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 12);
}

function extractTags(metadata: Record<string, unknown>): string[] {
  const tags = metadata?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string");
}

/** For dry-run mode: synthesize a WikiPageRecord from a WrittenPage so the
 * event shape is consistent with a real run. */
function buildDryRunPage(
  wikiId: string,
  written: WrittenPage,
  existing: WikiPageRecord | null,
): WikiPageRecord {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `dry-${written.slug}`,
    characterId: existing?.characterId ?? "",
    wikiId,
    type: written.type,
    slug: written.slug,
    title: written.title,
    summary: written.summary,
    body: written.body,
    frontmatter: written.frontmatter,
    perspective: written.perspective,
    confidence: written.confidence,
    timeIndex: written.timeIndex,
    knowsFuture: written.knowsFuture,
    contradictions: written.contradictions,
    version: (existing?.version ?? 0) + 1,
    lastCompiledAt: now,
    embedding: existing?.embedding ?? null,
    embeddingModel: existing?.embeddingModel ?? null,
    embeddedAt: existing?.embeddedAt ?? null,
    layoutX: existing?.layoutX ?? null,
    layoutY: existing?.layoutY ?? null,
    layoutComputedAt: existing?.layoutComputedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
