import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import { auth } from "@/lib/auth";
import {
  extForMime,
  isValidVoiceSlug,
  slugifyVoiceName,
  uploadSource,
} from "@/lib/voices-storage";

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
 * GET  /api/voices                 → list all voices (newest first)
 * POST /api/voices  (multipart)    → create row + upload source clip
 *   fields: file (audio), name (string), slug? (string), description? (string)
 *   Returns the freshly created VoiceRecord. Extraction is NOT triggered
 *   automatically — POST /api/voices/:id/extract once you're ready.
 */

export async function GET() {
  const voices = await getVoiceStore().list();
  return NextResponse.json({ voices });
}

export async function POST(req: NextRequest) {
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
  return NextResponse.json({ voice: updated ?? voice }, { status: 201 });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
