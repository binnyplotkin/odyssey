import { NextRequest, NextResponse } from "next/server";
import { OpenAISpeechToTextAdapter } from "@odyssey/engine";

function getKyutaiBaseUrl() {
  return (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function isKyutaiSttEnabled() {
  return (process.env.STT_PROVIDER ?? "").trim().toLowerCase() === "kyutai";
}

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

    if (isKyutaiSttEnabled()) {
      const baseUrl = getKyutaiBaseUrl();
      if (!baseUrl) {
        return NextResponse.json(
          { error: "KYUTAI_BASE_URL is required when STT_PROVIDER=kyutai." },
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
      });

      const payload = (await response.json()) as {
        transcript?: string;
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        return NextResponse.json(
          {
            error: payload.error ?? payload.detail ?? "Kyutai transcription failed.",
          },
          { status: response.status },
        );
      }

      return NextResponse.json({
        transcript: payload.transcript ?? "",
        provider: "kyutai",
      });
    }

    const adapter = new OpenAISpeechToTextAdapter();
    const transcript = await adapter.transcribe({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
    });

    return NextResponse.json({ transcript, provider: "openai" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Transcription failed." },
      { status: 500 },
    );
  }
}
