import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  uploadPreview,
} from "@/lib/voices-storage";
import { synthVoiceAudio } from "@/lib/voices-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/voices/:id/previews
 *   → list takes + signed playback URLs.
 *
 * POST /api/voices/:id/previews
 *   Two payload shapes — branches on whether the body has `prompt`
 *   (synthesize a new take from text) or `path` (register an existing
 *   bucket path, primarily for imported clips):
 *
 *     Synthesize :  { label, prompt }
 *       Hits the voice's configured provider (Pocket via audio-rt, or
 *       ElevenLabs via /v1/text-to-speech) with the supplied prompt,
 *       uploads the result to voice-embeddings/takes/<voiceId>/<slug>-
 *       <ts>.<ext>, and creates a preview row pointing at it.
 *
 *     Register   :  { label, path, durationS?, sampleRate? }
 *       `path` is assumed to already be in the voice-embeddings bucket.
 *       Only the metadata row is created. Useful for clips uploaded out-
 *       of-band.
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const previews = await getVoiceStore().listPreviews(id);
  const withUrls = await Promise.all(
    previews.map(async (p) => ({
      ...p,
      playbackUrl: await createEmbeddingSignedUrl(p.path).catch(() => null),
    })),
  );
  return NextResponse.json({ previews: withUrls });
}

type PostBody = {
  label?: string;
  /** Set on the Synthesize branch — text to feed the provider TTS. */
  prompt?: string;
  /** Set on the Register branch — path that's already in the bucket. */
  path?: string;
  durationS?: number | null;
  sampleRate?: number | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  const label = body.label?.trim();
  if (!label) return jsonError(400, "label is required");
  if (label.length > 60) return jsonError(400, "label too long (max 60 chars)");

  const store = getVoiceStore();
  const voice = await store.getById(id);
  if (!voice) return jsonError(404, "voice not found");

  const prompt = body.prompt?.trim();
  const path = body.path?.trim();
  if (prompt) {
    return handleSynthesize({ voiceId: voice.id, label, prompt });
  }
  if (path) {
    const preview = await store.addPreview(id, {
      label,
      path,
      durationS: body.durationS ?? null,
      sampleRate: body.sampleRate ?? null,
    });
    return NextResponse.json({ preview });
  }
  return jsonError(
    400,
    "supply either `prompt` (to synthesize a take) or `path` (to register an existing bucket path)",
  );
}

async function handleSynthesize(args: {
  voiceId: string;
  label: string;
  prompt: string;
}) {
  if (args.prompt.length > 600) {
    return jsonError(
      400,
      "prompt too long (max 600 chars). Audition takes are short on purpose — split into multiple takes if you need more.",
    );
  }
  const store = getVoiceStore();
  const voice = await store.getById(args.voiceId);
  if (!voice) return jsonError(404, "voice not found");
  if (voice.status !== "ready") {
    return jsonError(
      409,
      `voice status is "${voice.status}" — synthesize takes only after the voice is ready.`,
    );
  }

  try {
    const { bytes, ext, contentType } = await synthVoiceAudio(
      voice,
      args.prompt,
    );
    // Path layout: bucket/takes/<voiceId>/<labelSlug>-<timestamp>.<ext>
    //  - <voiceId> keeps takes grouped per voice even if the slug changes
    //  - <labelSlug>-<timestamp> stays human-readable in the bucket and
    //    collides only if the same user creates two takes in the same ms
    const takePath = `takes/${voice.id}/${slugifyLabel(args.label)}-${Date.now()}.${ext}`;
    await uploadPreview(takePath, bytes, contentType);
    const preview = await store.addPreview(voice.id, {
      label: args.label,
      path: takePath,
      prompt: args.prompt,
      durationS: null,
      sampleRate: null,
    });
    const playbackUrl = await createEmbeddingSignedUrl(takePath).catch(
      () => null,
    );
    return NextResponse.json({ preview, playbackUrl });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.warn(
      `[voices/previews] synthesize failed for ${voice.id}: ${message}`,
    );
    return jsonError(502, message);
  }
}

function slugifyLabel(label: string): string {
  // Loose slugify — keep it readable, lowercase, no spaces, no path
  // separators. Trailing/leading dashes are trimmed.
  const out = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || "take";
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
