/**
 * Ingestion-prompt generator — drafts the DOMAIN CONTEXT layer (Layer 2) for
 * a wiki from the engine's structured context plus the character brief: the
 * world owner's plain-language explanation of who the character is.
 *
 * Three inputs with clear owners:
 *   1. Predefined structure — the engine owns it (section skeleton below,
 *      plus the embedded live planner/writer instructions).
 *   2. Structured context — the engine supplies it (wiki context block:
 *      title/summary, eras, bound characters).
 *   3. Seed context — the ONLY thing the user provides: the character brief.
 *
 * Deliberately no sample-source input: the ingestion prompt is a standing
 * lens over every future source; deriving it from whichever document arrived
 * first would bias it toward that document's vocabulary and scope. Naming
 * conventions harden later from the wiki itself (the planner sees the full
 * index each run).
 *
 * The output is a DRAFT: callers surface it for human review and explicit
 * save. A generated prompt only becomes authoritative once a person approves
 * it (authored = axiomatic in the trust model).
 */

import { call } from "./client";
import type { ModelId } from "./models";
import {
  ENGINE_INSTRUCTIONS_PLANNER,
  ENGINE_INSTRUCTIONS_WRITER,
} from "./prompts";

const GENERATOR_SYSTEM_PROMPT = `You write the DOMAIN CONTEXT layer (the "ingestion prompt") for a wiki-ingestion engine. Your output is appended verbatim to the system prompts of two downstream models, whose instructions are reproduced below so you know exactly what they do and what they cannot know on their own.

<planner-instructions>
${ENGINE_INSTRUCTIONS_PLANNER}
</planner-instructions>

<writer-instructions>
${ENGINE_INSTRUCTIONS_WRITER}
</writer-instructions>

WHAT THE ENGINE ALREADY PROVIDES — NEVER RESTATE
The engine injects an authoritative WIKI CONTEXT block (provided in the user message) carrying era keys and bound characters, and its own instructions cover all mechanics: slugs, wikilinks, page types, tool schemas. Your output must contain ONLY domain judgment the engine cannot derive.

YOUR PRIMARY INPUT — THE CHARACTER BRIEF
The user message contains a character brief: the world owner's plain-language explanation of who this character is. Treat it as authoritative, authored truth about the character and their world. Derive the perspective, editorial-priority, and pitfalls sections FROM the brief — expand what it implies; do not contradict it or invent facts beyond it.

WRITE THESE SECTIONS
1. World & canon — what this wiki covers; what counts as in-scope truth.
2. Editorial priorities — what deserves pages vs. a passing mention; what to skip.
3. Perspective — how the bound character(s) relate to this material; what "firsthand" vs "heard" vs "inferred" typically means in this domain.
4. Source handling — how to weight source tiers here (primary vs secondary vs tertiary in this domain); when a secondary source may create pages vs only annotate existing ones.
5. Naming conventions — canonical display names and slug stems for entities the brief names, especially ones with variants (map each variant to one slug). Keep this section thin if the brief names few entities — conventions harden later as the wiki grows.
6. Known pitfalls — ambiguities, easily-conflated entities, chronology traps.

CONSTRAINTS
- 400-1000 words. Plain prose and bullets under "## " subheadings, one per section above (house style for ingestion prompts). No h1.
- Be concrete: name actual entities, eras, and traditions from the brief and wiki context.
- Output ONLY the prompt text. No preamble, no commentary, no sign-off.`;

export type GenerateIngestionPromptArgs = {
  model: ModelId;
  /** Rendered Layer-1.5 block (see loadWikiContext / renderWikiContext). */
  wikiContext: string;
  /** The world owner's explanation of who this character is. Optional —
   * without it the generator works from the wiki context alone. */
  characterBrief?: string | null;
};

export type GeneratedIngestionPrompt = {
  prompt: string;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
};

export async function generateIngestionPrompt(
  args: GenerateIngestionPromptArgs,
): Promise<GeneratedIngestionPrompt> {
  const sections: string[] = [
    `# Wiki context (as the downstream models will see it)`,
    args.wikiContext.trim(),
  ];

  const brief = args.characterBrief?.trim();
  if (brief) {
    sections.push(`# Character brief (authoritative — from the world owner)`, brief);
  } else {
    sections.push(
      `# Character brief`,
      `(none provided — work from the wiki context alone and keep editorial sections conservative)`,
    );
  }

  sections.push(
    `Write the domain-context prompt for this wiki. Output only the prompt text.`,
  );

  const result = await call({
    model: args.model,
    system: GENERATOR_SYSTEM_PROMPT,
    messages: [{ role: "user", content: sections.join("\n\n") }],
    // 1000 words ≈ 1.4k tokens; generous headroom so slug tables and
    // pitfalls never truncate (a cut-off draft is worse than a long one).
    maxTokens: 4096,
  });

  if (result.stopReason === "max_tokens") {
    throw new Error(
      "prompt generator hit the output-token cap — draft would be truncated; retry (or trim the brief)",
    );
  }

  const prompt = result.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();

  if (!prompt) {
    throw new Error(
      `prompt generator returned no text; stop=${result.stopReason}`,
    );
  }

  return {
    prompt,
    model: args.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    tokens: result.tokens,
  };
}
