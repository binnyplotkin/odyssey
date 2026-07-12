import { NextRequest, NextResponse } from "next/server";
import { getAudioAssetStore } from "@odyssey/db";
import { serveSoundStream } from "@/lib/sounds-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sounds/:id/stream[?variant=processed|source]
 * Streams an audio asset for library previews and scene playback.
 * Default: canonical processed WAV, falling back to the original source.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const asset = await getAudioAssetStore().getById(id);
  if (!asset) {
    return NextResponse.json({ error: "sound not found" }, { status: 404 });
  }
  return serveSoundStream(asset, req.nextUrl.searchParams.get("variant"));
}
