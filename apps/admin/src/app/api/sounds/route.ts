import { NextRequest, NextResponse } from "next/server";
import { getAudioAssetStore, type AudioAssetSource } from "@odyssey/db";
import { auth } from "@/lib/auth";
import { isValidVoiceSlug, slugifyVoiceName } from "@/lib/voice-slug";
import {
  soundExtForMime,
  uploadSoundProcessed,
  uploadSoundSource,
} from "@/lib/sounds-storage";

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
 * GET  /api/sounds → list all audio assets (newest first)
 * POST /api/sounds → multipart/form-data, two modes:
 *
 *   Create: fields = name, slug?, description?, tags? (JSON array),
 *     loopable? ("true"), source? ("upload"|"elevenlabs_sfx"),
 *     generationPrompt?, file (original bytes), processed (canonical
 *     48k mono s16 WAV from the client ingest pass), durationS, rmsDb,
 *     peakDb. Row is inserted first (stable id for the storage key),
 *     blobs second; the row is deleted if the upload fails.
 *
 *   Re-ingest: fields = assetId + processed (+ metrics). Attaches a
 *     processed WAV to an existing row (e.g. the seeded tent-evening or
 *     a migrated legacy track) and flips it to status='ready'.
 *
 * The ingest transcode itself happens client-side (see lib/audio-ingest);
 * this route only validates and stores.
 */

export async function GET() {
  const sounds = await getAudioAssetStore().list();
  return NextResponse.json({ sounds });
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "expected multipart/form-data");

  const processed = form.get("processed");
  if (!(processed instanceof File) || processed.size === 0) {
    return jsonError(400, "missing field: processed (canonical WAV)");
  }
  if (processed.size > MAX_BYTES * 3) {
    // Processed WAV is uncompressed; allow more headroom than the source.
    return jsonError(413, "processed WAV too large");
  }

  const metrics = {
    durationS: numberField(form, "durationS"),
    rmsDb: numberField(form, "rmsDb"),
    peakDb: numberField(form, "peakDb"),
  };

  const assetId = String(form.get("assetId") ?? "").trim();
  if (assetId) return handleReingest(assetId, processed, metrics);
  return handleCreate(form, processed, metrics);
}

type Metrics = {
  durationS: number | null;
  rmsDb: number | null;
  peakDb: number | null;
};

async function handleReingest(
  assetId: string,
  processed: File,
  metrics: Metrics,
) {
  const store = getAudioAssetStore();
  const asset = await store.getById(assetId);
  if (!asset) return jsonError(404, "sound not found");

  const processedPath = `${asset.id}.wav`;
  try {
    await uploadSoundProcessed(
      processedPath,
      Buffer.from(await processed.arrayBuffer()),
    );
  } catch (error) {
    return jsonError(500, (error as Error).message);
  }

  const session = await auth().catch(() => null);
  const updated = await store.update(asset.id, {
    processedPath,
    status: "ready",
    statusError: null,
    sampleRate: 48_000,
    ...metrics,
    updatedBy: session?.user?.id ?? null,
  });
  return NextResponse.json({ sound: updated ?? asset });
}

async function handleCreate(form: FormData, processed: File, metrics: Metrics) {
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "missing field: file");
  if (file.size === 0) return jsonError(400, "empty file");
  if (file.size > MAX_BYTES) return jsonError(413, "file too large (max 20 MB)");
  if (file.type && !ACCEPTED_MIME.has(file.type)) {
    return jsonError(415, `unsupported audio type: ${file.type || "<unknown>"}`);
  }

  const name = String(form.get("name") ?? "").trim();
  if (!name) return jsonError(400, "missing field: name");
  if (name.length > 80) return jsonError(400, "name too long (max 80 chars)");

  const description = String(form.get("description") ?? "").trim() || null;
  const generationPrompt =
    String(form.get("generationPrompt") ?? "").trim() || null;
  const loopable = String(form.get("loopable") ?? "") === "true";
  const rawSource = String(form.get("source") ?? "upload");
  const source: AudioAssetSource =
    rawSource === "elevenlabs_sfx" ? "elevenlabs_sfx" : "upload";

  let tags: string[] = [];
  const rawTags = String(form.get("tags") ?? "").trim();
  if (rawTags) {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) {
        tags = parsed.map((t) => String(t).trim()).filter(Boolean);
      }
    } catch {
      tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
    }
  }

  const rawSlug = String(form.get("slug") ?? "").trim();
  const slug = rawSlug ? rawSlug.toLowerCase() : slugifyVoiceName(name);
  if (!isValidVoiceSlug(slug)) {
    return jsonError(
      400,
      "slug must be lowercase alphanumerics + hyphens, 1–63 chars, starting and ending alphanumeric",
    );
  }
  const store = getAudioAssetStore();
  if (await store.getBySlug(slug)) {
    return jsonError(409, `slug "${slug}" is already taken`);
  }

  const session = await auth().catch(() => null);
  const createdBy = session?.user?.id ?? null;

  // Insert first so we have a stable id for the storage keys, then upload.
  // If either upload fails we delete the row to keep state consistent.
  const asset = await store.create({
    slug,
    name,
    description,
    tags,
    loopable,
    source,
    generationPrompt,
    createdBy,
  });

  const ext = soundExtForMime(file.type || "audio/mpeg");
  const sourcePath = `${asset.id}.${ext}`;
  const processedPath = `${asset.id}.wav`;
  try {
    await uploadSoundSource(
      sourcePath,
      Buffer.from(await file.arrayBuffer()),
      file.type || "application/octet-stream",
    );
    await uploadSoundProcessed(
      processedPath,
      Buffer.from(await processed.arrayBuffer()),
    );
  } catch (error) {
    await store.remove(asset.id).catch(() => {});
    return jsonError(500, (error as Error).message);
  }

  const updated = await store.update(asset.id, {
    sourcePath,
    processedPath,
    status: "ready",
    sampleRate: 48_000,
    ...metrics,
  });
  return NextResponse.json({ sound: updated ?? asset }, { status: 201 });
}

function numberField(form: FormData, key: string): number | null {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
