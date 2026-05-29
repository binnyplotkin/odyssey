import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import {
  createStreamingTtsAdapterForVoice,
  createTextToSpeechAdapter,
  type StreamingTtsProvider,
  type VoiceForRouting,
} from "@odyssey/engine";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_VOICE_NAMES = new Set([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

type NarrateBody = {
  text?: string;
  // The scene's narrator voice identifier. Either a library voice id (set by
  // the scene editor's voice picker) or a bare provider voice name like
  // "fable" (authored/static scenes). The endpoint disambiguates.
  voiceId?: string | null;
};

/**
 * POST /api/scenes/narrate
 *
 * Synthesizes narrator speech. A library voice id routes through the SAME
 * streaming TTS pipeline characters use (createStreamingTtsAdapterForVoice),
 * returning PCM frames the scene player feeds into SceneAudioBus — so the
 * narrator sounds like the chosen library voice, not an OpenAI fallback.
 * A bare OpenAI voice name (or no voice) falls back to batch OpenAI TTS.
 */
export async function POST(req: NextRequest) {
  let body: NarrateBody;
  try {
    body = (await req.json()) as NarrateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required." }, { status: 400 });
  }

  const voiceId = body.voiceId?.trim() || null;

  // 1. Library voice → stream through the character TTS pipeline.
  if (voiceId && !OPENAI_VOICE_NAMES.has(voiceId)) {
    const bound = await getVoiceStore().getById(voiceId).catch(() => null);
    if (bound?.status === "ready") {
      try {
        const embeddingUrl =
          bound.provider === "pocket_tts" && bound.embeddingPath
            ? await createEmbeddingSignedUrl(bound.embeddingPath).catch(() => null)
            : null;
        const voiceForRouting: VoiceForRouting = {
          provider: bound.provider as StreamingTtsProvider,
          slug: bound.slug,
          embeddingUrl,
          providerConfig: bound.providerConfig,
        };
        const routing = createStreamingTtsAdapterForVoice(voiceForRouting);
        const frames: Array<{ pcm: string; sampleRate: number }> = [];
        for await (const frame of routing.adapter.stream({
          text,
          voice: routing.voiceContext,
        })) {
          if (frame.type === "audio") {
            frames.push({ pcm: frame.pcmFloat32Base64, sampleRate: frame.sampleRate });
          } else if (frame.type === "error") {
            throw new Error(frame.message);
          }
        }
        return NextResponse.json({ kind: "pcm", provider: routing.provider, frames });
      } catch (err) {
        // Fall through to OpenAI batch so narration still plays even if the
        // library voice's provider is misconfigured.
        console.error("[scenes/narrate] library voice failed, falling back", err);
      }
    }
  }

  // 2. Fallback: batch OpenAI TTS using a valid voice name (or "echo").
  const openaiVoice = voiceId && OPENAI_VOICE_NAMES.has(voiceId) ? voiceId : "echo";
  try {
    const { provider, adapter } = createTextToSpeechAdapter("openai");
    const audio = await adapter.synthesize({ text, voice: openaiVoice });
    if (!audio) {
      return NextResponse.json(
        { error: "OpenAI TTS unavailable (missing API key)." },
        { status: 503 },
      );
    }
    return NextResponse.json({
      kind: "mp3",
      provider,
      audioBase64: audio.audioBase64,
      mimeType: audio.mimeType,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Narration failed." },
      { status: 500 },
    );
  }
}
