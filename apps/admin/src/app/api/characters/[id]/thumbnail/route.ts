import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getCharacterStore } from "@odyssey/db";
import { isAvatarGradientKey } from "@/lib/avatar-gradients";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";
import {
  CHARACTER_THUMBNAILS_BUCKET,
  getSupabaseStorageClient,
} from "@/lib/supabase-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anything where R+G+B falls under this combined threshold (out of 765)
 * is considered "near-black" and gets alpha=0. 24 was chosen by eye to
 * cover anti-aliased edges without nibbling into legitimately dark colors.
 * Higher values strip more pixels; lower values leave jagged fringes.
 */
const NEAR_BLACK_RGB_SUM_THRESHOLD = 24;

async function stripNearBlackBackground(input: Buffer): Promise<Buffer> {
  // ensureAlpha guarantees a 4-channel raw buffer even if the source was
  // JPEG (3-channel) — otherwise the per-pixel loop below would shift by
  // 3 and corrupt the image.
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] <= NEAR_BLACK_RGB_SUM_THRESHOLD) {
      pixels[i + 3] = 0;
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * POST   /api/characters/:id/thumbnail
 *   multipart/form-data with field `file` (image) → uploads to the
 *   Supabase Storage `character-thumbnails` bucket, clears
 *   `thumbnailColor`, writes the public URL to `image`.
 *
 * PATCH  /api/characters/:id/thumbnail
 *   JSON `{ thumbnailColor: <gradient-key> | null }` → sets the named
 *   gradient and clears any uploaded image. Pass null to clear both
 *   (renderer falls back to the legacy slug-hash gradient).
 *
 * Returns the updated CharacterRecord.
 */

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const store = getCharacterStore();
  const existing = await store.getById(id);
  if (!existing) return jsonError(404, "character not found");

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, "expected multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "missing field: file");
  if (!ACCEPTED.has(file.type)) return jsonError(415, `unsupported type: ${file.type}`);
  if (file.size === 0) return jsonError(400, "empty file");
  if (file.size > MAX_BYTES) return jsonError(413, "file too large (max 4 MB)");

  // "true" / "1" both count as enabled — FormData stringifies everything.
  const removeBlackRaw = form.get("removeBlackBackground");
  const removeBlack =
    typeof removeBlackRaw === "string" &&
    (removeBlackRaw === "true" || removeBlackRaw === "1");

  // When stripping black, we force the output to PNG so the alpha channel
  // survives — JPEG would silently flatten the transparency.
  const ext = removeBlack
    ? "png"
    : file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
        ? "webp"
        : "jpg";
  const contentType = removeBlack ? "image/png" : file.type;

  let body: Buffer | File = file;
  if (removeBlack) {
    const input = Buffer.from(await file.arrayBuffer());
    try {
      body = await stripNearBlackBackground(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(422, `image processing failed: ${msg}`);
    }
  }

  // Timestamped object key avoids CDN cache hits when the same character
  // uploads a new image. Old objects are orphaned for now — cleanup can
  // be a follow-up sweep if Storage cost becomes a concern.
  const objectPath = `${existing.id}/${Date.now()}.${ext}`;

  const supabase = getSupabaseStorageClient();
  const { error: uploadError } = await supabase.storage
    .from(CHARACTER_THUMBNAILS_BUCKET)
    .upload(objectPath, body, {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
      upsert: false,
    });
  if (uploadError) return jsonError(500, `upload failed: ${uploadError.message}`);

  const { data: publicUrlData } = supabase.storage
    .from(CHARACTER_THUMBNAILS_BUCKET)
    .getPublicUrl(objectPath);

  const updated = await store.update(id, {
    image: publicUrlData.publicUrl,
    thumbnailColor: null,
  });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

type PatchBody = { thumbnailColor: string | null };

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  if (body.thumbnailColor !== null && !isAvatarGradientKey(body.thumbnailColor)) {
    return jsonError(400, "unknown gradient key");
  }

  const updated = await getCharacterStore().update(id, {
    thumbnailColor: body.thumbnailColor,
    image: null,
  });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
