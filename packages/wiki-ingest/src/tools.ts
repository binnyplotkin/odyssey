/**
 * Tool-use schemas for the planner and the writer.
 *
 * Anthropic's tool use enforces the LLM emit inputs matching these schemas
 * (with `tool_choice: { type: "tool", name: ... }` making it the only allowed
 * exit). We use it to make the planner's op list and the writer's page
 * payload structurally valid by construction, while letting the *body* of a
 * page stay free-form markdown (inside the `body` string field).
 *
 * The shapes here mirror types.ts / @odyssey/db/wiki-types closely; when we
 * parse the LLM response we cast with light validation and fail loudly on
 * anything genuinely malformed.
 */

import type { Tool } from "@anthropic-ai/sdk/resources/messages";

/* ── Planner tool ──────────────────────────────────────────────── */

export const PLAN_TOOL: Tool = {
  name: "plan_operations",
  description:
    "Propose the set of wiki page operations needed to incorporate this new source into the character's knowledge graph. Do NOT write page bodies here — just the plan.",
  input_schema: {
    type: "object" as const,
    required: ["ops"],
    properties: {
      ops: {
        type: "array",
        description:
          "One entry per page to create, update, or explicitly skip. Order does not matter — the pipeline handles dependencies.",
        items: {
          type: "object",
          required: ["action", "slug", "type", "title", "rationale"],
          properties: {
            action: {
              type: "string",
              enum: ["create", "update", "skip"],
              description:
                "create = new page. update = modify existing page (its slug must match). skip = source mentions this slug but no page change is warranted.",
            },
            slug: {
              type: "string",
              description:
                "Kebab-case identifier, stable across edits. Must match existing slug for update.",
            },
            type: {
              type: "string",
              enum: [
                "entity",
                "event",
                "concept",
                "relationship",
                "timeline",
                "voice_identity",
              ],
            },
            title: { type: "string" },
            rationale: {
              type: "string",
              description:
                "One sentence: why this op is needed. Shown to the user and fed to the writer.",
            },
            sourcePassages: {
              type: "array",
              items: { type: "string" },
              description:
                "Relevant verbatim passages from the source for the writer to cite. Include 1-4.",
            },
          },
        },
      },
      contradictions: {
        type: "array",
        description:
          "Pairs of pages whose content conflicts (new source vs existing, or two new pages). Flag them; do not resolve them.",
        items: {
          type: "object",
          required: ["slugA", "slugB", "note"],
          properties: {
            slugA: { type: "string" },
            slugB: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      confidence: {
        type: "number",
        description:
          "Your rough confidence in the plan, 0..1. Under 0.6 means 'human should review before compile'.",
      },
    },
  },
};

/* ── Writer tool ───────────────────────────────────────────────── */

export const WRITE_TOOL: Tool = {
  name: "write_page",
  description:
    "Produce the full page payload for a single op: title, summary, markdown body with [[slug]] wikilinks, typed frontmatter, perspective, confidence, time index.",
  input_schema: {
    type: "object" as const,
    required: [
      "title",
      "summary",
      "body",
      "frontmatter",
      "perspective",
      "confidence",
    ],
    properties: {
      title: { type: "string" },
      summary: {
        type: "string",
        description:
          "1-2 sentence synopsis — what the curator shows when it can't afford the full body.",
      },
      body: {
        type: "string",
        description:
          "Markdown. Use [[slug|Display Text]] for wikilinks; slugs are immutable. No h1 (the title is separate).",
      },
      frontmatter: {
        type: "object",
        description:
          "Type-specific structured fields. For entity: {kind, aliases, firstAppearance, lastAppearance}. For event: {when, where, participants, causes, effects}. For concept: {aliases, instances, relatedConcepts}. For relationship: {from, to, kind, evolution}. For voice_identity: {speechPatterns, idioms, beliefs, emotionalRange, taboos}. For timeline: {} (empty).",
        additionalProperties: true,
      },
      perspective: {
        type: "object",
        required: [],
        properties: {
          knowsHow: {
            type: "string",
            enum: ["firsthand", "heard", "inferred", "unknown"],
          },
          feels: {
            type: "array",
            items: { type: "string" },
            description:
              "Short tag set: the character's emotional stance on this page.",
          },
          stake: {
            type: "string",
            description:
              "One phrase: why does this matter to the character?",
          },
        },
      },
      confidence: {
        type: "number",
        description:
          "Synthesis certainty 0..1. Under 0.7 means 'flag for re-ingest when more sources land'.",
      },
      timeIndex: {
        type: "object",
        description:
          "For event pages. {era: string (one of the era keys listed in WIKI CONTEXT), index: int (ordering within era)}. Null for non-temporal pages.",
        required: ["era", "index"],
        properties: {
          era: { type: "string" },
          index: { type: "number" },
        },
      },
      knowsFuture: {
        type: "boolean",
        description:
          "True if the character was promised this but hasn't lived through it yet (covenant future, prophecy, etc).",
      },
      contradictions: {
        type: "array",
        description:
          "Other pages on the same character that conflict with this one.",
        items: {
          type: "object",
          required: ["otherSlug", "note"],
          properties: {
            otherSlug: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      sourceRefs: {
        type: "array",
        description:
          "Passages in the source material that back specific claims in the body. Include quotes and loci.",
        items: {
          type: "object",
          properties: {
            passage: {
              type: "string",
              description: 'e.g. "Gen 18:1-15"',
            },
            quote: {
              type: "string",
              description: "Verbatim quote from the source.",
            },
            relevanceNote: {
              type: "string",
              description: "Why this passage supports the page.",
            },
          },
        },
      },
    },
  },
};
