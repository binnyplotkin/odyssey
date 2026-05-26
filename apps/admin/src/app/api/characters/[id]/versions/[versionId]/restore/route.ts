import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCharacterVersionStore } from "@odyssey/db";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/versions/:versionId/restore
 *
 * Applies the version's snapshot to the live character row + replaces
 * the bindings list. Returns the updated character. The current state
 * is *not* auto-snapshotted first — save a version before restoring if
 * you want it preserved.
 */

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await ctx.params;
  const updated = await getCharacterVersionStore().restore(versionId);
  if (!updated) {
    return NextResponse.json({ error: "version not found" }, { status: 404 });
  }
  // Restore rewrites the live character row + bindings — every cached
  // payload touching this character needs to refresh.
  invalidateCharactersList();
  invalidateCharacterDetail(id);
  revalidatePath(`/characters/${updated.slug}`);
  return NextResponse.json({ character: updated });
}
