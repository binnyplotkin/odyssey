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
// The route itself returns ~immediately; the heavy work runs in a detached
// promise. maxDuration only caps the synchronous portion (validation +
// status flip + spawn). Background extraction has no per-request limit and
// can run as long as the Node container is alive.
export const maxDuration = 30;

/**
 * POST /api/voices/:id/extract
 *
 * Two-phase orchestrator:
 *
 *   Synchronous (returns 202 in <1s):
 *     1. Validate the voice + source clip
 *     2. Flip status='processing', clear statusError
 *     3. Spawn the background pipeline (no await)
 *     4. Return 202
 *
 *   Background (detached promise, runs as long as the pod is alive):
 *     5. Download source clip from voice-sources
 *     6. POST to audio-rt /export-voice (base64 + mimeType)
 *     7. Upload returned .safetensors bytes to voice-embeddings/<slug>.safetensors
 *     8. Synthesize a short smoke-test phrase via audio-rt /speak using the
 *        newly-extracted embedding, upload as .preview.wav (best-effort —
 *        failures don't break the extraction).
 *     9. Mark row status='ready' with embeddingPath + previewPath set
 *
 * Any background failure → status='failed' with statusError populated.
 * Polling on /voices/[slug] surfaces both the in-flight Processing UI
 * and the final state via router.refresh().
 *
 * Re-runnable: the client retry button POSTs again, re-entering the flow
 * from step 1. Source clip stays in the bucket across retries.
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

  // Detach. We deliberately don't await — the response goes back as 202
  // so the client can refresh + render the Processing UI immediately. The
  // background promise updates the row when it lands (success or failure),
  // and the page's 3s polling picks up the change.
  //
  // Errors are caught and persisted in runExtraction itself; this `void`
  // is the last line of defense against unhandled-rejection warnings.
  void runExtraction({
    voiceId: id,
    voiceSlug: voice.slug,
    sourcePath: voice.sourcePath,
  }).catch((err) => {
    console.error(`[voices/extract] unhandled error for ${id}:`, err);
  });

  return NextResponse.json({ status: "processing" }, { status: 202 });
}

async function runExtraction(args: {
  voiceId: string;
  voiceSlug: string;
  sourcePath: string;
}): Promise<void> {
  const { voiceId, voiceSlug, sourcePath } = args;
  const store = getVoiceStore();
  const startedAt = Date.now();
  console.log(`[voices/extract] ${voiceId} (${voiceSlug}) started`);

  try {
    const sourceBytes = await downloadSourceBytes(sourcePath);
    const audioBase64 = sourceBytes.toString("base64");
    const mimeType = mimeFromPath(sourcePath);

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

    const embeddingPath = `${voiceSlug}.safetensors`;
    await uploadEmbedding(embeddingPath, embeddingBytes);

    // Best-effort smoke-test preview. Audio-rt fetches the embedding via the
    // signed URL we just signed, runs /speak, returns SSE. We drain + wrap
    // as WAV + upload. Failures here log but don't fail the extraction —
    // the voice is already usable; previewPath simply stays null.
    const previewPath = await synthAndUploadPreview({
      ttsBaseUrl,
      voiceSlug,
      embeddingPath,
    });

    await store.update(voiceId, {
      status: "ready",
      statusError: null,
      embeddingPath,
      previewPath,
    });
    console.log(
      `[voices/extract] ${voiceId} (${voiceSlug}) ready in ${Date.now() - startedAt}ms` +
        (previewPath ? ` (preview ok)` : ` (preview skipped)`),
    );
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    console.warn(
      `[voices/extract] ${voiceId} (${voiceSlug}) failed in ${Date.now() - startedAt}ms: ${message}`,
    );
    await store
      .update(voiceId, { status: "failed", statusError: message })
      .catch((updateErr) => {
        // If we can't even persist the failure status, log loudly so the
        // row doesn't sit at 'processing' forever silently.
        console.error(
          `[voices/extract] ${voiceId} additionally failed to persist failure status:`,
          updateErr,
        );
      });
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
