"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValidSlug, slugifyTitle } from "@odyssey/db";
import { getAdminWorldRepository } from "@/lib/worlds";
import { call, extractToolUse } from "@odyssey/wiki-ingest";
import type { WorldDefinition } from "@odyssey/types";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/* ── AI draft ──────────────────────────────────────────────── */

export type WorldDraft = {
  title: string;
  slug: string;
  setting: string;
  premise: string;
  introNarration: string;
};

export async function draftWorldFromPrompt(
  prompt: string,
): Promise<ActionResult<WorldDraft>> {
  const trimmed = prompt.trim();
  if (trimmed.length < 10) {
    return { ok: false, error: "Describe the world in a sentence or two (minimum 10 characters)." };
  }
  if (trimmed.length > 2000) {
    return { ok: false, error: "Prompt is too long (max 2000 characters)." };
  }

  const system = [
    "You are Odyssey's world architect. A user has described a world they want to build as a voice-first simulation.",
    "Draft a compelling opening frame for this world. Your output will appear in a form the user can edit.",
    "",
    "- Title: evocative, 2–6 words, no generic words like 'World' or 'Simulation'.",
    "- Slug: lowercase kebab-case (a–z, 0–9, hyphens). 2–64 chars. Must start with a letter.",
    "- Setting: one or two sentences that place the user in time, place, and atmosphere.",
    "- Premise: 2–4 sentences describing the player's situation and what's at stake.",
    "- Intro narration: the opening paragraph read aloud when the player enters. Sensory, present tense, second person. 2–4 sentences.",
    "",
    "Match the register of the user's prompt. If they reference scripture, history, fiction, or a specific period, stay faithful to that register.",
  ].join("\n");

  try {
    const result = await call({
      model: "claude-haiku-4-5",
      system,
      messages: [
        {
          role: "user",
          content: `Draft a world from this description:\n\n<description>\n${trimmed}\n</description>\n\nReturn your draft using the draft_world tool.`,
        },
      ],
      tools: [
        {
          name: "draft_world",
          description: "Return the drafted opening frame for a new world.",
          input_schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              slug: { type: "string" },
              setting: { type: "string" },
              premise: { type: "string" },
              introNarration: { type: "string" },
            },
            required: ["title", "slug", "setting", "premise", "introNarration"],
          },
        },
      ],
      toolChoice: { type: "tool", name: "draft_world" },
      maxTokens: 1200,
    });

    const out = extractToolUse<WorldDraft>(result, "draft_world");

    const title = out.title.trim().slice(0, 120);
    let slug = (out.slug || slugifyTitle(title)).toLowerCase().trim();
    if (!isValidSlug(slug)) {
      slug = slugifyTitle(title);
    }
    if (!isValidSlug(slug)) {
      return { ok: false, error: "Could not derive a valid slug. Try editing the prompt or rename after drafting." };
    }

    return {
      ok: true,
      data: {
        title,
        slug,
        setting: out.setting.trim(),
        premise: out.premise.trim(),
        introNarration: out.introNarration.trim(),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Draft failed." };
  }
}

/* ── Create ────────────────────────────────────────────────── */

export async function createWorldFromDraft(input: {
  prompt: string;
  title: string;
  slug: string;
  setting: string;
  premise: string;
  introNarration: string;
}): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  const setting = input.setting.trim();
  const premise = input.premise.trim();
  const introNarration = input.introNarration.trim();

  if (!title) return { ok: false, error: "Title is required." };
  if (!setting) return { ok: false, error: "Setting is required." };
  if (!premise) return { ok: false, error: "Premise is required." };
  if (!introNarration) return { ok: false, error: "Intro narration is required." };

  const slug = (input.slug.trim() || slugifyTitle(title)).toLowerCase();
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      error: "Slug must be lowercase kebab-case, start with a letter, 2–64 chars.",
    };
  }

  const repo = getAdminWorldRepository();
  const existing = await repo.getWorldById(slug);
  if (existing) {
    return { ok: false, error: `A world with slug "${slug}" already exists.` };
  }

  const definition: WorldDefinition = {
    id: slug,
    title,
    setting,
    premise,
    introNarration,
    norms: ["This world runs without the player — when they pause, time continues."],
    powerStructures: ["Who holds power here is still being defined."],
    tonalConstraints: ["Stay faithful to the register of the opening description."],
    safetyProfile: {
      historicalThemes: [],
      disallowedContent: [
        "sexual violence or assault",
        "graphic gore or torture",
        "instructions for real-world harm",
      ],
    },
    roles: [
      {
        id: "protagonist",
        title: "Protagonist",
        summary: "The player's entry point into this world.",
        responsibilities: ["Engage with the world through conversation and choice."],
      },
    ],
    groups: [],
    characters: [
      {
        id: "narrator-placeholder",
        name: "Placeholder",
        title: "A presence in this world",
        archetype: "witness",
        motivations: ["Observe and respond to the player's arrival."],
        emotionalBaseline: { anger: 20, fear: 20, hope: 60, loyalty: 50 },
        speakingStyle: "To be defined.",
      },
    ],
    eventTemplates: [
      {
        id: "opening-beat",
        title: "Opening beat",
        category: "encounter",
        summary: "The first moment of interaction after the intro narration.",
        urgency: 50,
        triggerWhen: {},
        stakes: ["Establish the tone and register of this world."],
        narratorPrompt: "Open the scene with a sensory observation grounded in the setting.",
        actorIds: ["narrator-placeholder"],
        weight: 1,
      },
    ],
    initialState: {
      metricValues: {},
      groupInfluence: {},
      characterStates: {
        "narrator-placeholder": { anger: 20, fear: 20, hope: 60, loyalty: 50 },
      },
      relationships: {},
    },
  };

  try {
    await repo.createWorldFromDefinition({
      prompt: input.prompt.trim(),
      definition,
      status: "draft",
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Create failed." };
  }

  revalidatePath("/worlds");
  redirect(`/worlds/${slug}`);
}
