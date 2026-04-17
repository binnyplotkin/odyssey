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
 *   4. For each op: call writer → savePage → emit op-complete.
 *   5. Close the log row with final counters.
 */

import {
  getCharacterStore,
  getWikiStore,
  type WikiPageRecord,
} from "@odyssey/db";
import { DEFAULT_MODEL, resolveModel, type ModelId } from "./models.js";
import { plan } from "./planner.js";
import { write } from "./writer.js";
import type {
  IngestionEvent,
  IngestionInput,
  IngestionResult,
  PlanOp,
  WrittenPage,
} from "./types.js";

export async function* runIngestion(
  input: IngestionInput,
): AsyncGenerator<IngestionEvent, void, void> {
  const model: ModelId = resolveModel(input.model ?? DEFAULT_MODEL);
  const characters = getCharacterStore();
  const wiki = getWikiStore();

  // ── Load context ─────────────────────────────────────────────
  const character = await characters.getById(input.characterId);
  if (!character) {
    yield {
      type: "failed",
      error: `character not found: ${input.characterId}`,
      tokensUsed: 0,
    };
    return;
  }

  const source = await wiki.getSource(input.sourceId);
  if (!source || source.characterId !== input.characterId) {
    yield {
      type: "failed",
      error: `source not found or mismatched character: ${input.sourceId}`,
      tokensUsed: 0,
    };
    return;
  }

  const promptHash = await shortSha(character.ingestionPrompt ?? "");
  const sourceTags = extractTags(source.metadata);

  // ── Open the run log row ─────────────────────────────────────
  const logRow = await wiki.startIngestion({
    characterId: character.id,
    sourceId: source.id,
    model,
    promptHash,
    notes: input.dryRun ? "dry run" : null,
  });

  yield { type: "started", runId: logRow.id, model };

  let totalTokens = 0;
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let totalEdgesAdded = 0;
  let totalEdgesRemoved = 0;

  try {
    // ── Load existing wiki ─────────────────────────────────────
    const existingPages = await wiki.listPages(character.id);
    const existingEdges = await wiki.listCharacterEdges(character.id);

    yield {
      type: "loaded-index",
      pageCount: existingPages.length,
      edgeCount: existingEdges.length,
    };

    // ── Plan ───────────────────────────────────────────────────
    yield { type: "planning" };

    const opPlan = await plan({
      model,
      characterDomainPrompt: character.ingestionPrompt,
      source: {
        title: source.title,
        kind: source.kind,
        tags: sourceTags,
        content: source.content,
      },
      existingPages,
    });
    totalTokens += opPlan.tokens;

    yield {
      type: "plan-complete",
      opCount: opPlan.ops.length,
      contradictionCount: opPlan.contradictions.length,
      tokens: opPlan.tokens,
    };

    // ── Execute ops (excluding "skip") ─────────────────────────
    const actionableOps = opPlan.ops.filter((o) => o.action !== "skip");

    // Refreshed view of pages as we write — the next writer sees prior writes
    // when it resolves wikilinks.
    let workingPages = [...existingPages];

    for (let i = 0; i < actionableOps.length; i++) {
      const op = actionableOps[i];
      yield { type: "op-start", op, index: i, total: actionableOps.length };

      try {
        const existingPage = op.existingPageId
          ? workingPages.find((p) => p.id === op.existingPageId) ?? null
          : null;
        const slugToId = new Map(workingPages.map((p) => [p.slug, p.id]));

        const written: WrittenPage = await write({
          model,
          characterDomainPrompt: character.ingestionPrompt,
          op,
          source: { title: source.title, tags: sourceTags },
          existingPage,
          allPages: workingPages,
          slugToId,
        });
        totalTokens += written.tokens;

        if (input.dryRun) {
          // In dry-run we don't persist — just emit a synthetic op-complete
          // with a fake WikiPageRecord stub.
          yield {
            type: "op-complete",
            op,
            page: buildDryRunPage(character.id, written, existingPage),
            edgesAdded: 0,
            edgesRemoved: 0,
            tokens: written.tokens,
          };
          continue;
        }

        // Write the page — this reconciles edges internally.
        const saveResult = await wiki.savePage({
          characterId: character.id,
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
          authorId: logRow.id,
          note: `ingest: ${op.rationale.slice(0, 120)}`,
        });

        if (saveResult.created) pagesCreated++;
        else if (saveResult.versionCreated) pagesUpdated++;

        totalEdgesAdded += saveResult.edgesAdded;
        totalEdgesRemoved += saveResult.edgesRemoved;

        // Write source refs (after page save so pageId exists).
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

        // Keep workingPages fresh so subsequent writer calls see it.
        const pageIdx = workingPages.findIndex((p) => p.id === saveResult.page.id);
        if (pageIdx >= 0) workingPages[pageIdx] = saveResult.page;
        else workingPages = [...workingPages, saveResult.page];

        yield {
          type: "op-complete",
          op,
          page: saveResult.page,
          edgesAdded: saveResult.edgesAdded,
          edgesRemoved: saveResult.edgesRemoved,
          tokens: written.tokens,
        };
      } catch (opErr: unknown) {
        const msg = opErr instanceof Error ? opErr.message : String(opErr);
        yield { type: "op-failed", op, error: msg };
        // Don't abort the whole run — keep going with remaining ops.
      }
    }

    // ── Finalize ───────────────────────────────────────────────
    yield {
      type: "edges-reconciled",
      added: totalEdgesAdded,
      removed: totalEdgesRemoved,
    };

    const result: IngestionResult = {
      runId: logRow.id,
      status: "succeeded",
      pagesCreated,
      pagesUpdated,
      edgesAdded: totalEdgesAdded,
      edgesRemoved: totalEdgesRemoved,
      contradictionsFound: opPlan.contradictions.length,
      tokensUsed: totalTokens,
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
    yield { type: "failed", error: msg, tokensUsed: totalTokens };
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

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
  characterId: string,
  written: WrittenPage,
  existing: WikiPageRecord | null,
): WikiPageRecord {
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `dry-${written.slug}`,
    characterId,
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
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}
