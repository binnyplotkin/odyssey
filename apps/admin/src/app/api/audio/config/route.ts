import { NextResponse } from "next/server";
import { getAudioRuntimeConfig } from "@odyssey/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getAudioRuntimeConfig();
    const kyutaiBaseUrl = (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
    const sttProvider = (process.env.STT_PROVIDER ?? "openai").trim().toLowerCase();
    const ttsProvider = (process.env.TTS_PROVIDER ?? "").trim().toLowerCase();
    const replyModel = (process.env.AUDIO_REPLY_MODEL ?? "gpt-4o-mini").trim();

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      config: {
        ...config,
        llm: {
          replyModel,
        },
        routing: {
          sttProvider,
          ttsProvider: ttsProvider || config.tts.primaryProvider,
        },
        kyutai: {
          configured: Boolean(kyutaiBaseUrl),
          baseUrl: kyutaiBaseUrl || null,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load audio config.",
      },
      { status: 500 },
    );
  }
}
