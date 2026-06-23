import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  createSourceSignedUrl,
  removeVoiceObjects,
} from "@/lib/voices-storage";
import { invalidateVoicesList } from "@/lib/voices-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/voices/:id     → voice record + signed URLs for source +
 *                              embedding + character usage count
 * PATCH  /api/voices/:id     → JSON { name?, slug?, description?, tags?,
 *                              language?, gender?, license?, attribution?,
 *                              providerConfig? }
 *                              providerConfig is replaced wholesale (not
 *                              deep-merged) — caller sends the full object.
 * DELETE /api/voices/:id     → removes blobs + row (FK ON DELETE SET NULL
 *                              clears characters.voice_id automatically)
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getVoiceStore();
  const voice = await store.getById(id);
  if (!voice) return jsonError(404, "voice not found");

  const [sourceUrl, embeddingUrl, previewUrl, boundCharacterCount] = await Promise.all([
    voice.sourcePath ? createSourceSignedUrl(voice.sourcePath).catch(() => null) : null,
    voice.embeddingPath ? createEmbeddingSignedUrl(voice.embeddingPath).catch(() => null) : null,
    voice.previewPath ? createEmbeddingSignedUrl(voice.previewPath).catch(() => null) : null,
    store.countCharactersUsing(id),
  ]);
  return NextResponse.json({
    voice: { ...voice, boundCharacterCount },
    sourceUrl,
    embeddingUrl,
    previewUrl,
  });
}

type PatchBody = {
  name?: string;
  slug?: string;
  description?: string | null;
  tags?: string[];
  language?: string | null;
  gender?: string | null;
  license?: string | null;
  attribution?: string | null;
  providerConfig?: Record<string, unknown>;
};

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

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

  const store = getVoiceStore();
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return jsonError(400, "name cannot be empty");
    if (trimmed.length > 80) return jsonError(400, "name too long (max 80 chars)");
    update.name = trimmed;
  }

  if (body.slug !== undefined) {
    const trimmed = body.slug.trim().toLowerCase();
    if (!trimmed) return jsonError(400, "slug cannot be empty");
    if (trimmed.length > 60) return jsonError(400, "slug too long (max 60 chars)");
    if (!SLUG_RE.test(trimmed)) {
      return jsonError(400, "slug must be lowercase letters, digits, and hyphens");
    }
    const existing = await store.getBySlug(trimmed);
    if (existing && existing.id !== id) {
      return jsonError(409, `slug "${trimmed}" is already taken`);
    }
    update.slug = trimmed;
  }

  if (body.description !== undefined) {
    update.description =
      body.description === null ? null : body.description.trim() || null;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return jsonError(400, "tags must be an array");
    const cleaned = Array.from(
      new Set(
        body.tags
          .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
          .filter((t) => t.length > 0 && t.length <= 40),
      ),
    );
    update.tags = cleaned;
  }

  if (body.language !== undefined) {
    update.language =
      body.language === null ? null : body.language.trim() || null;
  }
  if (body.gender !== undefined) {
    update.gender = body.gender === null ? null : body.gender.trim() || null;
  }
  if (body.license !== undefined) {
    update.license = body.license === null ? null : body.license.trim() || null;
  }
  if (body.attribution !== undefined) {
    update.attribution =
      body.attribution === null ? null : body.attribution.trim() || null;
  }

  if (body.providerConfig !== undefined) {
    // Replace wholesale. Shape is provider-specific and validated in the
    // form layer — we just make sure it's a plain object (not an array,
    // not a primitive) before persisting it to the jsonb column.
    if (
      body.providerConfig === null ||
      typeof body.providerConfig !== "object" ||
      Array.isArray(body.providerConfig)
    ) {
      return jsonError(400, "providerConfig must be a plain object");
    }
    update.providerConfig = body.providerConfig;
  }

  const voice = await store.update(id, update);
  if (!voice) return jsonError(404, "voice not found");
  invalidateVoicesList();
  return NextResponse.json({ voice });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const store = getVoiceStore();
  const existing = await store.getById(id);
  if (!existing) return jsonError(404, "voice not found");

  await removeVoiceObjects({
    sourcePath: existing.sourcePath,
    embeddingPath: existing.embeddingPath,
    previewPath: existing.previewPath,
  });
  await store.remove(id);
  invalidateVoicesList();
  return NextResponse.json({ ok: true });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
