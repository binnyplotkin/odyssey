import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";
import { regeneratePreviewForVoice } from "@/lib/voices-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/voices/:id/preview
 *
 * Re-synthesizes the canonical audition clip for a voice using its
 * current providerConfig (or, for Pocket, the existing embedding) and
 * uploads it to voice-embeddings/<id>.preview.<ext>. On success the
 * row's previewPath is updated; the detail page's AuditionCard plays
 * the refreshed clip on the next router.refresh().
 *
 * Behaviour by provider:
 *   - pocket_tts   → audio-rt /speak with the existing embedding (~2–5s).
 *                    Does NOT re-derive the .safetensors — that's what
 *                    /extract is for, exposed via the Re-extract row in
 *                    the Danger Zone.
 *   - elevenlabs   → ElevenLabs /v1/text-to-speech (~300–1500ms).
 *   - openai       → 501. Build follows ElevenLabs.
 *   - cartesia     → 501. Build follows ElevenLabs.
 *
 * Synchronous — synth is fast enough that the async + polling pattern
 * from /extract would add more friction than it saves.
 */

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getVoiceStore();
  const voice = await store.getById(id);
  if (!voice) return jsonError(404, "voice not found");

  if (voice.provider === "openai" || voice.provider === "cartesia") {
    return jsonError(
      501,
      `Preview regeneration for ${voice.provider} is not yet wired up. ElevenLabs and Pocket are supported.`,
    );
  }

  if (voice.provider === "pocket_tts" && !voice.embeddingPath) {
    return jsonError(
      409,
      "Pocket voice has no embedding yet — run /extract once before regenerating the audition clip.",
    );
  }

  try {
    const previewPath = await regeneratePreviewForVoice(voice);
    if (!previewPath) {
      // canSynth said no — surface the most likely reason per provider.
      if (voice.provider === "elevenlabs") {
        return jsonError(
          409,
          "voice.providerConfig.voiceId is missing or ELEVENLABS_API_KEY is not configured. Set the voiceId under §01 Provider Config and save before regenerating.",
        );
      }
      return jsonError(409, "voice can't be auditioned in its current state.");
    }
    const updated = await store.getById(voice.id);
    const signedUrl = await createEmbeddingSignedUrl(previewPath).catch(
      () => null,
    );
    return NextResponse.json({
      voice: updated,
      previewPath,
      previewUrl: signedUrl,
    });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.warn(
      `[voices/preview] synth failed for ${voice.id} (${voice.provider}): ${message}`,
    );
    return jsonError(502, message);
  }
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
