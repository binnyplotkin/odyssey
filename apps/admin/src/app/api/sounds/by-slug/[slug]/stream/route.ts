import { NextRequest, NextResponse } from "next/server";
import { getAudioAssetStore } from "@odyssey/db";
import { serveSoundStream } from "@/lib/sounds-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sounds/by-slug/:slug/stream[?variant=processed|source]
 * Slug-addressed variant of /api/sounds/:id/stream. The runtime track id
 * (SceneState.ambience, SceneAudioBus) is the asset slug, so playback
 * paths resolve by slug rather than UUID.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const asset = await getAudioAssetStore().getBySlug(slug);
  if (!asset) {
    return NextResponse.json({ error: "sound not found" }, { status: 404 });
  }
  return serveSoundStream(asset, req.nextUrl.searchParams.get("variant"));
}
