/**
 * Seed selection. Pick the pages most directly relevant to the turn.
 *
 * For MVP: exact/substring text matching on title/aliases/summary + scene
 * state + the character's voice_identity page. No embeddings, no stemming.
 * A semantic-retrieval path (embedding-based) is a later optimization; in
 * practice for focused conversations (you're in a scene, characters are
 * named, the query mentions them), substring matching does surprisingly well.
 */

import type { WikiPageRecord } from "@odyssey/db";
import type { Scene, SeedTrace, SemanticSeed } from "./types";

export type SeedOutput = {
  /** Map of pageId → initial score from seeding. */
  scores: Map<string, number>;
  trace: SeedTrace[];
};

/** Seed-weight table. Higher = the page is more "definitely" in. */
const SEED_WEIGHT = {
  voiceIdentity: 1000,
  sceneEntity:    500,
  sceneLocation:  500,
  queryTitle:     300,
  queryAlias:     220,
  querySemantic:  200,   // scaled by similarity score; sits between alias and summary at full strength
  querySummary:   140,
} as const;

export function seedPages(
  pages: WikiPageRecord[],
  args: {
    query?: string;
    scene?: Scene;
    semanticSeeds?: SemanticSeed[];
  },
): SeedOutput {
  const scores = new Map<string, number>();
  const trace: SeedTrace[] = [];

  function bump(pageId: string, amount: number) {
    scores.set(pageId, (scores.get(pageId) ?? 0) + amount);
  }

  function recordSeed(
    pageId: string,
    reason: SeedTrace["reason"],
    slug: string,
    score: number,
  ) {
    bump(pageId, score);
    // Only emit a unique trace row per (slug, reason) pair.
    if (!trace.some((t) => t.slug === slug && t.reason === reason)) {
      trace.push({ slug, reason, score });
    }
  }

  // 1. voice_identity pages always win a huge seed score. The character's
  //    voice is table stakes for every turn.
  for (const p of pages) {
    if (p.type === "voice_identity") {
      recordSeed(p.id, "voice-identity", p.slug, SEED_WEIGHT.voiceIdentity);
    }
  }

  // 2. Scene state — anything the curator is told is "in the room right now"
  //    gets a large score. Matches by slug, since the caller owns slug identity.
  const bySlug = new Map(pages.map((p) => [p.slug, p] as const));
  for (const slug of args.scene?.activeEntities ?? []) {
    const page = bySlug.get(slug);
    if (page) recordSeed(page.id, "scene-entity", slug, SEED_WEIGHT.sceneEntity);
  }
  if (args.scene?.location) {
    const page = bySlug.get(args.scene.location);
    if (page) recordSeed(page.id, "scene-location", page.slug, SEED_WEIGHT.sceneLocation);
  }

  // 3. Query-driven text match. Lowercase + token-split, then substring
  //    search on title / aliases / summary.
  const queryTerms = extractQueryTerms(args.query ?? "");
  if (queryTerms.length > 0) {
    for (const page of pages) {
      const title = page.title.toLowerCase();
      const summary = (page.summary ?? "").toLowerCase();
      const aliases: string[] = extractAliases(page);

      let titleHits = 0;
      let summaryHits = 0;
      let aliasHits = 0;
      for (const term of queryTerms) {
        if (title.includes(term)) titleHits++;
        if (summary.includes(term)) summaryHits++;
        if (aliases.some((a) => a.toLowerCase().includes(term))) aliasHits++;
      }

      if (titleHits > 0) {
        recordSeed(
          page.id,
          "query-title",
          page.slug,
          SEED_WEIGHT.queryTitle * titleHits,
        );
      }
      if (aliasHits > 0) {
        recordSeed(
          page.id,
          "query-alias",
          page.slug,
          SEED_WEIGHT.queryAlias * aliasHits,
        );
      }
      if (summaryHits > 0) {
        recordSeed(
          page.id,
          "query-summary",
          page.slug,
          SEED_WEIGHT.querySummary * summaryHits,
        );
      }
    }
  }

  // 4. Semantic seeds — pages the caller pre-found via vector similarity.
  //    Scaled by similarity so a 0.85-similar hit outscores a 0.65 hit, and
  //    a perfect match (1.0) gets the full weight (200), which sits just
  //    below alias matches (220) and well above summary matches (140).
  if (args.semanticSeeds && args.semanticSeeds.length > 0) {
    const validIds = new Set(pages.map((p) => p.id));
    for (const hit of args.semanticSeeds) {
      if (!validIds.has(hit.pageId)) continue;
      const sim = Math.max(0, Math.min(1, hit.similarity));
      const score = Math.round(SEED_WEIGHT.querySemantic * sim);
      if (score > 0) {
        recordSeed(hit.pageId, "query-semantic", hit.slug, score);
      }
    }
  }

  return { scores, trace };
}

/* ── Helpers ───────────────────────────────────────────────────── */

/**
 * Split the query into tokens we'll substring-match. Stopwords + tokens of
 * <=2 chars are filtered out; we keep the raw lowercase form so proper
 * nouns in the source pages (`Sarai`, `Melchizedek`) still match.
 */
function extractQueryTerms(q: string): string[] {
  const lower = q.toLowerCase();
  const raw = lower.split(/[^a-z0-9'-]+/).filter(Boolean);
  return Array.from(
    new Set(raw.filter((t) => t.length > 2 && !STOPWORDS.has(t))),
  );
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "you", "your", "they", "them", "who",
  "what", "when", "where", "why", "how", "this", "that", "these", "those",
  "have", "has", "had", "does", "did", "been", "being", "was", "were", "will",
  "can", "could", "should", "would", "may", "might", "shall", "must", "about",
  "from", "into", "onto", "with", "than", "then", "though", "thus", "yet",
  "too", "not", "all", "any", "some", "more", "most", "much", "very", "just",
  "also", "only", "still", "even", "such", "other", "our",
]);

/** Pull alias strings from type-specific frontmatter where present. */
function extractAliases(page: WikiPageRecord): string[] {
  const fm = page.frontmatter as Record<string, unknown>;
  if (!fm) return [];
  const out: string[] = [];
  const direct = fm.aliases;
  if (Array.isArray(direct)) {
    for (const a of direct) if (typeof a === "string") out.push(a);
  }
  return out;
}
