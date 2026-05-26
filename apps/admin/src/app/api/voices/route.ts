import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVoiceStore, type VoiceProvider } from "@odyssey/db";
import { auth } from "@/lib/auth";
import {
  extForMime,
  isValidVoiceSlug,
  slugifyVoiceName,
  uploadSource,
} from "@/lib/voices-storage";
import { regeneratePreviewForVoice } from "@/lib/voices-preview";
import { invalidateVoicesList } from "@/lib/voices-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED_MIME = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
]);
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * GET  /api/voices                       → list all voices (newest first)
 * POST /api/voices                       → create a voice; branches on content-type:
 *
 *   multipart/form-data → Pocket TTS clone flow
 *     fields: file (audio), name, slug?, description?
 *     Creates row with provider='pocket_tts', status='uploaded', uploads source
 *     to Supabase. Extraction is NOT triggered automatically — POST
 *     /api/voices/:id/extract once you're ready.
 *
 *   application/json → hosted-provider flow (ElevenLabs / OpenAI / Cartesia)
 *     body: { provider, providerConfig, name, slug?, description?, tags?, ... }
 *     Creates row with provider as specified, providerConfig validated against
 *     a per-provider schema, status='ready' (no extraction). The voice is
 *     bindable immediately.
 */

export async function GET() {
  const voices = await getVoiceStore().list();
  return NextResponse.json({ voices });
}

export async function POST(req: NextRequest) {
  const contentType = (req.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType === "application/json") {
    return handleHostedProviderCreate(req);
  }
  if (contentType === "multipart/form-data") {
    return handlePocketUploadCreate(req);
  }
  return jsonError(
    415,
    `unsupported content-type "${contentType || "<missing>"}". Use multipart/form-data (Pocket upload) or application/json (hosted provider).`,
  );
}

// ── Pocket TTS upload flow (existing) ──────────────────────────────────

async function handlePocketUploadCreate(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "expected multipart/form-data");

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "missing field: file");
  if (file.size === 0) return jsonError(400, "empty file");
  if (file.size > MAX_BYTES) return jsonError(413, "file too large (max 20 MB)");
  if (!ACCEPTED_MIME.has(file.type)) {
    return jsonError(415, `unsupported audio type: ${file.type || "<unknown>"}`);
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return jsonError(400, "missing field: name");
  if (name.length > 80) return jsonError(400, "name too long (max 80 chars)");

  const description = String(form.get("description") ?? "").trim() || null;

  // Slug: caller-provided or derived from name. Must be unique across the
  // library; we surface 409 instead of letting Postgres throw the bare
  // unique-violation message.
  const rawSlug = String(form.get("slug") ?? "").trim();
  const slug = rawSlug ? rawSlug.toLowerCase() : slugifyVoiceName(name);
  if (!isValidVoiceSlug(slug)) {
    return jsonError(
      400,
      "slug must be lowercase alphanumerics + hyphens, 1–63 chars, starting and ending alphanumeric",
    );
  }
  const store = getVoiceStore();
  if (await store.getBySlug(slug)) {
    return jsonError(409, `slug "${slug}" is already taken`);
  }

  const session = await auth().catch(() => null);
  const createdBy = session?.user?.id ?? null;

  // Insert first so we have a stable id for the storage key, then upload.
  // If upload fails we delete the row to keep state consistent.
  const voice = await store.create({
    slug,
    name,
    description,
    createdBy,
  });

  const ext = extForMime(file.type);
  const sourcePath = `${voice.id}.${ext}`;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await uploadSource(sourcePath, bytes, file.type);
  } catch (error) {
    await store.remove(voice.id).catch(() => {});
    return jsonError(500, (error as Error).message);
  }

  const updated = await store.update(voice.id, { sourcePath });
  invalidateVoicesList();
  return NextResponse.json({ voice: updated ?? voice }, { status: 201 });
}

// ── Hosted-provider create flow (ElevenLabs, OpenAI, Cartesia) ─────────

// Per-provider config schemas. The discriminator on `provider` lets Zod
// pick the right branch and infer the providerConfig shape from the same
// payload. Adding a new provider = add a schema + a case in createBody.
const elevenLabsConfigSchema = z.object({
  voiceId: z.string().min(1, "providerConfig.voiceId is required"),
  modelId: z.string().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
});

const OPENAI_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;
const openAiConfigSchema = z.object({
  voice: z.enum(OPENAI_VOICES),
});

const cartesiaConfigSchema = z.object({
  voiceId: z.string().min(1, "providerConfig.voiceId is required"),
  modelId: z.string().optional(),
});

// Optional string that also accepts `null` — useful for clear-a-field
// flows (e.g. the ElevenLabs picker sends `language: null` when the
// preset has no labels.language). `z.string().optional()` alone accepts
// `string | undefined` only, which rejects explicit nulls with a 400.
const optionalNullableString = z.string().nullish();

const sharedHostedFields = {
  name: z.string().min(1).max(80),
  slug: z.string().optional(),
  description: optionalNullableString,
  tags: z.array(z.string()).optional(),
  language: optionalNullableString,
  gender: optionalNullableString,
  license: optionalNullableString,
  attribution: optionalNullableString,
};

const createBody = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("elevenlabs"),
    ...sharedHostedFields,
    providerConfig: elevenLabsConfigSchema,
  }),
  z.object({
    provider: z.literal("openai"),
    ...sharedHostedFields,
    providerConfig: openAiConfigSchema,
  }),
  z.object({
    provider: z.literal("cartesia"),
    ...sharedHostedFields,
    providerConfig: cartesiaConfigSchema,
  }),
]);

async function handleHostedProviderCreate(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return jsonError(400, "expected a JSON object body");
  }

  const parsed = createBody.safeParse(raw);
  if (!parsed.success) {
    // Surface the first issue with its path so the picker UI can show a
    // useful inline error rather than a generic 400.
    const first = parsed.error.issues[0];
    return jsonError(
      400,
      `${first.path.join(".") || "body"}: ${first.message}`,
    );
  }
  const body = parsed.data;

  const slug = (body.slug ?? slugifyVoiceName(body.name)).toLowerCase().trim();
  if (!isValidVoiceSlug(slug)) {
    return jsonError(
      400,
      "slug must be lowercase alphanumerics + hyphens, 1–63 chars, starting and ending alphanumeric",
    );
  }

  const store = getVoiceStore();
  if (await store.getBySlug(slug)) {
    return jsonError(409, `slug "${slug}" is already taken`);
  }

  const session = await auth().catch(() => null);
  const createdBy = session?.user?.id ?? null;

  // Hosted providers skip extraction — voice-store defaults status='ready'
  // when provider !== 'pocket_tts'.
  const voice = await store.create({
    slug,
    name: body.name,
    description: body.description ?? null,
    provider: body.provider as VoiceProvider,
    providerConfig: body.providerConfig,
    tags: body.tags,
    language: body.language ?? null,
    gender: body.gender ?? null,
    license: body.license ?? null,
    attribution: body.attribution ?? null,
    createdBy,
  });

  // Fire-and-forget the preview synth so the AuditionCard has audio to
  // play when the user lands on the detail page. Best-effort: any failure
  // logs but doesn't break create — the user can click Regenerate later.
  // The detached promise updates voice.previewPath when it lands; the
  // detail page picks it up on its next router.refresh().
  void regeneratePreviewForVoice(voice).catch((err) => {
    console.warn(
      `[voices/create] preview synth failed for ${voice.id} (${voice.slug}): ${(err as Error).message}`,
    );
  });

  invalidateVoicesList();
  return NextResponse.json({ voice }, { status: 201 });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
