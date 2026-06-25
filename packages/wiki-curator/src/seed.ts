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
  queryActivation: 360,
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

  // 3. Query-driven text match. Tokenize fields and match whole terms, not
  //    arbitrary substrings. A term like "tell" should not activate a page
  //    titled "Intellectual cycles".
  const queryTerms = extractQueryTerms(args.query ?? "");
  if (queryTerms.length > 0) {
    const queryTermSet = new Set(queryTerms);
    const activationBoosts = activationSlugBoosts(queryTerms);
    for (const [slug, boost] of activationBoosts) {
      const page = bySlug.get(slug);
      if (page) {
        recordSeed(page.id, "query-activation", page.slug, boost);
      }
    }

    for (const page of pages) {
      const titleTerms = tokenizeText(page.title);
      const summaryTerms = tokenizeText(page.summary ?? "");

      const titleHits = countTermHits(titleTerms, queryTerms);
      const summaryHits = countTermHits(summaryTerms, queryTerms);
      const aliasHits = aliasMatchCount(page, queryTermSet);

      if (isStrongTitleHit(page, titleHits, queryTerms.length)) {
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
      if (isStrongSummaryHit(summaryHits, queryTerms.length)) {
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
  return Array.from(
    tokenizeText(q).values(),
  ).filter((t) => (t.length > 2 || SHORT_PROPER_TERMS.has(t)) && !STOPWORDS.has(t));
}

function activationSlugBoosts(queryTerms: string[]): Map<string, number> {
  const terms = new Set(queryTerms);
  const boosts = new Map<string, number>();
  const add = (slug: string, weight: number = SEED_WEIGHT.queryActivation) => {
    boosts.set(slug, Math.max(boosts.get(slug) ?? 0, weight));
  };
  const hasAny = (...values: string[]) => values.some((value) => terms.has(value));
  const hasAll = (...values: string[]) => values.every((value) => terms.has(value));

  if (hasAny("visitor", "mamre", "hospitality")) {
    add("three-visitors-at-mamre", 460);
    add("hospitality-and-kindness", 360);
    add("sarah", 240);
    add("sarai", 180);
  }

  if (hasAny("laugh", "laughed", "laughter") || hasAll("sarah", "promise")) {
    add("sarah", 460);
    add("sarai", 420);
    add("barrenness", 460);
    add("birth-of-isaac", 500);
    add("great-nation-promise", 520);
    add("three-visitors-at-mamre", 420);
    add("isaac", 260);
  }

  if (hasAny("ur", "haran", "huran", "harran") || hasAll("leave", "behind")) {
    add("ur-of-the-chaldees", 460);
    add("departure-from-ur", 460);
    add("the-call-at-haran", 400);
    add("haran-city", 380);
    add("terah", 300);
  }

  if (hasAny("egypt", "pharaoh") || hasAll("fear", "overtook")) {
    add("descent-into-egypt", 460);
    add("egypt", 420);
    add("pharaoh", 420);
    add("fear-and-deception", 460);
    add("sarah", 240);
    add("sarai", 260);
  }

  if (hasAny("isaac", "barrenness") && hasAny("promise", "covenant")) {
    add("isaac", 460);
    add("sarah", 420);
    add("sarai", 320);
    add("barrenness", 460);
    add("birth-of-isaac", 380);
    add("great-nation-promise", 420);
  }

  return boosts;
}

function countTermHits(fieldTerms: Set<string>, queryTerms: string[]): number {
  let hits = 0;
  for (const term of queryTerms) {
    if (fieldTerms.has(term)) hits++;
  }
  return hits;
}

/**
 * Count aliases that FULLY match the query. An alias only counts when ALL of its
 * significant tokens (>2 chars or a known short proper term, non-stopword) appear
 * in the query — so a single common word can't pull the page in. Without this,
 * "driven woman" matched Hagar via her alias "that slave-woman" on the token
 * "woman"; a multi-word alias should match as a name, not a bag of words.
 */
function aliasMatchCount(page: WikiPageRecord, queryTerms: Set<string>): number {
  let hits = 0;
  for (const alias of extractAliases(page)) {
    const tokens = Array.from(tokenizeText(alias)).filter(
      (t) => (t.length > 2 || SHORT_PROPER_TERMS.has(t)) && !STOPWORDS.has(t),
    );
    if (tokens.length > 0 && tokens.every((t) => queryTerms.has(t))) hits++;
  }
  return hits;
}

function isStrongTitleHit(
  page: WikiPageRecord,
  hits: number,
  queryTermCount: number,
): boolean {
  if (hits <= 0) return false;
  if (hits >= 2 || queryTermCount <= 2) return true;
  // Single-token entity/concept titles are usually direct references
  // ("Sarah", "Covenant"). Single-token event/relationship title hits in
  // longer utterances are often incidental ("death of Sarah").
  return page.type === "entity" || page.type === "concept";
}

function isStrongSummaryHit(hits: number, queryTermCount: number): boolean {
  if (hits <= 0) return false;
  if (hits >= 2) return true;
  return queryTermCount <= 2;
}

function tokenizeText(value: string): Set<string> {
  const raw = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return new Set(raw.map(normalizeTerm).filter((t) => t.length > 0));
}

function normalizeTerm(term: string): string {
  if (term === "mammary") return "mamre";
  if (term === "huran" || term === "harran") return "haran";
  if (term.endsWith("ies") && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith("s") && term.length > 4) return term.slice(0, -1);
  return term;
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "you", "your", "they", "them", "who",
  "what", "when", "where", "why", "how", "this", "that", "these", "those",
  "have", "has", "had", "does", "did", "been", "being", "was", "were", "will",
  "can", "could", "should", "would", "may", "might", "shall", "must", "about",
  "from", "into", "onto", "with", "than", "then", "though", "thus", "yet",
  "too", "not", "all", "any", "some", "more", "most", "much", "very", "just",
  "also", "only", "still", "even", "such", "other", "our",
  "tell", "told", "say", "said", "came", "come", "referring", "refer",
  "talk", "keep", "connect", "drift", "drifting",
]);

const SHORT_PROPER_TERMS = new Set(["ur"]);

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
