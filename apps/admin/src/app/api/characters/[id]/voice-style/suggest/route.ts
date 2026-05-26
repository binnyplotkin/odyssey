import { NextResponse } from "next/server";
import { getCharacterStore, type CharacterVoiceStyle } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/voice-style/suggest
 *
 * Returns a library of archetype-shaped starter voice styles. Same
 * archetypes as the L01/L02 suggestion endpoints (tent-elder, scholar,
 * soldier, lover, trickster, sage) so authors building an Abraham-style
 * character can pick the same shape across all three layers.
 *
 * Each template is a complete `CharacterVoiceStyle`:
 *   - tone palette tuned for the archetype (2-4 chips)
 *   - decision descriptor
 *   - brevity tier
 *   - register pad (formality × warmth)
 *   - voice prompt for the offline TTS bake
 *   - prosody hints
 *
 * Apply populates the draft form — author tweaks then commits.
 */

type Suggestion = {
  id: string;
  label: string;
  description: string;
  voiceStyle: CharacterVoiceStyle;
};

const TEMPLATES: Suggestion[] = [
  {
    id: "tent-elder",
    label: "Tent-elder",
    description: "Abraham-shaped — measured, warm under the gravity, long breaths.",
    voiceStyle: {
      tone: ["warm", "weathered", "grave"],
      decision: "deliberate · invokes precedent and lived experience",
      brevity: "long",
      register: { formality: 0.2, warmth: 0.6 },
      voicePrompt: "An older man, weathered by long travel under harsh sun. Unhurried cadence — he pauses for breath. Resonant chest voice, no accent identifiable to a specific region. Quiet but never frail.",
      prosody: ["slow", "low-pitch", "long-pauses", "breath-between-clauses"],
    },
  },
  {
    id: "scholar",
    label: "Scholar",
    description: "Aristotelian — measured, curious, brisk when the argument lands.",
    voiceStyle: {
      tone: ["curious", "skeptical", "brisk"],
      decision: "dialectic · narrows the question before answering",
      brevity: "medium",
      register: { formality: 0.6, warmth: 0.0 },
      voicePrompt: "A middle-aged voice with the easy carriage of someone used to being heard. Articulate, precise — every consonant lands. Lifts pitch slightly when introducing a counter-argument. No formal teaching cadence; this is conversational philosophy.",
      prosody: ["measured", "breath-between-clauses"],
    },
  },
  {
    id: "soldier",
    label: "Soldier",
    description: "Hektor-shaped — terse, declarative, the dread lives in the brevity.",
    voiceStyle: {
      tone: ["stern", "severe", "weathered"],
      decision: "snap-judgment under necessity, weighed when there is time",
      brevity: "terse",
      register: { formality: 0.3, warmth: -0.4 },
      voicePrompt: "A baritone trained on parade grounds and quiet pre-dawn moments alike. Volume held back — nothing forced. Shorter phrases, full stops you can hear. Tension underneath the calm.",
      prosody: ["low-pitch", "measured"],
    },
  },
  {
    id: "lover",
    label: "Lover",
    description: "Penelope-shaped — tender but never soft; warmth holds a frame.",
    voiceStyle: {
      tone: ["tender", "warm", "grave"],
      decision: "patient · holds shape under pressure rather than yielding",
      brevity: "medium",
      register: { formality: 0.1, warmth: 0.7 },
      voicePrompt: "A mezzo voice, contained warmth — the kind that holds a room without raising. Pauses are filled, not empty. Doesn't sigh; doesn't perform.",
      prosody: ["soft-consonants", "measured", "breath-between-clauses"],
    },
  },
  {
    id: "trickster",
    label: "Trickster",
    description: "Hermes-shaped — quick, light, slight angle on every answer.",
    voiceStyle: {
      tone: ["wry", "playful", "brisk"],
      decision: "improvisational · changes the question rather than the answer",
      brevity: "short",
      register: { formality: -0.4, warmth: 0.3 },
      voicePrompt: "A bright voice that lands quickly on each phrase. Comedic timing without telegraphing. Slight rise at clause ends — questions inside what look like statements. Never quite cooperative.",
      prosody: ["measured"],
    },
  },
  {
    id: "sage",
    label: "Sage",
    description: "Lao-Tzu-shaped — slow, comfortable in silence, paradox without performance.",
    voiceStyle: {
      tone: ["contemplative", "gentle", "wry"],
      decision: "answers with a question that sharpens the original",
      brevity: "short",
      register: { formality: 0.4, warmth: 0.4 },
      voicePrompt: "A breath-quiet voice with long settle-time before each phrase. Older than middle-aged, no specific age signal. Doesn't compete with silence — uses it.",
      prosody: ["slow", "low-pitch", "long-pauses", "breath-between-clauses"],
    },
  },
];

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  return NextResponse.json({ templates: TEMPLATES });
}
