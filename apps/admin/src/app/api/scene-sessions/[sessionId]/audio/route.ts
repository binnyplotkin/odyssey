import { NextRequest, NextResponse } from "next/server";
import { getSceneSessionStore } from "@odyssey/db";
import {
  makeAudioStorageKey,
  writeSessionAudio,
} from "@/lib/session-audio-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseOptionalNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }

  const direction = typeof form.get("direction") === "string"
    ? String(form.get("direction")).trim()
    : "";
  if (direction !== "input" && direction !== "output") {
    return NextResponse.json({ error: "direction must be input or output." }, { status: 400 });
  }

  const artifactId = crypto.randomUUID();
  const mimeType = file.type || "application/octet-stream";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const storageKey = makeAudioStorageKey({
    sessionId,
    artifactId,
    direction,
    mimeType,
  });

  try {
    await writeSessionAudio(storageKey, bytes);
    const store = getSceneSessionStore();
    const artifact = await store.addAudioArtifact({
      id: artifactId,
      sessionId,
      turnId: typeof form.get("turnId") === "string" ? String(form.get("turnId")) : null,
      direction,
      mimeType,
      durationMs: parseOptionalNumber(form.get("durationMs")),
      sampleRate: parseOptionalNumber(form.get("sampleRate")),
      byteSize: bytes.byteLength,
      storageKey,
      waveformSummary: {},
      metadata: {
        filename: file.name,
        source: "admin-character-voice-panel",
      },
    });
    await store.appendEvent({
      sessionId,
      turnId: artifact.turnId ?? null,
      type: "audio.artifact",
      source: direction === "input" ? "user" : "assistant",
      payload: {
        artifactId: artifact.id,
        direction,
        mimeType,
        byteSize: artifact.byteSize,
        durationMs: artifact.durationMs,
        sampleRate: artifact.sampleRate,
      },
    });
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  try {
    const artifacts = await getSceneSessionStore().listAudioArtifacts(sessionId);
    return NextResponse.json({ artifacts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
