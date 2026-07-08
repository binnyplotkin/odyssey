/**
 * Step 1 of the ingestion pipeline — the planner.
 *
 * One LLM call. Input: source + existing wiki index + character's domain
 * prompt. Output: a plan of create/update/skip operations with rationales,
 * plus flagged contradictions and a rough confidence.
 */

import type { WikiPageRecord } from "@odyssey/db";
import { call, extractToolUse } from "./client";
import type { ModelId } from "./models";
import {
  plannerSystemPrompt,
  plannerUserMessage,
  renderWikiIndex,
} from "./prompts";
import { PLAN_TOOL } from "./tools";
import type { OpPlan, PlanOp } from "./types";

/** Planner response budget. Dense sources can plan 25+ ops with rationales +
 * passages; 8k proved too small for table-heavy chunks. Env-overridable so
 * tests/evals can force the truncation path deterministically. */
const PLANNER_MAX_TOKENS =
  Number(process.env.PLANNER_MAX_TOKENS) > 0
    ? Number(process.env.PLANNER_MAX_TOKENS)
    : 16_384;

/**
 * The planner's output hit max_tokens — the plan is incomplete (possibly
 * unparseable). Callers split the content and re-plan smaller pieces rather
 * than failing the run (see planChunked in pipeline.ts).
 */
export class PlanTruncatedError extends Error {
  constructor(contentChars: number) {
    super(
      `planner output truncated at max_tokens (${PLANNER_MAX_TOKENS}) on ${contentChars} chars of source — content too op-dense for one call`,
    );
    this.name = "PlanTruncatedError";
  }
}

/** What the plan_operations tool schema emits — raw, pre-resolved. */
type RawPlan = {
  ops: Array<{
    action: "create" | "update" | "skip";
    slug: string;
    type: PlanOp["type"];
    title: string;
    rationale: string;
    sourcePassages?: string[];
  }>;
  contradictions?: Array<{ slugA: string; slugB: string; note: string }>;
  confidence?: number;
};

export async function plan(args: {
  model: ModelId;
  characterDomainPrompt: string | null;
  /** Rendered Layer-1.5 block (see renderWikiContext). Null skips the layer. */
  wikiContext?: string | null;
  source: {
    title: string;
    sourceType: string;
    tags: string[];
    content: string;
  };
  existingPages: WikiPageRecord[];
  /** Ops planned by earlier chunks of this source — later chunks reuse
   * these slugs instead of inventing variants (see planChunked). */
  plannedSoFar?: PlanOp[];
}): Promise<OpPlan> {
  const system = plannerSystemPrompt(args.characterDomainPrompt, args.wikiContext);
  const userMsg = plannerUserMessage({
    sourceTitle: args.source.title,
    sourceType: args.source.sourceType,
    sourceTags: args.source.tags,
    sourceContent: args.source.content,
    wikiIndex: renderWikiIndex(args.existingPages),
    plannedSoFar: args.plannedSoFar,
  });

  const result = await call({
    model: args.model,
    // Cache breakpoint on the system prefix: a no-op for single-call plans,
    // but chunked plans (planChunked) run sequential calls sharing this
    // prefix, and chunk 2..N read it at 0.1×.
    system: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userMsg }],
    tools: [PLAN_TOOL],
    toolChoice: { type: "tool", name: "plan_operations" },
    // Plans with 20+ ops + rationales + passages can stretch well past 4k
    // tokens; dense/table-heavy chunks past 8k (see PLANNER_MAX_TOKENS).
    maxTokens: PLANNER_MAX_TOKENS,
  });

  // Truncated output is incomplete even when it happens to parse — the last
  // ops are missing or mangled. Typed error so planChunked can split+retry.
  if (result.stopReason === "max_tokens") {
    throw new PlanTruncatedError(args.source.content.length);
  }

  const raw = extractToolUse<RawPlan>(result, "plan_operations");

  // Defensive: the tool schema requires `ops`, but malformed output can
  // surface a partial input. Fail loudly with the actual shape we got.
  if (!raw || !Array.isArray(raw.ops)) {
    throw new Error(
      `planner: tool_use missing ops array; stop=${result.stopReason}; ` +
        `keys=[${Object.keys((raw as object) ?? {}).join(", ")}]; ` +
        `raw=${JSON.stringify(raw).slice(0, 400)}`,
    );
  }

  // Resolve slugs → existing page IDs for "update" ops so the writer can
  // fetch the prior body.
  const bySlug = new Map(args.existingPages.map((p) => [p.slug, p]));

  const ops: PlanOp[] = raw.ops.map((o) => {
    const existing = bySlug.get(o.slug);
    if (o.action === "update" && !existing) {
      // Planner asked for update but slug doesn't exist — degrade to create.
      return {
        action: "create",
        slug: o.slug,
        type: o.type,
        title: o.title,
        rationale: `${o.rationale} [auto-demoted from update — slug not found]`,
        sourcePassages: o.sourcePassages,
      };
    }
    return {
      action: o.action,
      slug: o.slug,
      type: o.type,
      title: o.title,
      rationale: o.rationale,
      sourcePassages: o.sourcePassages,
      existingPageId: existing?.id,
    };
  });

  return {
    ops,
    contradictions: raw.contradictions ?? [],
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.75,
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
  };
}
