/**
 * Step 2 of the ingestion pipeline — the writer.
 *
 * One LLM call per op. Produces the full page payload: title, summary,
 * markdown body with wikilinks, typed frontmatter, perspective, confidence,
 * time index, contradictions, source refs.
 */

import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type {
  Contradiction,
  Frontmatter,
  Perspective,
  TimeIndex,
  WikiPageRecord,
} from "@odyssey/db";
import { call, extractToolUse } from "./client";
import type { ModelId } from "./models";
import {
  renderSourceDocument,
  renderWikiIndexCompact,
  writerSystemPrompt,
  writerUserMessage,
} from "./prompts";
import { WRITE_TOOL } from "./tools";
import type { PlanOp, WrittenPage } from "./types";

/** What the write_page tool emits — raw, pre-resolved slugs on contradictions. */
type RawWrite = {
  title: string;
  summary: string;
  body: string;
  frontmatter: Record<string, unknown>;
  perspective: Partial<Perspective>;
  confidence: number;
  timeIndex?: TimeIndex | null;
  knowsFuture?: boolean;
  contradictions?: Array<{ otherSlug: string; note: string }>;
  sourceRefs?: Array<{
    passage?: string;
    quote?: string;
    relevanceNote?: string;
  }>;
};

export class WriterToolUseError extends Error {
  readonly tokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;

  constructor(
    message: string,
    usage: { tokens: number; inputTokens: number; outputTokens: number },
  ) {
    super(message);
    this.name = "WriterToolUseError";
    this.tokens = usage.tokens;
    this.inputTokens = usage.inputTokens;
    this.outputTokens = usage.outputTokens;
  }
}

export async function write(args: {
  model: ModelId;
  characterDomainPrompt: string | null;
  /** Rendered Layer-1.5 block (see renderWikiContext). Null skips the layer. */
  wikiContext?: string | null;
  op: PlanOp;
  source: {
    title: string;
    tags: string[];
    /** Full source content. Null when over the pipeline's char budget —
     * the writer then falls back to planner passages only. */
    content: string | null;
  };
  existingPage: WikiPageRecord | null;
  allPages: WikiPageRecord[];
  /** Known-slug → pageId resolver for contradictions. */
  slugToId: Map<string, string>;
  /** Planner-flagged contradictions involving this op's slug. */
  plannerContradictions?: Array<{ slugA: string; slugB: string; note: string }>;
}): Promise<WrittenPage> {
  // System = [instructions+context+domain, source document], with the cache
  // breakpoint on the last block. The whole prefix (tools + system) is
  // byte-identical across every writer call in a run, so op 2..N read it
  // from the prompt cache instead of re-paying the source each time.
  const instructions = writerSystemPrompt(
    args.characterDomainPrompt,
    args.wikiContext,
  );
  const hasFullSource =
    typeof args.source.content === "string" &&
    args.source.content.trim().length > 0;
  const system: TextBlockParam[] = hasFullSource
    ? [
        { type: "text", text: instructions },
        {
          type: "text",
          text: renderSourceDocument(args.source.title, args.source.content!),
          cache_control: { type: "ephemeral" },
        },
      ]
    : [
        {
          type: "text",
          text: instructions,
          cache_control: { type: "ephemeral" },
        },
      ];

  const userMsg = writerUserMessage({
    op: args.op,
    sourceTitle: args.source.title,
    sourceTags: args.source.tags,
    existingBody: args.existingPage?.body,
    wikiIndexCompact: renderWikiIndexCompact(args.allPages),
    hasFullSource,
    plannerContradictions: args.plannerContradictions,
  });

  const result = await callWriter(args.model, system, userMsg, 8192);
  let raw = extractToolUse<RawWrite>(result, "write_page");
  let usage = {
    tokens: result.tokens,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
  };

  if (!isUsableRawWrite(raw) && result.stopReason === "max_tokens") {
    const repair = await callWriter(
      args.model,
      system,
      `${userMsg}\n\nThe previous write_page tool output was truncated before all required fields were complete. Retry now with a compact payload. Keep body to 450-700 words, include every required field, and do not produce any extra prose outside the tool call.`,
      8192,
    );
    raw = extractToolUse<RawWrite>(repair, "write_page");
    usage = {
      tokens: usage.tokens + repair.tokens,
      inputTokens: usage.inputTokens + repair.inputTokens,
      outputTokens: usage.outputTokens + repair.outputTokens,
      cacheReadTokens: usage.cacheReadTokens + repair.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens + repair.cacheWriteTokens,
    };
  }

  if (!isUsableRawWrite(raw)) {
    throw new WriterToolUseError(
      `writer: tool_use missing required fields (title/body); stop=${result.stopReason}; ` +
        `keys=[${Object.keys((raw as object) ?? {}).join(", ")}]; ` +
        `raw=${JSON.stringify(raw).slice(0, 400)}`,
      usage,
    );
  }

  // Resolve contradiction otherSlug → pageId (drop entries that don't resolve).
  // Defensive: LLM occasionally returns objects instead of arrays for these
  // fields despite the tool schema specifying `type: "array"`.
  const rawContradictions = asArray<{ otherSlug: string; note: string }>(raw.contradictions);
  const contradictions: Contradiction[] = rawContradictions
    .map((c) => {
      if (!c || typeof c.otherSlug !== "string") return null;
      const id = args.slugToId.get(c.otherSlug);
      if (!id) return null;
      return { otherPageId: id, note: typeof c.note === "string" ? c.note : "" };
    })
    .filter((c): c is Contradiction => c !== null);

  const rawSourceRefs = asArray<{ passage?: string; quote?: string; relevanceNote?: string }>(
    raw.sourceRefs,
  );
  const sourceRefs = rawSourceRefs
    .filter((r): r is NonNullable<typeof r> => !!r && typeof r === "object")
    .map((r) => ({
      passage: typeof r.passage === "string" ? r.passage : undefined,
      quote: typeof r.quote === "string" ? r.quote : undefined,
      relevanceNote: typeof r.relevanceNote === "string" ? r.relevanceNote : undefined,
    }));

  return {
    slug: args.op.slug,
    type: args.op.type,
    title: raw.title,
    summary: raw.summary,
    body: raw.body,
    frontmatter: (raw.frontmatter ?? {}) as Frontmatter,
    perspective: (raw.perspective ?? {}) as Perspective,
    confidence: clamp01(raw.confidence),
    timeIndex: raw.timeIndex ?? null,
    knowsFuture: raw.knowsFuture ?? false,
    contradictions,
    sourceRefs,
    tokens: usage.tokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}

function callWriter(
  model: ModelId,
  system: string | TextBlockParam[],
  userMsg: string | TextBlockParam[],
  maxTokens: number,
) {
  return call({
    model,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [WRITE_TOOL],
    toolChoice: { type: "tool", name: "write_page" },
    maxTokens,
  });
}

function isUsableRawWrite(value: RawWrite | null | undefined): value is RawWrite {
  return (
    !!value &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.body === "string" &&
    value.body.trim().length > 0
  );
}

/** Coerce a maybe-array into an array. If the LLM returned an object, wrap it
 *  in an array. If it returned null/undefined, return empty. */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") return [value as T];
  return [];
}

function clamp01(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
