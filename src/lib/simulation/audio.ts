import { getOpenAIClient } from "@/lib/openai/client";
import { SpeechToTextAdapter, TextToSpeechAdapter } from "@/lib/simulation/interfaces";

export type TtsProvider = "openai" | "elevenlabs";
export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_flash_v2_5";
const NORMAL_RATE_MODEL_IDS = new Set([
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
]);

export function getElevenLabsPricingGuardInfo() {
  const configured = (process.env.ELEVENLABS_MODEL_ID || "").trim();
  const modelId = configured || ELEVENLABS_DEFAULT_MODEL_ID;
  const enforceNormalPricing = process.env.ELEVENLABS_ENFORCE_NORMAL_PRICING !== "false";
  const allowedModelIds = Array.from(NORMAL_RATE_MODEL_IDS);
  const isAllowedModel = NORMAL_RATE_MODEL_IDS.has(modelId);

  return {
    enforceNormalPricing,
    configuredModelId: configured || null,
    effectiveModelId: modelId,
    allowedModelIds,
    isAllowedModel,
  };
}

function resolveElevenLabsModelId() {
  const config = getElevenLabsPricingGuardInfo();

  if (config.enforceNormalPricing && !config.isAllowedModel) {
    throw new Error(
      `Model ${config.effectiveModelId} is blocked by ELEVENLABS_ENFORCE_NORMAL_PRICING. Use one of: ${config.allowedModelIds.join(
        ", ",
      )}.`,
    );
  }

  return config.effectiveModelId;
}

export class OpenAISpeechToTextAdapter implements SpeechToTextAdapter {
  async transcribe({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) {
    const client = getOpenAIClient();

    if (!client) {
      throw new Error("OPENAI_API_KEY is required for speech transcription.");
    }

    const transcription = await client.audio.transcriptions.create({
      file: await fetch(`data:${mimeType};base64,${audioBase64}`).then(async (response) => {
        const blob = await response.blob();
        return new File([blob], "turn.webm", { type: mimeType });
      }),
      model: "gpt-4o-mini-transcribe",
    });

    return transcription.text;
  }
}

export class OpenAITextToSpeechAdapter implements TextToSpeechAdapter {
  async synthesize({ text, voice }: { text: string; voice: string }) {
    const client = getOpenAIClient();

    if (!client) {
      return null;
    }

    const audio = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await audio.arrayBuffer());

    return {
      audioBase64: buffer.toString("base64"),
      mimeType: "audio/mpeg",
    };
  }
}

export class ElevenLabsTextToSpeechAdapter implements TextToSpeechAdapter {
  async synthesize({ text, voice }: { text: string; voice: string }) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const resolvedVoiceId = voice || process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !resolvedVoiceId) {
      return null;
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: resolveElevenLabsModelId(),
        }),
      },
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${message}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      audioBase64: buffer.toString("base64"),
      mimeType: "audio/mpeg",
    };
  }
}

export function resolveTtsProvider(provider?: string): TtsProvider {
  const normalized = (provider ?? process.env.TTS_PROVIDER ?? "elevenlabs").toLowerCase();

  if (normalized === "elevenlabs" || normalized === "eleven") {
    return "elevenlabs";
  }

  return "openai";
}

export function createTextToSpeechAdapter(provider?: string): {
  provider: TtsProvider;
  adapter: TextToSpeechAdapter;
} {
  const resolved = resolveTtsProvider(provider);

  if (resolved === "elevenlabs") {
    return { provider: resolved, adapter: new ElevenLabsTextToSpeechAdapter() };
  }

  return { provider: resolved, adapter: new OpenAITextToSpeechAdapter() };
}
