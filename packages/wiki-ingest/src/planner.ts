/**
 * Step 1 of the ingestion pipeline — the planner.
 *
 * One LLM call. Input: source + existing wiki index + character's domain
 * prompt. Output: a plan of create/update/skip operations with rationales,
 * plus flagged contradictions and a rough confidence.
 */

import type { WikiPageRecord } from "@odyssey/db";
import { call, extractToolUse } from "./client.js";
import type { ModelId } from "./models.js";
import {
  plannerSystemPrompt,
  plannerUserMessage,
  renderWikiIndex,
} from "./prompts.js";
import { PLAN_TOOL } from "./tools.js";
import type { OpPlan, PlanOp } from "./types.js";

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
  source: {
    title: string;
    kind: string;
    tags: string[];
    content: string;
  };
  existingPages: WikiPageRecord[];
}): Promise<OpPlan> {
  const system = plannerSystemPrompt(args.characterDomainPrompt);
  const userMsg = plannerUserMessage({
    sourceTitle: args.source.title,
    sourceKind: args.source.kind,
    sourceTags: args.source.tags,
    sourceContent: args.source.content,
    wikiIndex: renderWikiIndex(args.existingPages),
  });

  const result = await call({
    model: args.model,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [PLAN_TOOL],
    toolChoice: { type: "tool", name: "plan_operations" },
    maxTokens: 4096,
  });

  const raw = extractToolUse<RawPlan>(result, "plan_operations");

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
  };
}
