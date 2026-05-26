import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/voices/:id/previews/:previewId → remove a single take
 *
 * The supabase object isn't removed here — keep the .wav around so a
 * "restore" flow is possible later. Cheap storage, and gallery rows
 * delete fast.
 */

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; previewId: string }> },
) {
  const { previewId } = await ctx.params;
  const ok = await getVoiceStore().removePreview(previewId);
  if (!ok) {
    return NextResponse.json({ error: "preview not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
