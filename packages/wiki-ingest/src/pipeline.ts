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
  getWikiStore,
  getWikisStore,
  type SavePageInput,
  type WikiStore,
  type WikiPageRecord,
  wikiEmbeddingSource,
} from "@odyssey/db";
import { DEFAULT_MODEL, resolveModel, type ModelId } from "./models";
import { plan } from "./planner";
import { write } from "./writer";
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

  const promptHash = await shortSha(wikiRecord.ingestionPrompt ?? "");
  const sourceTags = extractTags(source.metadata);

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

    // ── Plan ───────────────────────────────────────────────────
    yield { type: "planning" };

    const opPlan = await planChunked({
      model,
      characterDomainPrompt: wikiRecord.ingestionPrompt,
      source: {
        title: source.title,
        kind: source.kind,
        tags: sourceTags,
        content: source.content,
      },
      existingPages,
    });
    totalTokens += opPlan.tokens;
    totalInputTokens += opPlan.inputTokens;
    totalOutputTokens += opPlan.outputTokens;

    // ── Execute ops (excluding "skip") ─────────────────────────
    const actionableOps = opPlan.ops.filter((o) => o.action !== "skip");

    yield {
      type: "plan-complete",
      opCount: actionableOps.length,
      contradictionCount: opPlan.contradictions.length,
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
        op,
        source: { title: source.title, tags: sourceTags },
        existingPage,
        allPages: writerContextPages,
        slugToId: existingSlugToId,
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
      while (
        nextOpIndex < actionableOps.length &&
        inFlight.size < writerConcurrency
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

      if ("error" in result) {
        const msg =
          result.error instanceof Error ? result.error.message : String(result.error);
        opFailures.push(`${result.op.slug}: ${msg}`);
        yield { type: "op-failed", op: result.op, error: msg };
        continue;
      }

      const { op, written, existingPage } = result;
      totalTokens += written.tokens;
      totalInputTokens += written.inputTokens;
      totalOutputTokens += written.outputTokens;

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
            written.sourceRefs.map((r) => ({
              pageId: saveResult.page.id,
              sourceId: source.id,
              passage: r.passage,
              quote: r.quote,
              relevanceNote: r.relevanceNote,
            })),
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

async function planChunked(args: {
  model: ModelId;
  characterDomainPrompt: string | null;
  source: {
    title: string;
    kind: string;
    tags: string[];
    content: string;
  };
  existingPages: WikiPageRecord[];
}): Promise<OpPlan> {
  const chunks = splitSourceForPlanning(args.source.content);
  if (chunks.length <= 1) {
    return plan(args);
  }

  const plans: OpPlan[] = [];
  for (let i = 0; i < chunks.length; i++) {
    plans.push(
      await plan({
        ...args,
        source: {
          ...args.source,
          title: `${args.source.title} (part ${i + 1} of ${chunks.length})`,
          content: chunks[i],
        },
      }),
    );
  }

  return mergeChunkPlans(plans, args.existingPages);
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
