import { NextRequest, NextResponse } from "next/server";
import { OpenAISpeechToTextAdapter } from "@odyssey/engine";

function getKyutaiBaseUrl() {
  return (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function resolveSttProvider(requested?: string) {
  const normalized = (requested ?? process.env.STT_PROVIDER ?? "openai")
    .trim()
    .toLowerCase();
  return normalized === "kyutai" ? "kyutai" : "openai";
}

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

    const provider = resolveSttProvider(body.provider);

    if (provider === "kyutai") {
      const baseUrl = getKyutaiBaseUrl();
      if (!baseUrl) {
        return NextResponse.json(
          { error: "KYUTAI_BASE_URL is required when STT provider=kyutai." },
          { status: 503 },
        );
      }

      const response = await fetch(`${baseUrl}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: body.audioBase64,
          mimeType: body.mimeType,
        }),
        signal: AbortSignal.timeout(120000),
      });

      const payload = (await response.json()) as {
        transcript?: string;
        provider?: string;
        model?: string;
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        return NextResponse.json(
          {
            error: payload.error ?? payload.detail ?? "Kyutai transcription failed.",
            provider: "kyutai",
            latencyMs: Math.round(performance.now() - startedAt),
          },
          { status: response.status },
        );
      }

      return NextResponse.json({
        transcript: payload.transcript ?? "",
        provider: "kyutai",
        model: payload.model ?? "kyutai-stt",
        latencyMs: Math.round(performance.now() - startedAt),
      });
    }

    const adapter = new OpenAISpeechToTextAdapter();
    const transcript = await adapter.transcribe({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
    });

    return NextResponse.json({
      transcript,
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
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
