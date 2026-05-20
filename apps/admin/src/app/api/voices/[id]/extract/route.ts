import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  downloadSourceBytes,
  uploadEmbedding,
  uploadPreview,
} from "@/lib/voices-storage";
import { drainSpeakStreamToWav } from "@/lib/voice-wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pocket TTS export-voice takes ~10–30s on a warm container, longer on a
// cold one (HF weight download). Give the whole pipeline 3 minutes before
// the platform kills the request.
export const maxDuration = 180;

/**
 * POST /api/voices/:id/extract
 *
 * Synchronous orchestrator:
 *   1. Mark row status='processing'
 *   2. Download source clip from voice-sources
 *   3. POST to audio-rt /export-voice (base64 + mimeType)
 *   4. Upload returned .safetensors bytes to voice-embeddings/<slug>.safetensors
 *   5. Synthesize a short smoke-test phrase via audio-rt /speak using the
 *      newly-extracted embedding, upload as .preview.wav (best-effort —
 *      failures don't break the extraction).
 *   6. Mark row status='ready' with embeddingPath + previewPath set
 *
 * Any failure → status='failed' with statusError populated. Re-runnable.
 */

/** Smoke-test phrase synthesized at extraction time so the detail page
 * has cached audio to play without re-synthesizing. Short, phoneme-diverse,
 * generic — works for any character. */
const PREVIEW_TEXT =
  "Hello, this is your new voice — extracted just now from your reference clip.";

const PUBLIC_TTS_FALLBACK = "https://audio-rt-production.up.railway.app";

const MIME_BY_EXT: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
};

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "audio/wav";
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getVoiceStore();
  const voice = await store.getById(id);
  if (!voice) return jsonError(404, "voice not found");
  if (!voice.sourcePath) {
    return jsonError(409, "voice has no source clip to extract from");
  }

  await store.update(id, { status: "processing", statusError: null });

  try {
    const sourceBytes = await downloadSourceBytes(voice.sourcePath);
    const audioBase64 = sourceBytes.toString("base64");
    const mimeType = mimeFromPath(voice.sourcePath);

    const ttsBaseUrl =
      (process.env.KYUTAI_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
      PUBLIC_TTS_FALLBACK;

    const upstream = await fetch(`${ttsBaseUrl}/export-voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      // Audio-rt's FastAPI 500 responses come back as
      // {"detail": "<multi-line traceback>"}. Pull the detail string out
      // so the stored statusError has real newlines (not JSON-escaped \n)
      // and the Failed UI can render the traceback structurally.
      let detail = errText;
      try {
        const parsed = JSON.parse(errText) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        // fall through with the raw text
      }
      throw new Error(`audio-rt /export-voice ${upstream.status}: ${detail}`);
    }
    const embeddingBytes = Buffer.from(await upstream.arrayBuffer());
    if (embeddingBytes.length === 0) {
      throw new Error("audio-rt returned empty embedding");
    }

    const embeddingPath = `${voice.slug}.safetensors`;
    await uploadEmbedding(embeddingPath, embeddingBytes);

    // Best-effort smoke-test preview. Audio-rt fetches the embedding via the
    // signed URL we just signed, runs /speak, returns SSE. We drain + wrap
    // as WAV + upload. Failures here log but don't fail the extraction —
    // the voice is already usable; previewPath simply stays null and the
    // detail page falls back to its "preview not generated" placeholder.
    const previewPath = await synthAndUploadPreview({
      ttsBaseUrl,
      voiceSlug: voice.slug,
      embeddingPath,
    });

    const updated = await store.update(id, {
      status: "ready",
      statusError: null,
      embeddingPath,
      previewPath,
    });
    return NextResponse.json({ voice: updated });
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    await store.update(id, { status: "failed", statusError: message });
    return jsonError(500, message);
  }
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

async function synthAndUploadPreview(args: {
  ttsBaseUrl: string;
  voiceSlug: string;
  embeddingPath: string;
}): Promise<string | null> {
  try {
    const voiceUrl = await createEmbeddingSignedUrl(args.embeddingPath);
    const upstream = await fetch(`${args.ttsBaseUrl}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: PREVIEW_TEXT,
        voice: args.voiceSlug,
        voiceUrl,
      }),
    });
    if (!upstream.ok || !upstream.body) {
      throw new Error(`audio-rt /speak ${upstream.status}`);
    }
    const wavBytes = await drainSpeakStreamToWav(upstream.body);
    const previewPath = `${args.voiceSlug}.preview.wav`;
    await uploadPreview(previewPath, Buffer.from(wavBytes));
    return previewPath;
  } catch (error) {
    console.warn(
      `[voices/extract] preview gen failed for ${args.voiceSlug}: ${(error as Error).message}`,
    );
    return null;
  }
}
