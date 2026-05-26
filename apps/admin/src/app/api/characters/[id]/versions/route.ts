import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getCharacterVersionStore } from "@odyssey/db";
import { auth } from "@/lib/auth";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/characters/:id/versions       → list versions (newest first)
 * POST /api/characters/:id/versions       → snapshot current state as a new
 *                                            version. Body is empty (versions
 *                                            are auto-numbered v1, v2, …).
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const versions = await getCharacterVersionStore().listForCharacter(id);
  return NextResponse.json({ versions });
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // Defensive — short-circuit before the store throws when the character
  // doesn't exist (and gives a 404 instead of a 500).
  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const session = await auth().catch(() => null);
  const createdBy = session?.user?.id ?? null;

  const version = await getCharacterVersionStore().save({
    characterId: id,
    createdBy,
  });
  invalidateCharacterDetail(id);
  return NextResponse.json({ version }, { status: 201 });
}
