/**
 * Public types for the context curator.
 *
 * The curator is the runtime half of the knowledge graph: when a character
 * is about to speak, it picks which wiki pages to inject into the LLM's
 * system prompt. No LLM calls here — graph traversal + budget math only —
 * so latency stays in the <150ms window a conversation turn can afford.
 */

import type {
  EdgeKind,
  TimeIndex,
  WikiPageRecord,
} from "@odyssey/db";

/* ── Inputs ────────────────────────────────────────────────────── */

export type Scene = {
  /** Slugs of entities the curator should treat as "in scene" right now. */
  activeEntities?: string[];
  /** Slug of the current setting/place page (if any). */
  location?: string;
};

export type CurateRequest = {
  characterId: string;
  /**
   * The user's utterance / conversation trigger. Used for seed text matching.
   * Optional — if absent, the curator returns the character's baseline
   * context (voice + core ideas).
   */
  query?: string;
  /**
   * Pre-computed semantic hits — pages that came back highly similar to
   * `query` from a vector search. Optional. Caller (admin/voice-stream) is
   * responsible for embedding the query and running the pgvector lookup;
   * this package stays free of OpenAI/pgvector dependencies.
   */
  semanticSeeds?: SemanticSeed[];
  /**
   * Where the character currently "is" in their life. Pages with a
   * timeIndex after this moment are filtered unless knowsFuture is true.
   */
  currentMoment?: TimeIndex;
  /** Active entities + place from session state. */
  scene?: Scene;
  /**
   * Hard cap on the total token budget for the curator's output (summaries
   * + full bodies + scaffolding). Defaults to 3000.
   */
  tokenBudget?: number;
  /**
   * Drop the character's `voice_identity` sheet from the candidate pool, so
   * the knowledge graph carries only world knowledge and persona comes solely
   * from the L01–L03 system-prompt envelope. Set when the envelope is
   * self-sufficient (L03 voice authored). Reversible; default keeps the sheet.
   */
  excludeVoiceIdentity?: boolean;
};

/* ── Results ───────────────────────────────────────────────────── */

export type PageRendering =
  | "full"          // full markdown body + frontmatter
  | "summary"       // one-line summary only
  | "title";        // slug + title only (cheapest)

export type SelectedPage = {
  page: WikiPageRecord;
  rendering: PageRendering;
  /** Final score after traversal + budgeting. */
  score: number;
  /** How the page got included (seed reason, or "hop N" from a seed). */
  origin: string;
  /** Slug trail from the original seed. */
  trail: string[];
  /** Estimated token cost for this rendering. */
  tokens: number;
};

export type CurateResult = {
  /** Ready-to-inject prompt chunk. */
  promptChunk: string;
  /** The pages that made the cut, in priority order. */
  pages: SelectedPage[];
  /** Full trace — seeds, edges followed, drops. */
  trace: CuratorTrace;
  /** Tokens consumed by the generated promptChunk. */
  tokensUsed: number;
  /** Budget the caller requested. */
  tokensBudget: number;
  /** Elapsed wall time in ms. */
  elapsedMs: number;
};

/* ── Trace ─────────────────────────────────────────────────────── */

export type SeedTrace = {
  slug: string;
  /** Why this page was chosen as a seed. */
  reason:
    | "voice-identity"
    | "query-title"
    | "query-summary"
    | "query-alias"
    | "query-activation"
    | "query-semantic"
    | "scene-entity"
    | "scene-location";
  score: number;
};

/**
 * Semantic seed input. Caller computes the query embedding and runs the
 * vector search against wiki_pages.embedding (kept out of this package so
 * @odyssey/wiki-curator stays free of OpenAI / pgvector dependencies),
 * then passes the resulting page hits in as seeds.
 */
export type SemanticSeed = {
  pageId: string;
  slug: string;
  /** Cosine similarity 0..1. Used to scale the seed weight. */
  similarity: number;
};

export type EdgeFollowed = {
  fromSlug: string;
  toSlug: string;
  kind: EdgeKind;
  /** Score the edge contributed to the toSlug's page score. */
  contribution: number;
};

export type CuratorTrace = {
  /** Total pages considered before any filtering. */
  totalPages: number;
  /** Seed decisions. */
  seeds: SeedTrace[];
  /** Edges traversed in order. */
  edges: EdgeFollowed[];
  /** Pages dropped because their timeIndex is after currentMoment. */
  timelineFiltered: string[];
  /** Pages that scored low enough they never made it into the candidate set. */
  scoreDropped: string[];
  /** Pages that ranked but didn't fit the budget. */
  budgetDropped: string[];
};
