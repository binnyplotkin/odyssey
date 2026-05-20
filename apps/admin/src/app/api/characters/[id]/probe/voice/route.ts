import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getVoiceStore } from "@odyssey/db";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/probe/voice
 *
 * The L03 "Spoken preview" path. Synthesizes a short sample of the
 * character's voice using the Kyutai Pocket TTS service (the same one
 * the live voice path already uses) and returns the audio as a single
 * base64-encoded WAV so the harness can play it inline.
 *
 * Flow:
 *   1. Resolve voice id — explicit `voiceStyle.voiceId` if set, else the
 *      character's slug. The audio-rt service maps that to a baked
 *      `.safetensors` file under services/audio-rt/voices/.
 *   2. POST to ${KYUTAI_TTS_BASE_URL}/speak — receives SSE: meta /
 *      audio chunks / done / error.
 *   3. Accumulate the int16 LE PCM chunks, wrap in a 44-byte WAV
 *      header, base64-encode, return.
 *
 * Returns audio in one shot (not streamed) — keeps the client trivial
 * (just `new Audio("data:audio/wav;base64,...")`). Latency for a one-line
 * preview is ~1–3s; fine for an authoring affordance, not the live
 * voice path (which streams).
 *
 * The voicePrompt / referenceClipUrl / prosody fields on voiceStyle
 * are NOT used by this endpoint — Pocket TTS bakes the voice into a
 * `.safetensors` ahead of time. Those fields are design-time inputs
 * for the offline bake step (`scripts/bake-voice-clip.ts`, future).
 */

const PUBLIC_TTS_FALLBACK = "https://audio-rt-production.up.railway.app";

type Body = { text?: string };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const startedAt = performance.now();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const text = body.text?.trim();
  if (!text) return jsonError(400, "text is required.");
  if (text.length > 600) {
    return jsonError(400, "text must be ≤ 600 chars for the preview path.");
  }

  const character = await getCharacterStore().getById(id);
  if (!character) return jsonError(404, "character not found.");

  // Voice resolution:
  //   - If character.voiceId is set → look up the voice, sign its embedding
  //     URL, pass both `voice` (slug for the in-process cache key) and
  //     `voiceUrl` (signed URL audio-rt fetches on cache miss).
  //   - Otherwise → fall back to character.slug, which audio-rt resolves
  //     against baked-in voices under services/audio-rt/voices/.
  let voice = character.slug;
  let voiceUrl: string | null = null;
  if (character.voiceId) {
    const bound = await getVoiceStore().getById(character.voiceId);
    if (bound?.status === "ready" && bound.embeddingPath) {
      voice = bound.slug;
      voiceUrl = await createEmbeddingSignedUrl(bound.embeddingPath).catch(
        () => null,
      );
    }
  }

  const ttsBaseUrl =
    (process.env.KYUTAI_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
    PUBLIC_TTS_FALLBACK;

  let upstream: Response;
  try {
    upstream = await fetch(`${ttsBaseUrl}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, voiceUrl }),
    });
  } catch (err) {
    return jsonError(
      502,
      `audio-rt unreachable at ${ttsBaseUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return jsonError(
      upstream.status,
      `audio-rt /speak failed (${upstream.status}): ${errText.slice(0, 200)}`,
    );
  }

  // Drain the SSE stream, collecting PCM chunks + the meta header so we
  // can construct the WAV with the right sample rate / channels.
  let sampleRate = 24000;
  let channels = 1;
  const pcmChunks: Uint8Array[] = [];
  let firstAudioMs: number | null = null;
  let totalChunks = 0;
  let upstreamError: string | null = null;

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd: number;
    while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);

      let eventName: string | null = null;
      let dataLine = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLine += line.slice(6);
      }
      if (!eventName || !dataLine) continue;
      let payload: unknown;
      try { payload = JSON.parse(dataLine); } catch { continue; }

      if (eventName === "meta") {
        const m = payload as { sampleRate?: number; channels?: number };
        if (typeof m.sampleRate === "number") sampleRate = m.sampleRate;
        if (typeof m.channels === "number") channels = m.channels;
      } else if (eventName === "audio") {
        const a = payload as { chunk?: string };
        if (typeof a.chunk !== "string") continue;
        const bytes = Buffer.from(a.chunk, "base64");
        pcmChunks.push(new Uint8Array(bytes));
        totalChunks++;
        if (firstAudioMs === null) firstAudioMs = performance.now() - startedAt;
      } else if (eventName === "error") {
        const e = payload as { message?: string };
        upstreamError = e.message ?? "audio-rt returned error event";
      }
    }
  }

  if (upstreamError) return jsonError(502, upstreamError);
  if (pcmChunks.length === 0) {
    return jsonError(502, "audio-rt returned no audio chunks");
  }

  // Concatenate PCM, wrap in WAV header, base64-encode.
  const pcm = concatBytes(pcmChunks);
  const wav = wrapPcmInWav(pcm, sampleRate, channels);
  const audioBase64 = Buffer.from(wav).toString("base64");
  const totalMs = Math.round(performance.now() - startedAt);

  return NextResponse.json({
    audioBase64,
    mimeType: "audio/wav",
    sampleRate,
    channels,
    voice,
    durationMs: pcmDurationMs(pcm.length, sampleRate, channels),
    totalMs,
    firstAudioMs: firstAudioMs !== null ? Math.round(firstAudioMs) : null,
    chunks: totalChunks,
  });
}

/* ── Helpers ─────────────────────────────────────────────── */

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Wrap raw PCM int16 LE in a canonical 44-byte WAV header.
 * Spec: http://soundfile.sapp.org/doc/WaveFormat/
 */
function wrapPcmInWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize; // header (44) - 8 (RIFF tag + size) = 36

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  let offset = 0;
  const writeString = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    offset += s.length;
  };
  const writeUint32 = (n: number) => { view.setUint32(offset, n, true); offset += 4; };
  const writeUint16 = (n: number) => { view.setUint16(offset, n, true); offset += 2; };

  writeString("RIFF");
  writeUint32(fileSize);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16);                    // fmt chunk size
  writeUint16(1);                      // PCM format
  writeUint16(channels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(bitsPerSample);
  writeString("data");
  writeUint32(dataSize);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function pcmDurationMs(byteLength: number, sampleRate: number, channels: number): number {
  const bytesPerSample = 2 * channels;
  const samples = byteLength / bytesPerSample;
  return Math.round((samples / sampleRate) * 1000);
}
