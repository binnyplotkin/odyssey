import { NextResponse } from "next/server";
import type { AudioAssetRecord } from "@odyssey/db";
import {
  downloadSoundProcessedBytes,
  downloadSoundSourceBytes,
} from "./sounds-storage";

/**
 * Shared serve logic for the /api/sounds/[id]/stream and
 * /api/sounds/by-slug/[slug]/stream routes: prefer the canonical processed
 * WAV, fall back to the original source bytes. `variant` pins one or the
 * other (404 instead of falling back).
 */
export async function serveSoundStream(
  asset: AudioAssetRecord,
  variant: string | null,
): Promise<Response> {
  const preferSource = variant === "source";
  const preferProcessed = variant === "processed";

  const serve = (bytes: Buffer, contentType: string) =>
    new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        // Processed WAVs are immutable per path (upsert rewrites are rare
        // and re-ingest bumps updatedAt) but keep parity with the voices
        // sample route: private, no store.
        "Cache-Control": "private, no-store",
      },
    });

  if (!preferSource && asset.processedPath) {
    const bytes = await downloadSoundProcessedBytes(asset.processedPath).catch(
      () => null,
    );
    if (bytes) return serve(bytes, "audio/wav");
  }
  if (!preferProcessed && asset.sourcePath) {
    const bytes = await downloadSoundSourceBytes(asset.sourcePath).catch(
      () => null,
    );
    if (bytes) return serve(bytes, mimeFromPath(asset.sourcePath));
  }
  return NextResponse.json({ error: "sound unavailable" }, { status: 404 });
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "webm":
      return "audio/webm";
    case "ogg":
      return "audio/ogg";
    default:
      return "application/octet-stream";
  }
}
