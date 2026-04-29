import { NextRequest, NextResponse } from "next/server";
import { createTextToSpeechAdapter, resolveTtsAttemptOrder } from "@odyssey/engine";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const body = (await request.json()) as {
      text?: string;
      voice?: string;
      provider?: string;
    };

    if (!body.text) {
      return NextResponse.json({ error: "text is required." }, { status: 400 });
    }

    const requestedProvider = body.provider;
    const attempts = resolveTtsAttemptOrder(requestedProvider);
    const primaryProvider = attempts[0];
    const attemptErrors: string[] = [];

    for (const providerName of attempts) {
      try {
        const { provider, adapter } = createTextToSpeechAdapter(providerName);
        const defaultVoice =
          provider === "elevenlabs"
            ? (process.env.ELEVENLABS_VOICE_ID ?? "")
            : provider === "kyutai"
              ? ""
              : "alloy";
        const requestedVoice =
          provider === "elevenlabs"
            ? (body.voice ?? defaultVoice)
            : provider === "kyutai"
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
              : provider === "kyutai"
                ? "Kyutai TTS unavailable (KYUTAI_TTS_BASE_URL not set)."
                : "OpenAI TTS unavailable (missing API key).",
          );
          continue;
        }

        return NextResponse.json({
          ...audio,
          provider,
          requestedProvider: requestedProvider ?? null,
          fallbackUsed: provider !== primaryProvider,
          latencyMs: Math.round(performance.now() - startedAt),
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
        error: "TTS unavailable for all attempted providers.",
        details: attemptErrors,
        latencyMs: Math.round(performance.now() - startedAt),
      },
      { status: 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Speech generation failed.",
        latencyMs: Math.round(performance.now() - startedAt),
      },
      { status: 500 },
    );
  }
}
