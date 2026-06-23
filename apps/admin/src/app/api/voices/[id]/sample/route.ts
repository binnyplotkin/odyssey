import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";
import {
  downloadEmbeddingBytes,
  downloadSourceBytes,
} from "@/lib/voices-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/:id/sample
 * Streams the best playable clip for picker previews:
 *  1) original uploaded source clip
 *  2) synthesized preview clip fallback
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const voice = await getVoiceStore().getById(id);
  if (!voice) {
    return NextResponse.json({ error: "voice not found" }, { status: 404 });
  }
  const variant = req.nextUrl.searchParams.get("variant");
  const preferPreview = variant === "preview";
  const preferSource = variant === "source";

  const serve = (bytes: Buffer, path: string) =>
    new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": detectAudioMime(bytes, path),
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
      },
    });

  if (!preferPreview && voice.sourcePath) {
    const bytes = await downloadSourceBytes(voice.sourcePath).catch(() => null);
    if (bytes) {
      return serve(bytes, voice.sourcePath);
    }
  }
  if (voice.previewPath) {
    const bytes = await downloadEmbeddingBytes(voice.previewPath).catch(() => null);
    if (bytes) {
      return serve(bytes, voice.previewPath);
    }
  }
  if (preferPreview || preferSource) {
    return NextResponse.json({ error: "sample unavailable" }, { status: 404 });
  }
  if (voice.sourcePath) {
    const bytes = await downloadSourceBytes(voice.sourcePath).catch(() => null);
    if (bytes) {
      return serve(bytes, voice.sourcePath);
    }
  }
  return NextResponse.json({ error: "sample unavailable" }, { status: 404 });
}

function detectAudioMime(bytes: Buffer, path: string): string {
  const sig = sniffAudioMime(bytes);
  if (sig) return sig;
  return mimeFromPath(path);
}

function sniffAudioMime(bytes: Buffer): string | null {
  if (bytes.length >= 12) {
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x41 &&
      bytes[10] === 0x56 &&
      bytes[11] === 0x45
    ) {
      return "audio/wav";
    }
    if (
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    ) {
      return "audio/mp4";
    }
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    return "audio/mpeg";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return "audio/ogg";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "audio/webm";
  }
  return null;
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
