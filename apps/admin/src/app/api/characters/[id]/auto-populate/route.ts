import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getCharacterStore,
  getWikiStore,
  getWikisStore,
  type CharacterVoiceStyle,
} from "@odyssey/db";
import { call, extractToolUse } from "@odyssey/wiki-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Persona drafting reads whole knowledge graphs — allow a slow generation.
export const maxDuration = 120;

/**
 * POST /api/characters/:id/auto-populate
 *
 * Drafts persona config (identity / voice / examples / limits) from author
 * direction plus selected knowledge graphs. Returns a DRAFT only — nothing
 * is persisted here. The client reviews per-section and applies through the
 * existing /identity, /voice-style and /directive routes so validation and
 * cache invalidation stay on one path.
 */

const BodySchema = z.object({
  direction: z.string().trim().max(4000).optional(),
  wikiIds: z.array(z.string().trim().min(1)).max(6).default([]),
  sections: z.object({
    identity: z.boolean().default(false),
    voice: z.boolean().default(false),
    examples: z.boolean().default(false),
    limits: z.boolean().default(false),
  }),
  mode: z.enum(["fill", "overwrite"]).default("fill"),
});

type SectionsRequested = z.infer<typeof BodySchema>["sections"];

/** What the LLM tool call must return — mirrors the persona types with the
 * same caps the authoring UI enforces, so drafts always pass the section
 * routes' validation untouched. */
const DraftSchema = z.object({
  identity: z
    .object({
      essence: z.string().trim().max(140).optional(),
      traits: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(24),
            description: z.string().trim().min(1).max(280),
          }),
        )
        .max(2)
        .optional(),
      era: z.string().trim().max(120).optional(),
      setting: z.string().trim().max(120).optional(),
    })
    .optional(),
  voiceStyle: z
    .object({
      tone: z.array(z.string().trim().min(1).max(40)).max(4).optional(),
      decision: z.string().trim().max(120).optional(),
      brevity: z
        .enum(["terse", "short", "medium", "long", "paragraph"])
        .optional(),
      register: z
        .object({
          formality: z.number().min(-1).max(1),
          warmth: z.number().min(-1).max(1),
        })
        .optional(),
      voicePrompt: z.string().trim().max(2000).optional(),
    })
    .optional(),
  exemplars: z
    .array(
      z.object({
        user: z.string().trim().min(1),
        you: z.string().trim().min(1),
        tags: z.array(z.string().trim().min(1)).max(8).optional(),
        rationale: z.string().trim().max(400).optional(),
      }),
    )
    .max(8)
    .optional(),
  limits: z
    .object({
      refuse: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
      never: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
      framing: z.string().trim().max(2000).optional(),
      guidance: z.string().trim().max(2000).optional(),
    })
    .optional(),
});

export type AutoPopulateDraft = z.infer<typeof DraftSchema>;

/* ── Wiki context gathering ────────────────────────────────────── */

const MAX_CONTEXT_CHARS = 24_000;
const MAX_PAGES_PER_WIKI = 60;
const VOICE_IDENTITY_BODY_CHARS = 4_000;
const PAGE_SUMMARY_CHARS = 280;

async function gatherWikiContext(wikiIds: string[]): Promise<string> {
  if (wikiIds.length === 0) return "";
  const wikisStore = getWikisStore();
  const wikiStore = getWikiStore();

  const chunks: string[] = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const wikiId of wikiIds) {
    if (budget <= 0) break;
    const wiki = await wikisStore.getWikiById(wikiId).catch(() => null);
    const pages = await wikiStore.listPagesForWiki(wikiId).catch(() => []);
    if (!wiki && pages.length === 0) continue;

    const lines: string[] = [`<graph title="${wiki?.title ?? wikiId}">`];
    if (wiki?.summary) lines.push(wiki.summary.trim());

    // Voice-identity sheets carry the densest persona signal — include
    // their body; everything else contributes a title+summary line.
    const voicePages = pages.filter((p) => p.type === "voice_identity");
    for (const p of voicePages) {
      const body = p.body.trim().slice(0, VOICE_IDENTITY_BODY_CHARS);
      if (body) lines.push(`\n## ${p.title} (voice identity)\n${body}`);
    }

    const rest = pages
      .filter((p) => p.type !== "voice_identity")
      .slice(0, MAX_PAGES_PER_WIKI);
    if (rest.length > 0) {
      lines.push("\n## Pages");
      for (const p of rest) {
        const summary = (p.summary ?? "").trim().slice(0, PAGE_SUMMARY_CHARS);
        lines.push(`- ${p.title} (${p.type})${summary ? `: ${summary}` : ""}`);
      }
      if (pages.length - voicePages.length > rest.length) {
        lines.push(
          `- …and ${pages.length - voicePages.length - rest.length} more pages omitted`,
        );
      }
    }
    lines.push("</graph>");

    const chunk = lines.join("\n").slice(0, budget);
    budget -= chunk.length;
    chunks.push(chunk);
  }

  return chunks.join("\n\n");
}

/* ── Tool schema (built per request so `required` matches the ask) ── */

function buildToolSchema(sections: SectionsRequested) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (sections.identity) {
    properties.identity = {
      type: "object",
      description:
        "Foundational essence. essence ≤140 chars; exactly 2 traits.",
      properties: {
        essence: {
          type: "string",
          description:
            "One-sentence anchor for who this character is. Max 140 chars.",
        },
        traits: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Short noun, 1–24 chars (e.g. 'faith').",
              },
              description: {
                type: "string",
                description: "One-sentence justification, ≤280 chars.",
              },
            },
            required: ["name", "description"],
          },
        },
        era: { type: "string", description: "Time period, e.g. '~2000 BCE'." },
        setting: { type: "string", description: "Place, e.g. 'Canaan'." },
      },
      required: ["essence", "traits"],
    };
    required.push("identity");
  }

  if (sections.voice) {
    properties.voiceStyle = {
      type: "object",
      description: "Text-channel voice axes. Audio/TTS binding is separate.",
      properties: {
        tone: {
          type: "array",
          maxItems: 4,
          items: { type: "string" },
          description: "2–4 short tone words (e.g. 'weathered', 'reverent').",
        },
        decision: {
          type: "string",
          description:
            "How they choose, ≤120 chars (impulsive ↔ deliberate ↔ paralyzed).",
        },
        brevity: {
          type: "string",
          enum: ["terse", "short", "medium", "long", "paragraph"],
        },
        register: {
          type: "object",
          properties: {
            formality: {
              type: "number",
              description: "-1 casual … +1 formal",
            },
            warmth: { type: "number", description: "-1 cool … +1 warm" },
          },
          required: ["formality", "warmth"],
        },
        voicePrompt: {
          type: "string",
          description:
            "≤2000 chars describing the sonic character of the voice (pace, texture, breath) for the TTS layer.",
        },
      },
      required: ["tone", "brevity", "register"],
    };
    required.push("voiceStyle");
  }

  if (sections.examples) {
    properties.exemplars = {
      type: "array",
      minItems: 3,
      maxItems: 5,
      description:
        "Canonical USER→YOU exchanges. Show-don't-tell; the strongest steering signal. Write replies in the character's actual voice at the configured brevity.",
      items: {
        type: "object",
        properties: {
          user: { type: "string", description: "What the user says." },
          you: {
            type: "string",
            description: "The character's reply, fully in voice.",
          },
          tags: {
            type: "array",
            maxItems: 8,
            items: { type: "string" },
            description:
              "Free-text scope hints (e.g. 'faith under doubt'). These define what the character engages with.",
          },
          rationale: {
            type: "string",
            description: "Why this exchange works, ≤400 chars.",
          },
        },
        required: ["user", "you", "tags"],
      },
    };
    required.push("exemplars");
  }

  if (sections.limits) {
    properties.limits = {
      type: "object",
      properties: {
        refuse: {
          type: "array",
          maxItems: 12,
          items: { type: "string" },
          description:
            "Topics to deflect gracefully in-voice, short lowercase phrases.",
        },
        never: {
          type: "array",
          maxItems: 12,
          items: { type: "string" },
          description:
            "Hard rules enforced every turn, phrased as 'Do not …'.",
        },
        framing: {
          type: "string",
          description:
            "Disclosure framing for when a player presses on whether the character is real (dramatized-portrayal acknowledgement). ≤2000 chars.",
        },
        guidance: {
          type: "string",
          description:
            "Free-form guidance the model should weigh when uncertain. ≤2000 chars.",
        },
      },
      required: ["refuse", "never"],
    };
    required.push("limits");
  }

  return {
    type: "object" as const,
    properties,
    required,
  };
}

/* ── Route ─────────────────────────────────────────────────────── */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let parsedBody: z.infer<typeof BodySchema>;
  try {
    parsedBody = BodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "Invalid request body.");
  }

  const { direction, wikiIds, sections, mode } = parsedBody;
  if (!Object.values(sections).some(Boolean)) {
    return jsonError(400, "Select at least one section to populate.");
  }

  const character = await getCharacterStore().getById(id);
  if (!character) return jsonError(404, "character not found");

  const wikiContext = await gatherWikiContext(wikiIds);

  const system = [
    "You author persona configuration for a voice-first character simulation engine.",
    "The config you produce compiles directly into the character's system prompt, so every word earns its tokens.",
    "",
    "Principles:",
    "- Ground everything in the supplied knowledge graphs; never invent biography the sources don't support.",
    "- Write in the character's own idiom — exemplar replies especially must sound like the character speaking aloud, not a narrator describing them.",
    "- This is a real-time VOICE experience: favor brevity, spoken rhythm, and concrete language over literary prose.",
    "- Respect every length cap in the tool schema; shorter and sharper beats complete and bland.",
    mode === "fill"
      ? "- FILL MODE: the character has existing authored config (shown below). Preserve its content and intent verbatim where present; only supply what is missing or empty. When a field already has a good value, return that value unchanged."
      : "- REWORK MODE: propose the best possible config from scratch. Existing config is shown for reference only — improve on it freely.",
  ].join("\n");

  const currentConfig = JSON.stringify(
    {
      title: character.title,
      summary: character.summary,
      identity: character.identity,
      voiceStyle: pruneAudioFields(character.voiceStyle),
      directive: character.directive,
    },
    null,
    2,
  );

  const userMessage = [
    `<character title="${character.title}">`,
    `Current config (JSON):`,
    currentConfig,
    `</character>`,
    ...(wikiContext
      ? ["", "<knowledge>", wikiContext, "</knowledge>"]
      : []),
    ...(direction
      ? ["", "<author-direction>", direction, "</author-direction>"]
      : []),
    "",
    "Draft the requested persona sections using the draft_persona tool.",
  ].join("\n");

  let raw: unknown;
  try {
    const result = await call({
      model: "claude-sonnet-4-5",
      system,
      messages: [{ role: "user", content: userMessage }],
      tools: [
        {
          name: "draft_persona",
          description:
            "Return the drafted persona sections for this character.",
          input_schema: buildToolSchema(sections),
        },
      ],
      toolChoice: { type: "tool", name: "draft_persona" },
      maxTokens: 4096,
    });
    raw = extractToolUse(result, "draft_persona");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Persona generation failed.";
    return jsonError(502, message);
  }

  // Validate + clamp the model output; drop sections that weren't asked for.
  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(502, `Model returned an invalid draft: ${parsed.error.message}`);
  }
  const draft: AutoPopulateDraft = {};
  if (sections.identity && parsed.data.identity) draft.identity = parsed.data.identity;
  if (sections.voice && parsed.data.voiceStyle) draft.voiceStyle = parsed.data.voiceStyle;
  if (sections.examples && parsed.data.exemplars) draft.exemplars = parsed.data.exemplars;
  if (sections.limits && parsed.data.limits) draft.limits = parsed.data.limits;

  return NextResponse.json({ draft });
}

/** Strip audio-channel fields from the voiceStyle shown to the model — it
 * shouldn't echo reference clips or TTS bindings back into the draft. */
function pruneAudioFields(
  voiceStyle: CharacterVoiceStyle | null,
): Partial<CharacterVoiceStyle> | null {
  if (!voiceStyle) return null;
  const { referenceClipUrl: _clip, prosody: _prosody, ...rest } = voiceStyle;
  return rest;
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
