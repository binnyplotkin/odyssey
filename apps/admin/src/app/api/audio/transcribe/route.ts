import { NextRequest, NextResponse } from "next/server";
import { createSpeechToTextAdapter } from "@odyssey/engine";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const body = (await request.json()) as {
      audioBase64?: string;
      mimeType?: string;
      provider?: string;
    };

    if (!body.audioBase64 || !body.mimeType) {
      return NextResponse.json(
        { error: "audioBase64 and mimeType are required." },
        { status: 400 },
      );
    }

    const { provider, adapter } = createSpeechToTextAdapter(body.provider);
    const transcript = await adapter.transcribe({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
    });

    return NextResponse.json({
      transcript,
      provider,
      model: provider === "kyutai" ? "kyutai-stt" : "gpt-4o-mini-transcribe",
      latencyMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Transcription failed.",
        latencyMs: Math.round(performance.now() - startedAt),
      },
      { status: 500 },
    );
  }
}
