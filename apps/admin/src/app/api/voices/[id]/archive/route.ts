import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getVoiceStore } from "@odyssey/db";
import { invalidateVoicesList } from "@/lib/voices-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST   /api/voices/:id/archive   → soft-delete (sets archivedAt + updatedBy)
 * DELETE /api/voices/:id/archive   → unarchive (clears archivedAt)
 *
 * Soft-delete keeps the row + storage intact so bound characters keep
 * playing. The library `list()` filters archivedAt-set rows by default.
 */

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  const voice = await getVoiceStore().archive(id, userId);
  if (!voice) return jsonError(404, "voice not found");
  invalidateVoicesList();
  return NextResponse.json({ voice });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  const voice = await getVoiceStore().unarchive(id, userId);
  if (!voice) return jsonError(404, "voice not found");
  invalidateVoicesList();
  return NextResponse.json({ voice });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
