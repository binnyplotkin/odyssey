import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import {
  createEmbeddingSignedUrl,
  createSourceSignedUrl,
  removeVoiceObjects,
} from "@/lib/voices-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/voices/:id     → voice record + signed URLs for source +
 *                              embedding + character usage count
 * PATCH  /api/voices/:id     → JSON { name?, description? }
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

  const [sourceUrl, embeddingUrl, boundCharacterCount] = await Promise.all([
    voice.sourcePath ? createSourceSignedUrl(voice.sourcePath).catch(() => null) : null,
    voice.embeddingPath ? createEmbeddingSignedUrl(voice.embeddingPath).catch(() => null) : null,
    store.countCharactersUsing(id),
  ]);
  return NextResponse.json({
    voice: { ...voice, boundCharacterCount },
    sourceUrl,
    embeddingUrl,
  });
}

type PatchBody = { name?: string; description?: string | null };

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

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const trimmed = body.name.trim();
    if (!trimmed) return jsonError(400, "name cannot be empty");
    if (trimmed.length > 80) return jsonError(400, "name too long (max 80 chars)");
    update.name = trimmed;
  }
  if (body.description !== undefined) {
    update.description =
      body.description === null ? null : body.description.trim() || null;
  }

  const voice = await getVoiceStore().update(id, update);
  if (!voice) return jsonError(404, "voice not found");
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
  return NextResponse.json({ ok: true });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
