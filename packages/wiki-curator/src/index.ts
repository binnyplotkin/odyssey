/**
 * @odyssey/wiki-curator — public API.
 *
 * The main entrypoint is `curate(request)`. Given a character + optional
 * query / scene / current-moment, it returns a prompt chunk ready to inject
 * into a runtime LLM call, plus a trace explaining which pages it chose and
 * why.
 */

import {
  getCharacterStore,
  getWikiStore,
  type WikiPageRecord,
} from "@odyssey/db";
import type {
  CurateRequest,
  CurateResult,
  CuratorTrace,
  SelectedPage,
} from "./types";
import { seedPages } from "./seed";
import { traverse } from "./traverse";
import { filterByTimeline } from "./filter";
import { fitBudget, type BudgetInput } from "./budget";
import { renderPromptChunk } from "./render";
import { estimateTokens } from "./tokens";

const DEFAULT_BUDGET = 3000;
/** Ignore candidates below this score after traversal. */
const MIN_CANDIDATE_SCORE = 80;

export async function curate(request: CurateRequest): Promise<CurateResult> {
  const startedAt = performance.now();

  const budget = request.tokenBudget ?? DEFAULT_BUDGET;
  const characterStore = getCharacterStore();
  const wikiStore = getWikiStore();

  const character = await characterStore.getById(request.characterId);
  if (!character) {
    throw new Error(`curate: character not found: ${request.characterId}`);
  }

  // Load the whole wiki — this feature tops out in the low hundreds of pages
  // per character, so one listPages + one listCharacterEdges is fine.
  const [pages, edges] = await Promise.all([
    wikiStore.listPages(character.id),
    wikiStore.listCharacterEdges(character.id),
  ]);

  const totalPages = pages.length;

  // ── 1. Seed ────────────────────────────────────────────────────
  const { scores: seedScores, trace: seedTrace } = seedPages(pages, {
    query: request.query,
    scene: request.scene,
    semanticSeeds: request.semanticSeeds,
  });

  // ── 2. Traverse ────────────────────────────────────────────────
  const { scores, origin, edgesFollowed } = traverse(pages, edges, seedScores);

  // ── 3. Timeline filter ─────────────────────────────────────────
  const scored = pages.filter((p) => scores.has(p.id) && (scores.get(p.id) ?? 0) > 0);
  const { kept, filteredSlugs } = filterByTimeline(
    scored,
    character.eras,
    request.currentMoment ?? null,
  );

  // ── 4. Drop below-threshold candidates ─────────────────────────
  const scoreDropped: string[] = [];
  const survivors: WikiPageRecord[] = [];
  for (const p of kept) {
    const s = scores.get(p.id) ?? 0;
    if (p.type === "voice_identity") {
      // voice_identity gets through regardless.
      survivors.push(p);
      continue;
    }
    if (s < MIN_CANDIDATE_SCORE) scoreDropped.push(p.slug);
    else survivors.push(p);
  }

  // Build a slug-map for trail reconstruction.
  const pageBySlug = new Map(pages.map((p) => [p.slug, p] as const));
  const pageById = new Map(pages.map((p) => [p.id, p] as const));

  // ── 5. Budget + render mode ────────────────────────────────────
  const budgetInputs: BudgetInput[] = survivors.map((p) => {
    const o = origin.get(p.id);
    const trail = reconstructTrail(p.id, origin, pageById);
    const originLabel = o
      ? o.hop === 0
        ? seedReasonFor(p, seedTrace) ?? "seed"
        : `hop ${o.hop} · ${o.edgeKind ?? "?"}`
      : "unknown";
    return {
      page: p,
      score: scores.get(p.id) ?? 0,
      origin: originLabel,
      trail,
    };
  });

  const { selected, budgetDropped, tokensUsed } = fitBudget(budgetInputs, budget);

  // ── 6. Render ──────────────────────────────────────────────────
  const activeEntitySlugs = new Set(request.scene?.activeEntities ?? []);
  if (request.scene?.location) activeEntitySlugs.add(request.scene.location);
  const promptChunk = renderPromptChunk(selected, { activeEntitySlugs });

  // Recompute actual tokensUsed from the final chunk (not the greedy budget
  // estimate), so the caller sees the real cost.
  const actualTokens = estimateTokens(promptChunk);

  const trace: CuratorTrace = {
    totalPages,
    seeds: seedTrace,
    edges: edgesFollowed,
    timelineFiltered: filteredSlugs,
    scoreDropped,
    budgetDropped,
  };
  void pageBySlug;

  return {
    promptChunk,
    pages: selected,
    trace,
    tokensUsed: Math.max(actualTokens, tokensUsed),
    tokensBudget: budget,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

/* ── Helpers ───────────────────────────────────────────────────── */

function reconstructTrail(
  pageId: string,
  origin: Map<string, { hop: number; parentPageId: string | null; edgeKind: string | null }>,
  pageById: Map<string, WikiPageRecord>,
): string[] {
  const trail: string[] = [];
  let cursor: string | null = pageId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const p = pageById.get(cursor);
    if (p) trail.unshift(p.slug);
    cursor = origin.get(cursor)?.parentPageId ?? null;
  }
  return trail;
}

function seedReasonFor(
  page: WikiPageRecord,
  seeds: { slug: string; reason: string }[],
): string | null {
  const reasons = seeds.filter((s) => s.slug === page.slug).map((s) => s.reason);
  return reasons.length ? reasons.join("+") : null;
}

/* ── Re-exports ────────────────────────────────────────────────── */

export type {
  CurateRequest,
  CurateResult,
  CuratorTrace,
  Scene,
  SelectedPage,
  SeedTrace,
  SemanticSeed,
  EdgeFollowed,
  PageRendering,
} from "./types";
export { EDGE_WEIGHT } from "./traverse";

// Also useful for callers: lightweight render-a-page to get budget cost.
export { tokensForFull, tokensForSummary, tokensForTitle } from "./budget";
