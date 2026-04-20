import { getOpenAIClient } from "./openai-client";
import { SpeechToTextAdapter, TextToSpeechAdapter } from "./interfaces";

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

    const cleanedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
    const extensionByMimeType: Record<string, string> = {
      "audio/webm": "webm",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "mp4",
      "audio/m4a": "m4a",
      "audio/aac": "aac",
      "audio/ogg": "ogg",
      "audio/flac": "flac",
    };
    const extension = extensionByMimeType[cleanedMimeType] ?? "webm";

    const transcription = await client.audio.transcriptions.create({
      file: await fetch(`data:${cleanedMimeType};base64,${audioBase64}`).then(async (response) => {
        const blob = await response.blob();
        return new File([blob], `turn.${extension}`, { type: cleanedMimeType });
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
  const normalized = (provider ?? process.env.TTS_PROVIDER ?? "openai").toLowerCase();

  if (normalized === "elevenlabs" || normalized === "eleven") {
    return "elevenlabs";
  }

  return "openai";
}

export function resolveTtsAttemptOrder(requestedProvider?: string): TtsProvider[] {
  const primary = resolveTtsProvider(requestedProvider);
  const fallbackEnabled = process.env.TTS_ENABLE_FALLBACK === "true";

  if (!fallbackEnabled) {
    return [primary];
  }

  const configuredFallback = (process.env.TTS_FALLBACK_PROVIDER || "").trim();
  const defaultFallback = primary === "openai" ? "elevenlabs" : "openai";
  const fallback = resolveTtsProvider(configuredFallback || defaultFallback);

  if (fallback === primary) {
    return [primary];
  }

  return [primary, fallback];
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

export function getAudioRuntimeConfig(requestedProvider?: string) {
  const attemptOrder = resolveTtsAttemptOrder(requestedProvider);
  const elevenLabsModelConfig = getElevenLabsPricingGuardInfo();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY);
  const hasElevenLabsVoice = Boolean(process.env.ELEVENLABS_VOICE_ID);

  return {
    stt: {
      provider: "openai" as const,
      configured: hasOpenAIKey,
    },
    tts: {
      primaryProvider: attemptOrder[0],
      attemptOrder,
      fallbackEnabled: attemptOrder.length > 1,
      fallbackProvider: attemptOrder[1] ?? null,
      providers: {
        openai: {
          configured: hasOpenAIKey,
        },
        elevenlabs: {
          configured: hasElevenLabsKey && hasElevenLabsVoice,
          hasApiKey: hasElevenLabsKey,
          hasVoiceId: hasElevenLabsVoice,
          model: elevenLabsModelConfig.effectiveModelId,
          pricingGuard: elevenLabsModelConfig,
        },
      },
    },
  };
}
