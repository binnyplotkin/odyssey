import { NextRequest, NextResponse } from "next/server";
import { getWorldSessionStore } from "@odyssey/db";
import { readSessionAudio } from "@/lib/session-audio-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string; artifactId: string }> },
) {
  const { sessionId, artifactId } = await ctx.params;

  try {
    const artifact = await getWorldSessionStore().getAudioArtifact(sessionId, artifactId);
    if (!artifact) {
      return NextResponse.json({ error: "Audio artifact not found." }, { status: 404 });
    }
    const bytes = await readSessionAudio(artifact.storageKey);
    return new Response(bytes, {
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
