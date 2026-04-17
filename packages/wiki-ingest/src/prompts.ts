/**
 * Prompt templates for the planner and the writer.
 *
 * Structure every prompt in three layers:
 *   1. Engine instructions (agnostic — how the wiki works, what pages are)
 *   2. Character domain prompt (domain-specific — from character.ingestionPrompt)
 *   3. Run-specific content (this source, this plan, this existing page)
 *
 * Layer 1 + 2 are identical across every op in a run, so the planner's
 * system prompt becomes a great prompt-cache candidate — Anthropic's
 * ephemeral cache shaves ~90% of the tokens off the writer's repeat calls.
 */

import type { WikiPageRecord } from "@odyssey/db";
import type { PlanOp } from "./types.js";

/* ── Layer 1: engine instructions ──────────────────────────────── */

const ENGINE_INSTRUCTIONS_PLANNER = `You are the PLANNER for a per-character knowledge graph ("the wiki"). Your job is to turn a newly-arrived source document into a concrete list of page operations. You do NOT write page bodies.

THE WIKI IN ONE PARAGRAPH
A character's wiki is a set of interlinked typed pages: entity (people, places, objects, groups), event, concept, relationship, timeline, voice_identity. Pages reference each other by immutable kebab-case slugs. The graph is queried at runtime by a context curator that pulls the right pages into the LLM prompt when the character speaks.

YOUR JOB
1. Read the source.
2. Read the existing wiki index (titles + summaries by type).
3. Decide: which pages need to be created, which updated, which are already fine (skip).
4. For each op, supply a rationale (why) and 1-4 verbatim source passages (what the writer should cite).
5. Flag contradictions — new source vs existing page, or two new pages.
6. Rate your confidence 0..1 in the plan.

RULES
- Slugs are immutable. For updates, the slug MUST match an existing slug from the index. For creates, invent a stable kebab-case slug.
- Prefer update over create when a page already covers the same entity/event/concept.
- Do NOT write page bodies, summaries, or frontmatter here — only the plan.
- Skip speculative pages. If the source doesn't warrant a page, don't plan one.
- Events need a timeIndex (planner notes which era the event belongs in via the rationale; writer sets the index).
- Pages the character "knows about but hasn't lived yet" (a promised future) still get planned — the writer will set knowsFuture: true.

OUTPUT
Call the plan_operations tool. Do not emit any text outside the tool call.`;

const ENGINE_INSTRUCTIONS_WRITER = `You are the WRITER for a per-character knowledge graph. The planner decided WHAT pages to produce; you produce the full contents of one page.

A page has:
- title (human-facing, can rename)
- slug (immutable, matches the plan)
- type (entity | event | concept | relationship | timeline | voice_identity)
- summary (1-2 sentences — what the curator shows when full body is too expensive)
- body (markdown with [[slug]] or [[slug|Display]] wikilinks — the long-form content)
- frontmatter (type-specific structured fields — see tool schema)
- perspective ({knowsHow, feels, stake} — the CHARACTER'S relationship to this page, not yours)
- confidence (0..1, your certainty given the sources)
- timeIndex (for events — {era, index within era})
- knowsFuture (events promised but not yet lived)
- contradictions (other pages on this character that conflict with this one)
- sourceRefs (the source passages this page draws from)

RULES
- WIKILINKS: anywhere in the body you reference another page, use [[slug|Display]] or [[slug]]. Slugs are kebab-case, lowercase, immutable. Invent new slugs freely for pages the planner didn't list — the ingestion pipeline will create them on next run.
- PERSPECTIVE: write as if you're cataloging what this particular character knows/feels. Their perspective, not an encyclopedia's.
- BODY STYLE: clear, specific, grounded. No h1 headings. Subheadings (##, ###) are fine. Keep it tight — target 100-400 words unless the subject truly warrants more.
- SOURCES: cite at least one passage in sourceRefs when the source provides direct textual support.
- CONTRADICTIONS: flag the ones the planner noted. You can add new ones you spot.

OUTPUT
Call the write_page tool. Do not emit any text outside the tool call.`;

/* ── Compose system prompts ────────────────────────────────────── */

export function plannerSystemPrompt(domainPrompt: string | null): string {
  if (!domainPrompt || domainPrompt.trim() === "") {
    return ENGINE_INSTRUCTIONS_PLANNER;
  }
  return `${ENGINE_INSTRUCTIONS_PLANNER}

---

DOMAIN CONTEXT FOR THIS CHARACTER

${domainPrompt.trim()}`;
}

export function writerSystemPrompt(domainPrompt: string | null): string {
  if (!domainPrompt || domainPrompt.trim() === "") {
    return ENGINE_INSTRUCTIONS_WRITER;
  }
  return `${ENGINE_INSTRUCTIONS_WRITER}

---

DOMAIN CONTEXT FOR THIS CHARACTER

${domainPrompt.trim()}`;
}

/* ── User-message content for the planner ──────────────────────── */

/** Compact rendering of the existing wiki for the planner's input. */
export function renderWikiIndex(pages: WikiPageRecord[]): string {
  if (pages.length === 0) return "(the wiki is empty — this is the first ingest)";
  const byType = new Map<string, WikiPageRecord[]>();
  for (const p of pages) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type)!.push(p);
  }
  const lines: string[] = [];
  for (const [type, list] of byType) {
    lines.push(`## ${type} (${list.length})`);
    for (const p of list) {
      const era = p.timeIndex ? ` [${p.timeIndex.era}:${p.timeIndex.index}]` : "";
      lines.push(
        `- [[${p.slug}]] "${p.title}"${era} — ${p.summary ?? "(no summary)"}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function plannerUserMessage(args: {
  sourceTitle: string;
  sourceKind: string;
  sourceTags: string[];
  sourceContent: string;
  wikiIndex: string;
}): string {
  const tagsLine = args.sourceTags.length
    ? `Tags: ${args.sourceTags.join(", ")}`
    : "Tags: (none)";
  return `# New source

Title: ${args.sourceTitle}
Kind: ${args.sourceKind}
${tagsLine}

---

${args.sourceContent}

---

# Existing wiki index

${args.wikiIndex}

---

Plan the operations needed to incorporate this source into the wiki. Call the plan_operations tool.`;
}

/* ── User-message content for the writer ───────────────────────── */

export function writerUserMessage(args: {
  op: PlanOp;
  sourceTitle: string;
  sourceTags: string[];
  existingBody?: string;
  wikiIndexCompact: string;
}): string {
  const tagsLine = args.sourceTags.length
    ? `Source tags: ${args.sourceTags.join(", ")}`
    : "";
  const passages = args.op.sourcePassages?.length
    ? args.op.sourcePassages
        .map((p, i) => `[Passage ${i + 1}]\n${p}`)
        .join("\n\n")
    : "(planner did not isolate specific passages — see full source in context)";
  const updateBlock = args.existingBody
    ? `\n\n## EXISTING BODY (you are UPDATING this page)\n\n${args.existingBody}\n`
    : "";
  return `# Op: ${args.op.action} [[${args.op.slug}]]

Type: ${args.op.type}
Title (proposed): ${args.op.title}
Rationale from planner: ${args.op.rationale}

## Source
${args.sourceTitle}
${tagsLine}

## Passages
${passages}${updateBlock}

## Other pages on this character (for wikilinking)
${args.wikiIndexCompact}

---

Write the full page payload. Call the write_page tool.`;
}

/* ── Compact index for the writer (lighter than the planner's) ─── */

export function renderWikiIndexCompact(pages: WikiPageRecord[]): string {
  if (pages.length === 0) return "(no existing pages)";
  return pages
    .map((p) => `- [[${p.slug}]] (${p.type}) — ${p.title}`)
    .join("\n");
}
