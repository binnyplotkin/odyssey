import { z } from "zod";

// ── Scene definition (authored, mostly static) ──────────────────────
//
// A Scene is the unit of multi-character interaction. It declares who's
// present, the opening beat, and the default audio bed. Beats are short
// strings the orchestrator uses to remember "where the scene is" — they
// aren't an enum because we want the LLM to riff on them naturally.

export const sceneCharacterSchema = z.object({
  // Character slug — stable across environments, unlike the auto-generated
  // DB id. The scene runner resolves slug → charactersTable.id at runtime
  // when it calls voice-stream (which takes id, not slug).
  characterSlug: z.string().min(1),
  // Display name shown in transcripts and the orchestrator's prompt.
  displayName: z.string().min(1),
  // TTS voice id — must match a .safetensors in services/audio-rt/voices/.
  // If the voice isn't yet authored, fall back to an existing voice (the
  // scene will still run, it just won't sound distinct from the fallback).
  voice: z.string().min(1),
  // One-line description for the orchestrator's roster prompt: archetype,
  // relationship to others in the scene, what they want.
  blurb: z.string().min(1).max(280),
});

export const sceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  // 1-3 sentence description the orchestrator reads to understand the
  // setting. Keep short — this goes in every orchestration call.
  description: z.string().min(1).max(600),
  characters: z.array(sceneCharacterSchema).min(2),
  // The beat the scene opens on. The orchestrator can advance to other
  // beats by emitting a new `beatLabel`, so this is a starting state, not
  // an exhaustive list.
  openingBeat: z.string().min(1),
  // Ambience track id played behind the scene. Resolved client-side to
  // an HTMLAudioElement source. null = silence.
  defaultAmbience: z.string().nullable(),
  // Narrator voice id — used when the orchestrator emits `action:"narrate"`.
  // For Phase 1, narration routes through OpenAI TTS, so this should be one
  // of: alloy, echo, fable, onyx, nova, shimmer. "echo" is the default
  // narrator pick — clear, mid-range, distinct from any character voice.
  // Optional; if absent, narration is skipped silently.
  narratorVoice: z.string().optional(),
});

export type SceneCharacter = z.infer<typeof sceneCharacterSchema>;
export type Scene = z.infer<typeof sceneSchema>;

// ── Scene DB record (the `scenes` table) ─────────────────────────────
//
// The `definition` JSONB holds the canvas-editable shape — nodes/edges
// plus opening beat, default ambience, and the narrator voice binding.
// `nodes` and `edges` here are denormalized snapshots that mirror the
// scene_nodes / scene_edges tables; the tables are the source of truth
// for indexed lookup, the JSON snapshot is for fast reads.

export const sceneDefinitionNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  refId: z.string().nullable().optional(),
  label: z.string().min(1),
  summary: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
});

export const sceneDefinitionEdgeSchema = z.object({
  id: z.string().min(1),
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  kind: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const sceneDefinitionSchema = z.object({
  nodes: z.array(sceneDefinitionNodeSchema).default([]),
  edges: z.array(sceneDefinitionEdgeSchema).default([]),
  openingBeat: z.string().default(""),
  defaultAmbience: z.string().nullable().default(null),
  narratorVoiceId: z.string().nullable().default(null),
});

export const sceneRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().nullable(),
  title: z.string().min(1),
  prompt: z.string().default(""),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  definition: sceneDefinitionSchema,
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SceneDefinitionNode = z.infer<typeof sceneDefinitionNodeSchema>;
export type SceneDefinitionEdge = z.infer<typeof sceneDefinitionEdgeSchema>;
export type SceneDefinition = z.infer<typeof sceneDefinitionSchema>;
export type SceneRecord = z.infer<typeof sceneRecordSchema>;

// ── Scene runtime state (mutable, lives on the WorldSession) ─────────
//
// Persisted on `worldSessions.currentScene` (jsonb). The orchestrator
// reads + updates this between turns.

export const sceneStateSchema = z.object({
  sceneId: z.string().min(1),
  beat: z.string().min(1),
  // Character slugs of everyone currently in the scene. Subset of the
  // scene definition's roster — a character can be marked absent and
  // re-introduced later via the orchestrator's narration.
  presentCharacterSlugs: z.array(z.string()),
  ambience: z.string().nullable(),
  // Slug of the most recent speaker (or "user"/"narrator"). Used by the
  // orchestrator to avoid repeating the same speaker by default — it can
  // still pick them again if the beat demands it.
  lastSpeakerSlug: z.string().nullable(),
  // Monotonic counter — incremented on every orchestration decision so we
  // can correlate decisions with the turns they spawned.
  turnIndex: z.number().int().min(0),
});

export type SceneState = z.infer<typeof sceneStateSchema>;

// ── Orchestrator I/O ─────────────────────────────────────────────────
//
// Strict JSON schema — fed to Cerebras as the `response_format`. Keep
// fields minimal: every property here costs prompt tokens to describe and
// output tokens to fill, both of which add to per-turn latency.

export const orchestratorActionSchema = z.enum([
  "speak",        // a character speaks; speakerId + beat required
  "narrate",      // the narrator speaks literal text
  "wait-for-user",// scene pauses until the user says something
  "end-scene",    // wrap up
]);

export const sfxCueSchema = z.object({
  id: z.string().min(1),
  // "now": play immediately, before the next speaker starts.
  // "with-speaker": layer under the speaker's TTS audio.
  at: z.enum(["now", "with-speaker"]),
});

export const orchestratorDecisionSchema = z.object({
  action: orchestratorActionSchema,

  // ── For action="speak" ─────────────────────────────────────────
  speakerId: z.string().optional(),
  // 1-line direction for the speaker — what they should react to or
  // push toward. NOT a script — the character LLM still writes the
  // words. Example: "Abraham confronts Sarah about her laughter at the
  // promise of a son."
  beat: z.string().optional(),
  // Optional scene-level note appended to the speaker's promptChunk.
  // Use sparingly — costs LLM prompt tokens on the downstream turn.
  sceneCue: z.string().optional(),

  // ── For action="narrate" ───────────────────────────────────────
  // Narrator's literal lines — these go straight to TTS, not through
  // a character LLM. Keep short (≤2 sentences).
  narration: z.string().optional(),

  // ── Audio bed (always optional) ────────────────────────────────
  ambience: z.string().nullable().optional(),
  sfx: z.array(sfxCueSchema).optional(),

  // ── Scene state ────────────────────────────────────────────────
  // Updated beat label. If unchanged from the current beat, the
  // orchestrator can omit this to save tokens.
  beatLabel: z.string().optional(),
});

export type OrchestratorAction = z.infer<typeof orchestratorActionSchema>;
export type SfxCue = z.infer<typeof sfxCueSchema>;
export type OrchestratorDecision = z.infer<typeof orchestratorDecisionSchema>;

// JSON Schema form for Cerebras `response_format: { type: "json_schema" }`.
// Hand-written rather than auto-derived from Zod so we can keep it
// minimal and explicit — Cerebras' structured-output is strict, and the
// less surface area, the fewer ways the model can go wrong.
export const ORCHESTRATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  // Strict OpenAI-compatible providers (Groq, OpenAI structured outputs)
  // require every key in `properties` to appear in `required`. Optional
  // runtime fields are represented as nullable so the model can emit null
  // when a field is not relevant for the chosen action.
  required: [
    "action",
    "speakerId",
    "beat",
    "sceneCue",
    "narration",
    "ambience",
    "sfx",
    "beatLabel",
  ],
  properties: {
    action: {
      type: "string",
      enum: ["speak", "narrate", "wait-for-user", "end-scene"],
    },
    speakerId: { type: ["string", "null"] },
    beat: { type: ["string", "null"] },
    sceneCue: { type: ["string", "null"] },
    narration: { type: ["string", "null"] },
    ambience: { type: ["string", "null"] },
    sfx: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "at"],
        properties: {
          id: { type: "string" },
          at: { type: "string", enum: ["now", "with-speaker"] },
        },
      },
    },
    beatLabel: { type: ["string", "null"] },
  },
} as const;
