/**
 * Prompt templates for the planner and the writer.
 *
 * Structure every prompt in four layers:
 *   1.   Engine instructions (agnostic — how the wiki works, what pages are)
 *   1.5. Wiki context (engine-provided structured facts — eras, bound
 *        characters — rendered fresh each run so the model never guesses era keys)
 *   2.   Character domain prompt (domain-specific — from wiki.ingestionPrompt)
 *   3.   Run-specific content (this source, this plan, this existing page)
 *
 * Layers 1–2 are identical across every call in a run, and the writer's
 * system additionally carries the full source document — so planner.ts and
 * writer.ts set a cache_control breakpoint on the system prefix. First call
 * writes the cache (1.25×); every later call in the run reads it at 0.1×.
 * The pipeline runs the first writer solo to warm the cache before fanning
 * out (see pipeline.ts).
 */

import type { Era, WikiPageRecord } from "@odyssey/db";
import type { PlanOp } from "./types";

/* ── Layer 1: engine instructions ──────────────────────────────── */

// Exported for the prompt *generator* (generate.ts), which embeds them in its
// meta-prompt so the generated domain layer tracks engine changes for free.
export const ENGINE_INSTRUCTIONS_PLANNER = `You are the PLANNER for a per-character knowledge graph ("the wiki"). Your job is to turn a newly-arrived source document into a concrete list of page operations. You do NOT write page bodies.

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
- Passages are VERBATIM and SHORT: one or two sentences each, copied exactly as they appear — including inline citation markers such as [8], which downstream provenance resolves to the cited works. Never strip or normalize markers; never quote more than a few sentences per passage.

OUTPUT
Call the plan_operations tool. Do not emit any text outside the tool call.`;

export const ENGINE_INSTRUCTIONS_WRITER = `You are the WRITER for a per-character knowledge graph. The planner decided WHAT pages to produce; you produce the full contents of one page.

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
- GROUNDING: when a SOURCE DOCUMENT section is present in this system prompt, it is the full source — ground every claim in it. The planner's passages are highlights, not the whole evidence; read around them before writing.
- SOURCES: cite at least one passage in sourceRefs when the source provides direct textual support. Quote verbatim from the source document — never reconstruct quotes or loci from memory. Preserve inline citation markers such as [8] exactly as they appear — they carry provenance to the cited works.
- UPDATES: when an EXISTING BODY is provided you are revising, not replacing. Retain existing claims unless this source contradicts or supersedes them; weave the new material in. The word-count target is not license to compress away prior facts — a page may grow across ingests.
- CONTRADICTIONS: flag the ones the planner noted (listed in your op briefing when present). You can add new ones you spot.

OUTPUT
Call the write_page tool. Do not emit any text outside the tool call.`;

/* ── Layer 1.5: wiki context (engine-provided structured facts) ── */

/**
 * Structured facts the pipeline already holds about the wiki being ingested
 * into. Rendered into the system prompt every run so era keys and bound
 * characters never depend on someone hand-typing them into the domain prompt.
 */
export type WikiIngestContext = {
  wikiTitle: string;
  wikiSummary: string | null;
  eras: Era[];
  /** Characters bound to this wiki, ordered primary → secondary → reference. */
  characters: Array<{
    title: string;
    summary: string | null;
    priority: string;
  }>;
};

export function renderWikiContext(ctx: WikiIngestContext): string {
  const lines: string[] = ["WIKI CONTEXT (engine-provided, authoritative)", ""];

  lines.push(
    ctx.wikiSummary?.trim()
      ? `Wiki: ${ctx.wikiTitle} — ${ctx.wikiSummary.trim()}`
      : `Wiki: ${ctx.wikiTitle}`,
  );

  lines.push("");
  if (ctx.eras.length > 0) {
    lines.push(
      "Eras (chronological). Event pages MUST use one of these keys as timeIndex.era:",
    );
    for (const era of [...ctx.eras].sort((a, b) => a.order - b.order)) {
      lines.push(`- ${era.key} — "${era.title}"`);
    }
  } else {
    lines.push(
      "Eras: none configured. Set timeIndex to null on event pages; note ordering in the body instead.",
    );
  }

  if (ctx.characters.length > 0) {
    lines.push("");
    lines.push(
      "Characters bound to this wiki (write perspective/stake for them):",
    );
    for (const c of ctx.characters) {
      const summary = c.summary?.trim() ? ` — ${c.summary.trim()}` : "";
      lines.push(`- ${c.title} (${c.priority})${summary}`);
    }
  }

  return lines.join("\n");
}

/* ── Compose system prompts ────────────────────────────────────── */

function composeSystemPrompt(
  engineInstructions: string,
  wikiContext: string | null,
  domainPrompt: string | null,
): string {
  const parts = [engineInstructions];
  if (wikiContext && wikiContext.trim() !== "") {
    parts.push(wikiContext.trim());
  }
  if (domainPrompt && domainPrompt.trim() !== "") {
    parts.push(`DOMAIN CONTEXT FOR THIS CHARACTER

${domainPrompt.trim()}`);
  }
  return parts.join("\n\n---\n\n");
}

export function plannerSystemPrompt(
  domainPrompt: string | null,
  wikiContext?: string | null,
): string {
  return composeSystemPrompt(
    ENGINE_INSTRUCTIONS_PLANNER,
    wikiContext ?? null,
    domainPrompt,
  );
}

export function writerSystemPrompt(
  domainPrompt: string | null,
  wikiContext?: string | null,
): string {
  return composeSystemPrompt(
    ENGINE_INSTRUCTIONS_WRITER,
    wikiContext ?? null,
    domainPrompt,
  );
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
  sourceType: string;
  sourceTags: string[];
  sourceContent: string;
  wikiIndex: string;
  /** Ops planned by earlier chunks of this same source (chunked planning).
   * Rendered so later chunks reuse slugs instead of inventing variants. */
  plannedSoFar?: PlanOp[];
}): string {
  const tagsLine = args.sourceTags.length
    ? `Tags: ${args.sourceTags.join(", ")}`
    : "Tags: (none)";
  const plannedBlock = args.plannedSoFar?.length
    ? `

---

# Already planned from earlier parts of this source

These slugs are claimed by earlier chunks of this same document. When this chunk covers the same entity/event, REUSE the exact slug (plans are merged across chunks) — never invent a variant slug for something listed here.

${args.plannedSoFar
  .map((op) => `- ${op.slug} (${op.type}) — ${op.title}`)
  .join("\n")}`
    : "";
  return `# New source

Title: ${args.sourceTitle}
Source type: ${args.sourceType}
${tagsLine}

---

${args.sourceContent}

---

# Existing wiki index

${args.wikiIndex}${plannedBlock}

---

Plan the operations needed to incorporate this source into the wiki. Call the plan_operations tool.`;
}

/* ── Source document (writer system suffix, prompt-cached) ─────── */

/**
 * The full source rendered as the final block of the writer's system prompt.
 * Identical across every writer call in a run — this is the block the
 * cache_control breakpoint sits on, so op N reads it at 0.1× cost.
 */
export function renderSourceDocument(
  sourceTitle: string,
  content: string,
): string {
  return `SOURCE DOCUMENT: ${sourceTitle}

${content.trim()}`;
}

/* ── User-message content for the writer ───────────────────────── */

export function writerUserMessage(args: {
  op: PlanOp;
  sourceTitle: string;
  sourceTags: string[];
  existingBody?: string;
  wikiIndexCompact: string;
  /** Whether the full source document rides along in the system prompt. */
  hasFullSource: boolean;
  /** Contradictions the planner flagged that involve this op's slug. */
  plannerContradictions?: Array<{ slugA: string; slugB: string; note: string }>;
}): string {
  const tagsLine = args.sourceTags.length
    ? `Source tags: ${args.sourceTags.join(", ")}`
    : "";
  const passages = args.op.sourcePassages?.length
    ? args.op.sourcePassages
        .map((p, i) => `[Passage ${i + 1}]\n${p}`)
        .join("\n\n")
    : args.hasFullSource
      ? "(planner did not isolate specific passages — draw directly from the SOURCE DOCUMENT in your system prompt)"
      : "(planner did not isolate specific passages — work from the rationale and title; do not invent quotes)";
  const updateBlock = args.existingBody
    ? `\n\n## EXISTING BODY (you are UPDATING this page)\n\n${args.existingBody}\n`
    : "";
  const contradictionsBlock = args.plannerContradictions?.length
    ? `\n\n## Contradictions flagged by the planner (record them in the contradictions field)\n${args.plannerContradictions
        .map((c) => `- [[${c.slugA}]] vs [[${c.slugB}]]: ${c.note}`)
        .join("\n")}`
    : "";
  return `# Op: ${args.op.action} [[${args.op.slug}]]

Type: ${args.op.type}
Title (proposed): ${args.op.title}
Rationale from planner: ${args.op.rationale}

## Source
${args.sourceTitle}
${tagsLine}

## Passages
${passages}${updateBlock}${contradictionsBlock}

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
