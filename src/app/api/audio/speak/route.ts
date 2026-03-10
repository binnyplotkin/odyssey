import { NextRequest, NextResponse } from "next/server";
import { OpenAITextToSpeechAdapter } from "@/lib/simulation/audio";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { text?: string; voice?: string };

    if (!body.text) {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }

    const adapter = new OpenAITextToSpeechAdapter();
    const audio = await adapter.synthesize({
      text: body.text,
      voice: body.voice ?? "alloy",
    });

    if (!audio) {
      return NextResponse.json(
        { error: "TTS unavailable without OPENAI_API_KEY." },
        { status: 503 },
      );
    }

    return NextResponse.json(audio);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speech generation failed." },
      { status: 500 },
    );
  }
}
