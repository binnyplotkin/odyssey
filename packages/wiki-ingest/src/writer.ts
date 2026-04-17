/**
 * Step 2 of the ingestion pipeline — the writer.
 *
 * One LLM call per op. Produces the full page payload: title, summary,
 * markdown body with wikilinks, typed frontmatter, perspective, confidence,
 * time index, contradictions, source refs.
 */

import type {
  Contradiction,
  Frontmatter,
  Perspective,
  TimeIndex,
  WikiPageRecord,
} from "@odyssey/db";
import { call, extractToolUse } from "./client.js";
import type { ModelId } from "./models.js";
import {
  renderWikiIndexCompact,
  writerSystemPrompt,
  writerUserMessage,
} from "./prompts.js";
import { WRITE_TOOL } from "./tools.js";
import type { PlanOp, WrittenPage } from "./types.js";

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

export async function write(args: {
  model: ModelId;
  characterDomainPrompt: string | null;
  op: PlanOp;
  source: {
    title: string;
    tags: string[];
  };
  existingPage: WikiPageRecord | null;
  allPages: WikiPageRecord[];
  /** Known-slug → pageId resolver for contradictions. */
  slugToId: Map<string, string>;
}): Promise<WrittenPage> {
  const system = writerSystemPrompt(args.characterDomainPrompt);
  const userMsg = writerUserMessage({
    op: args.op,
    sourceTitle: args.source.title,
    sourceTags: args.source.tags,
    existingBody: args.existingPage?.body,
    wikiIndexCompact: renderWikiIndexCompact(args.allPages),
  });

  const result = await call({
    model: args.model,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: [WRITE_TOOL],
    toolChoice: { type: "tool", name: "write_page" },
    maxTokens: 4096,
  });

  const raw = extractToolUse<RawWrite>(result, "write_page");

  // Resolve contradiction otherSlug → pageId (drop entries that don't resolve).
  const contradictions: Contradiction[] = (raw.contradictions ?? [])
    .map((c) => {
      const id = args.slugToId.get(c.otherSlug);
      if (!id) return null;
      return { otherPageId: id, note: c.note };
    })
    .filter((c): c is Contradiction => c !== null);

  return {
    slug: args.op.slug,
    type: args.op.type,
    title: raw.title,
    summary: raw.summary,
    body: raw.body,
    frontmatter: raw.frontmatter as Frontmatter,
    perspective: raw.perspective as Perspective,
    confidence: clamp01(raw.confidence),
    timeIndex: raw.timeIndex ?? null,
    knowsFuture: raw.knowsFuture ?? false,
    contradictions,
    sourceRefs: raw.sourceRefs ?? [],
    tokens: result.tokens,
  };
}

function clamp01(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
