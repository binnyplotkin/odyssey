/**
 * Ingestion-pipeline-specific types.
 *
 * These are the wire format between the planner, the writer, and the
 * pipeline's event stream. They are NOT the wiki page types — those live in
 * @odyssey/db/wiki-types. An ingestion "operation" is an *intent* to produce
 * or update a page; the wiki page itself is what the store ends up holding.
 */

import type {
  Contradiction,
  Frontmatter,
  Perspective,
  TimeIndex,
  WikiPageRecord,
  WikiPageType,
} from "@odyssey/db";

/* ── The op plan (planner output) ──────────────────────────────── */

export type PlanOpAction = "create" | "update" | "skip";

/** A single operation the planner wants the writer to perform. */
export type PlanOp = {
  action: PlanOpAction;
  /** Stable slug for the page (new or existing). */
  slug: string;
  /** Page type — determines frontmatter shape the writer emits. */
  type: WikiPageType;
  /** Short title the writer will usually keep or refine. */
  title: string;
  /** Why the planner wants this op (shown in admin UI; also feeds the writer). */
  rationale: string;
  /** Source passage(s) to send the writer for body generation. */
  sourcePassages?: string[];
  /** If update: existing page id (resolved during planning). */
  existingPageId?: string;
};

/** The full plan + planner-level annotations. */
export type OpPlan = {
  ops: PlanOp[];
  /** Contradictions the planner spotted while reading. */
  contradictions: Array<{ slugA: string; slugB: string; note: string }>;
  /** The planner's rough confidence in the plan. */
  confidence: number;
  /** LLM tokens consumed by the planner call (input + output). */
  tokens: number;
  /** Input tokens consumed by the planner call. */
  inputTokens: number;
  /** Output tokens consumed by the planner call. */
  outputTokens: number;
};

/* ── Writer output ─────────────────────────────────────────────── */

/**
 * What the writer returns for a single op — the complete page payload.
 * The pipeline turns this into a wiki-store.savePage() call.
 */
export type WrittenPage = {
  slug: string;
  type: WikiPageType;
  title: string;
  summary: string;
  body: string;
  frontmatter: Frontmatter;
  perspective: Perspective;
  confidence: number;
  timeIndex: TimeIndex | null;
  knowsFuture: boolean;
  contradictions: Contradiction[];
  /** Source refs the writer wants to attach. Slugs are resolved by pipeline. */
  sourceRefs: Array<{
    passage?: string;
    quote?: string;
    relevanceNote?: string;
  }>;
  /** LLM tokens consumed by this writer call (input + output). */
  tokens: number;
  /** Input tokens consumed by this writer call. */
  inputTokens: number;
  /** Output tokens consumed by this writer call. */
  outputTokens: number;
};

/* ── Pipeline input/output ─────────────────────────────────────── */

export type IngestionInput = {
  wikiId: string;
  sourceId: string;
  /** Existing durable ingestion-log row. Worker paths pass this so the run
   * survives request/browser disconnects. If omitted, the pipeline creates a
   * legacy request-bound log row for direct callers. */
  runId?: string;
  /** LLM model slug. Defaults resolved in pipeline. */
  model?: string;
  /** If true, run planner + writer but don't call savePage. */
  dryRun?: boolean;
  /** Compute an embedding for materially-changed pages. Wired by the admin
   * app; passed through to wiki.savePage's hooks so this package stays free
   * of OpenAI dependencies. */
  embed?: (text: string) => Promise<number[] | null>;
  embeddingModel?: string;
};

export type IngestionResult = {
  runId: string;
  status: "succeeded" | "failed";
  pagesCreated: number;
  pagesUpdated: number;
  edgesAdded: number;
  edgesRemoved: number;
  contradictionsFound: number;
  /** Total tokens (input + output) consumed by the run. */
  tokensUsed: number;
  /** Input tokens consumed across all model calls in the run. */
  inputTokens: number;
  /** Output tokens consumed across all model calls in the run. */
  outputTokens: number;
  model: string;
};

/* ── Event stream ──────────────────────────────────────────────── */

/**
 * Emitted by the pipeline as it progresses. FE consumes these over SSE to
 * render the live-run view on the Ingestion tab. Each event is cheap to
 * serialize (no deep nesting of page bodies).
 */
export type IngestionEvent =
  | { type: "queued"; runId: string; model: string | null }
  | { type: "started"; runId: string; model: string }
  | { type: "loaded-index"; pageCount: number; edgeCount: number }
  | { type: "planning" }
  | {
      type: "plan-complete";
      opCount: number;
      contradictionCount: number;
      tokens: number;
      inputTokens: number;
      outputTokens: number;
      /** Full list of actionable ops (post skip-filter), in execution order.
       *  Lets the UI render the queue up-front instead of waiting for each
       *  op-start to learn what's coming. */
      ops: PlanOp[];
    }
  | {
      type: "op-start";
      op: PlanOp;
      index: number;
      total: number;
    }
  | {
      type: "op-complete";
      op: PlanOp;
      page: WikiPageRecord;
      edgesAdded: number;
      edgesRemoved: number;
      tokens: number;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      type: "op-failed";
      op: PlanOp;
      error: string;
    }
  | {
      type: "edges-reconciled";
      added: number;
      removed: number;
    }
  | { type: "succeeded"; result: IngestionResult }
  | {
      type: "failed";
      error: string;
      tokensUsed: number;
      inputTokens: number;
      outputTokens: number;
    };
