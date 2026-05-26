import { EventTemplate, SimulationState, TurnInput, TurnResult, WorldDefinition } from "@odyssey/types";

export interface SpeechToTextAdapter {
  transcribe(input: { audioBase64: string; mimeType: string }): Promise<string>;
}

export interface TextGenerationAdapter {
  generateTurn(params: {
    world: WorldDefinition;
    state: SimulationState;
    activeEvent: EventTemplate | null;
    input: TurnInput;
    onTextDelta?: (delta: string) => void | Promise<void>;
  }): Promise<Pick<TurnResult, "narration" | "dialogue" | "uiChoices" | "audioDirectives">>;
}

export interface TextGenerationProvider {
  readonly id: string;
  createAdapter(): TextGenerationAdapter;
}

export interface TextToSpeechAdapter {
  synthesize(params: { text: string; voice: string }): Promise<{ audioBase64: string; mimeType: string } | null>;
}

// ── Streaming TTS (used by the live-harness /voice-stream route) ───────
//
// `synthesize` above is batch (single payload back). The live harness needs
// per-frame streaming so audio starts playing before the LLM finishes.
// Each adapter normalizes its provider's audio to Float32 little-endian
// base64 PCM so the consumer (browser) gets a single wire format regardless
// of which provider answered.

export type StreamingTtsChunk =
  | {
      type: "audio";
      /** Float32 little-endian PCM, base64-encoded. */
      pcmFloat32Base64: string;
      /** Sample rate of the PCM in `pcmFloat32Base64`. */
      sampleRate: number;
      /** Number of float samples in this chunk (audioByteLength / 4). */
      samples: number;
    }
  | {
      type: "error";
      message: string;
    };

/**
 * Provider-agnostic voice descriptor passed to a streaming adapter. Built
 * from a `voices` row in @odyssey/db: the adapter for the voice's provider
 * pulls what it needs (slug + embeddingUrl for Pocket; providerConfig.voiceId
 * + modelId etc. for ElevenLabs) and ignores the rest.
 */
export interface VoiceContext {
  /** Stable address: Pocket /speak slug, or a human-readable label otherwise. */
  slug: string;
  /** Pocket-only: signed URL to the .safetensors embedding in Supabase. */
  embeddingUrl?: string | null;
  /** Provider-specific settings (typed by VoiceProviderConfig in @odyssey/db). */
  providerConfig?: Record<string, unknown>;
  /**
   * Per-binding override of `providerConfig` runtime knobs (typed by
   * VoiceSettingsOverride in @odyssey/db). Provider-discriminated; the
   * adapter merges via the appropriate resolver. Null/undefined = use
   * providerConfig unchanged. Used to let one voice "template" power
   * multiple characters with different expressiveness (e.g. same
   * ElevenLabs voice, but a stoic character pins low style/high
   * stability while an emotive one cranks both).
   */
  voiceSettings?: Record<string, unknown> | null;
}

export interface StreamingTextToSpeechAdapter {
  /** Streams audio for a single text chunk (typically one sentence). */
  stream(params: {
    text: string;
    voice: VoiceContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamingTtsChunk>;
}

export interface WorldLoader {
  listWorlds(): Promise<WorldDefinition[]>;
  getWorld(worldId: string): Promise<WorldDefinition | null>;
}

export interface EventSelector {
  select(world: WorldDefinition, state: SimulationState): EventTemplate | null;
}

export interface StateReducer {
  applyTurn(params: {
    world: WorldDefinition;
    state: SimulationState;
    input: TurnInput;
    activeEvent: EventTemplate | null;
  }): { nextState: SimulationState; summary: string };
}

export interface MemorySummarizer {
  summarize(previous: string[], addition: string): string[];
}

export interface PolicyGuard {
  check(input: TurnInput, world: WorldDefinition): { allowed: boolean; reason?: string };
}
