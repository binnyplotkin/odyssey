import { NextRequest, NextResponse } from "next/server";
import { getCharacterVersionStore } from "@odyssey/db";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/characters/:id/versions/:versionId → single version with snapshot
 * DELETE /api/characters/:id/versions/:versionId → remove the version
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; versionId: string }> },
) {
  const { versionId } = await ctx.params;
  const version = await getCharacterVersionStore().getById(versionId);
  if (!version) return NextResponse.json({ error: "version not found" }, { status: 404 });
  return NextResponse.json({ version });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await ctx.params;
  const removed = await getCharacterVersionStore().delete(versionId);
  if (!removed) return NextResponse.json({ error: "version not found" }, { status: 404 });
  invalidateCharacterDetail(id);
  return NextResponse.json({ ok: true });
}
