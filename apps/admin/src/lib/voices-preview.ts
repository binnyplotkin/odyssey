import { getVoiceStore, type VoiceRecord } from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  uploadPreview,
} from "@/lib/voices-storage";
import { drainSpeakStreamToWav } from "@/lib/voice-wav";
import { DEFAULT_AUDITION_PROMPT } from "@/lib/voices-prompts";

/** Re-export for callers that already pull the synth helpers from
 * this module — the canonical definition lives in
 * `@/lib/voices-prompts` so client components can import it without
 * dragging the server-only deps below into the client bundle. */
export { DEFAULT_AUDITION_PROMPT } from "@/lib/voices-prompts";

/** Bytes + file extension + MIME type for a synthesized clip. Callers
 * use the extension to build the storage path (.mp3 for ElevenLabs,
 * .wav for Pocket) and the contentType for the upload. */
export type SynthResult = {
  bytes: Buffer;
  ext: "mp3" | "wav";
  contentType: string;
};

/** Synthesize arbitrary text using the voice's configured provider.
 * Multi-provider:
 *  - pocket_tts → audio-rt /speak with the row's embedding (~2–5s)
 *  - elevenlabs → ElevenLabs /v1/text-to-speech (~300–1500ms)
 *  - openai     → not yet wired up
 *  - cartesia   → not yet wired up
 *
 * Returns the synthesized bytes — does NOT upload or update the row.
 * Callers (regenerate-preview, add-take) decide where to put it. */
export async function synthVoiceAudio(
  voice: VoiceRecord,
  text: string,
): Promise<SynthResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("prompt is empty");

  if (voice.provider === "elevenlabs") {
    return synthElevenLabsForVoice(voice, trimmed);
  }
  if (voice.provider === "pocket_tts") {
    return synthPocketForVoice(voice, trimmed);
  }
  throw new Error(
    `synth not implemented for provider ${voice.provider}. ElevenLabs and Pocket are supported.`,
  );
}

/**
 * Re-synthesize the canonical audition preview for a voice and persist
 * it as `{voice.id}.preview.{ext}`. Updates `voice.previewPath`.
 *
 * Returns the new `previewPath` on success, `null` if the provider
 * isn't supported or its config is incomplete (so callers on the
 * create path can soft-skip without crashing). Throws if the upstream
 * synth or storage upload fails — callers decide whether that's hard
 * (regenerate endpoint) or soft (best-effort on create).
 */
export async function regeneratePreviewForVoice(
  voice: VoiceRecord,
): Promise<string | null> {
  // Soft-skip provider/config gaps so the create-flow caller doesn't
  // log noisy errors for voices that legitimately don't have a synth
  // path yet (OpenAI/Cartesia today; ElevenLabs voices missing voiceId).
  if (!canSynth(voice)) return null;

  const { bytes, ext, contentType } = await synthVoiceAudio(
    voice,
    DEFAULT_AUDITION_PROMPT,
  );
  const previewPath = `${voice.id}.preview.${ext}`;
  await uploadPreview(previewPath, bytes, contentType);
  await getVoiceStore().update(voice.id, { previewPath });
  return previewPath;
}

/** True iff `synthVoiceAudio` has a real path for this voice — i.e.
 * the provider is supported and any required config/keys are present.
 * Used by `regeneratePreviewForVoice` to soft-skip rather than throw. */
export function canSynth(voice: VoiceRecord): boolean {
  if (voice.provider === "elevenlabs") {
    const config = (voice.providerConfig ?? {}) as Record<string, unknown>;
    const voiceId = stringOrNull(config.voiceId);
    const apiKey = (process.env.ELEVENLABS_API_KEY ?? "").trim();
    return !!voiceId && !!apiKey;
  }
  if (voice.provider === "pocket_tts") {
    return !!voice.embeddingPath;
  }
  return false;
}

/* ── ElevenLabs ──────────────────────────────────────────────── */

async function synthElevenLabsForVoice(
  voice: VoiceRecord,
  text: string,
): Promise<SynthResult> {
  const config = (voice.providerConfig ?? {}) as Record<string, unknown>;
  const voiceId = stringOrNull(config.voiceId);
  if (!voiceId) {
    throw new Error(
      "providerConfig.voiceId is missing — set it under §01 Provider Config and save before regenerating.",
    );
  }
  const apiKey = (process.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured on this server.");
  }

  const bytes = await callElevenLabs({
    apiKey,
    voiceId,
    text,
    modelId: stringOrNull(config.modelId) ?? "eleven_multilingual_v2",
    stability: clamp01(config.stability),
    similarityBoost: clamp01(config.similarityBoost),
    style: clamp01(config.style),
  });
  return { bytes, ext: "mp3", contentType: "audio/mpeg" };
}

async function callElevenLabs(args: {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId: string;
  stability: number | null;
  similarityBoost: number | null;
  style: number | null;
}): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: args.text,
    model_id: args.modelId,
  };
  const settings: Record<string, number> = {};
  if (args.stability != null) settings.stability = args.stability;
  if (args.similarityBoost != null)
    settings.similarity_boost = args.similarityBoost;
  if (args.style != null) settings.style = args.style;
  if (Object.keys(settings).length > 0) body.voice_settings = settings;

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(args.voiceId)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": args.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
    },
  );

  if (!resp.ok) {
    // ElevenLabs returns JSON {detail: {message, status}} on errors —
    // surface the message in the thrown error so callers can render
    // something useful instead of a bare 502.
    let detail = `HTTP ${resp.status}`;
    try {
      const raw = await resp.text();
      try {
        const parsed = JSON.parse(raw) as {
          detail?: { message?: string } | string;
        };
        if (typeof parsed.detail === "string") detail = parsed.detail;
        else if (parsed.detail && typeof parsed.detail.message === "string") {
          detail = parsed.detail.message;
        } else {
          detail = raw;
        }
      } catch {
        detail = raw || detail;
      }
    } catch {
      // fall through with detail
    }
    throw new Error(`elevenlabs /text-to-speech: ${detail}`);
  }

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length === 0) throw new Error("elevenlabs returned empty audio");
  return buf;
}

/* ── Pocket TTS (audio-rt) ──────────────────────────────────── */

const POCKET_TTS_FALLBACK = "https://audio-rt-production.up.railway.app";

async function synthPocketForVoice(
  voice: VoiceRecord,
  text: string,
): Promise<SynthResult> {
  if (!voice.embeddingPath) {
    throw new Error(
      "voice has no extracted embedding yet — run /extract before synthesizing alt takes.",
    );
  }
  const ttsBaseUrl =
    (process.env.KYUTAI_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
    POCKET_TTS_FALLBACK;
  const voiceUrl = await createEmbeddingSignedUrl(voice.embeddingPath);
  const upstream = await fetch(`${ttsBaseUrl}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: voice.slug, voiceUrl }),
  });
  if (!upstream.ok || !upstream.body) {
    throw new Error(`audio-rt /speak ${upstream.status}`);
  }
  const wavBytes = await drainSpeakStreamToWav(upstream.body);
  return {
    bytes: Buffer.from(wavBytes),
    ext: "wav",
    contentType: "audio/wav",
  };
}

/* ── tiny helpers ───────────────────────────────────────────── */

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function clamp01(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}
