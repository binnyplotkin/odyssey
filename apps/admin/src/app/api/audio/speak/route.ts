import { NextRequest, NextResponse } from "next/server";
import { createTextToSpeechAdapter, resolveTtsAttemptOrder } from "@odyssey/engine";

function getKyutaiBaseUrl() {
  return (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function isKyutaiTtsRequest(provider?: string) {
  if (provider !== undefined) {
    return provider.trim().toLowerCase() === "kyutai";
  }
  return (process.env.TTS_PROVIDER ?? "").trim().toLowerCase() === "kyutai";
}

async function arrayBufferToBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64");
}

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

    if (isKyutaiTtsRequest(body.provider)) {
      const baseUrl = getKyutaiBaseUrl();
      if (!baseUrl) {
        return NextResponse.json(
          { error: "KYUTAI_BASE_URL is required when TTS provider=kyutai." },
          { status: 503 },
        );
      }

      const response = await fetch(`${baseUrl}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body.text,
          voice: body.voice ?? null,
        }),
        signal: AbortSignal.timeout(120000),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok) {
        const errorPayload = contentType.includes("application/json")
          ? ((await response.json()) as { error?: string; detail?: string })
          : { error: await response.text() };
        return NextResponse.json(
          {
            error: errorPayload.error ?? errorPayload.detail ?? "Kyutai TTS failed.",
            provider: "kyutai",
            requestedProvider: "kyutai",
            latencyMs: Math.round(performance.now() - startedAt),
          },
          { status: response.status },
        );
      }

      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as {
          audioBase64?: string;
          mimeType?: string;
          provider?: string;
          fallbackUsed?: boolean;
        };
        return NextResponse.json({
          audioBase64: payload.audioBase64 ?? "",
          mimeType: payload.mimeType ?? "audio/mpeg",
          provider: payload.provider ?? "kyutai",
          requestedProvider: "kyutai",
          fallbackUsed: payload.fallbackUsed ?? false,
          latencyMs: Math.round(performance.now() - startedAt),
        });
      }

      const audioBuffer = await response.arrayBuffer();
      return NextResponse.json({
        audioBase64: await arrayBufferToBase64(audioBuffer),
        mimeType: contentType || "audio/mpeg",
        provider: "kyutai",
        requestedProvider: "kyutai",
        fallbackUsed: false,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    }

    const requestedProvider = body.provider;
    const attempts = resolveTtsAttemptOrder(requestedProvider);
    const primaryProvider = attempts[0];
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
        error: "TTS unavailable for both providers.",
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
