import { NextRequest, NextResponse } from "next/server";
import { OpenAISpeechToTextAdapter } from "@odyssey/engine";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      audioBase64?: string;
      mimeType?: string;
    };

    if (!body.audioBase64 || !body.mimeType) {
      return NextResponse.json(
        { error: "audioBase64 and mimeType are required." },
        { status: 400 },
      );
    }

    const adapter = new OpenAISpeechToTextAdapter();
    const transcript = await adapter.transcribe({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
    });

    return NextResponse.json({ transcript });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed." },
      { status: 500 },
    );
  }
}
