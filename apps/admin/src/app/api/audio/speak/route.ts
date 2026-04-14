import { NextRequest, NextResponse } from "next/server";
import { createTextToSpeechAdapter } from "@odyssey/engine";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      text?: string;
      voice?: string;
      provider?: "openai" | "elevenlabs";
    };

    if (!body.text) {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }

    const requestedProvider = body.provider ?? "elevenlabs";
    const fallbackProvider = requestedProvider === "openai" ? "elevenlabs" : "openai";
    const attempts = [requestedProvider, fallbackProvider] as const;
    const attemptErrors: string[] = [];

    for (const providerName of attempts) {
      try {
        const { provider, adapter } = createTextToSpeechAdapter(providerName);
        const defaultVoice = provider === "elevenlabs"
          ? (process.env.ELEVENLABS_VOICE_ID ?? "")
          : "alloy";
        const requestedVoice = provider === "elevenlabs"
          ? (body.voice ?? defaultVoice)
          : "alloy";

        const audio = await adapter.synthesize({
          text: body.text,
          voice: requestedVoice,
        });

        if (!audio) {
          attemptErrors.push(
            provider === "elevenlabs"
              ? "ElevenLabs unavailable (missing key or voice ID)."
              : "OpenAI TTS unavailable (missing API key).",
          );
          continue;
        }

        return NextResponse.json({
          ...audio,
          provider,
          requestedProvider,
          fallbackUsed: provider !== requestedProvider,
        });
      } catch (attemptError) {
        attemptErrors.push(
          attemptError instanceof Error
            ? `${providerName}: ${attemptError.message}`
            : `${providerName}: speech generation failed`,
        );
      }
    }

    return NextResponse.json(
      {
        error: "TTS unavailable for both providers.",
        details: attemptErrors,
      },
      { status: 503 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speech generation failed." },
      { status: 500 },
    );
  }
}
