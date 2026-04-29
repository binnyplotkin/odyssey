import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import { WebSocket } from "ws";
import { getOpenAIClient } from "./openai-client";
import { SpeechToTextAdapter, TextToSpeechAdapter } from "./interfaces";

export type SttProvider = "openai" | "kyutai";
export type TtsProvider = "openai" | "elevenlabs" | "kyutai";
export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_flash_v2_5";

const KYUTAI_TTS_DEFAULT_VOICE = "expresso/ex03-ex01_happy_001_channel1_334s.wav";
const KYUTAI_TTS_TARGET_SAMPLE_RATE = 24000;

function getKyutaiSttBaseUrl(): string | null {
  const raw = (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return raw || null;
}

function getKyutaiTtsBaseUrl(): string | null {
  const raw = (process.env.KYUTAI_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return raw || null;
}

function getKyutaiApiKey(): string {
  const raw = (process.env.KYUTAI_API_KEY ?? "").trim();
  return raw || "public_token";
}
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

export class KyutaiSpeechToTextAdapter implements SpeechToTextAdapter {
  async transcribe({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) {
    const baseUrl = getKyutaiSttBaseUrl();
    if (!baseUrl) {
      throw new Error("KYUTAI_BASE_URL is required for Kyutai speech transcription.");
    }

    const response = await fetch(`${baseUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType }),
      signal: AbortSignal.timeout(120000),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      transcript?: string;
      error?: string;
      detail?: string;
    };

    if (!response.ok) {
      throw new Error(
        payload.error ?? payload.detail ?? `Kyutai STT failed: HTTP ${response.status}`,
      );
    }

    return payload.transcript ?? "";
  }
}

/** Encode mono Float32 PCM as a 16-bit PCM WAV file. */
function encodeFloat32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const pcmLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + pcmLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmLength, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    buffer.writeInt16LE(int16, offset);
    offset += 2;
  }

  return buffer;
}

export class KyutaiTextToSpeechAdapter implements TextToSpeechAdapter {
  async synthesize({ text, voice }: { text: string; voice: string }) {
    const baseUrl = getKyutaiTtsBaseUrl();
    if (!baseUrl) {
      return null;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const wsUrl = baseUrl.replace(/^https?:/, "wss:") + "/api/tts_streaming";
    const params = new URLSearchParams({
      voice: voice || KYUTAI_TTS_DEFAULT_VOICE,
      format: "PcmMessagePack",
      auth_id: getKyutaiApiKey(),
    });

    return await new Promise<{ audioBase64: string; mimeType: string } | null>(
      (resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?${params.toString()}`);
        let resolved = false;
        const chunks: Float32Array[] = [];
        let totalSamples = 0;

        const finish = (
          result: { audioBase64: string; mimeType: string } | null,
          error: Error | null,
        ) => {
          if (resolved) return;
          resolved = true;
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (error) reject(error);
          else resolve(result);
        };

        const timeout = setTimeout(() => {
          finish(null, new Error("Kyutai TTS WS timed out after 120s"));
        }, 120000);

        ws.on("open", () => {
          const words = trimmed.split(/\s+/).filter(Boolean);
          for (const word of words) {
            ws.send(msgpackEncode({ type: "Text", text: word }));
          }
          ws.send(msgpackEncode({ type: "Eos" }));
        });

        ws.on("message", (raw: Buffer) => {
          try {
            const data = msgpackDecode(new Uint8Array(raw)) as
              | { type: "Audio"; pcm: number[] }
              | { type: "Text"; text: string }
              | { type: "Ready" }
              | { type: "Error"; message?: string };

            if (data.type === "Audio") {
              const samples = new Float32Array(data.pcm);
              chunks.push(samples);
              totalSamples += samples.length;
            } else if (data.type === "Error") {
              clearTimeout(timeout);
              finish(null, new Error(data.message ?? "Kyutai TTS reported error"));
            }
          } catch (decodeError) {
            // Don't fail the whole synth on a single malformed frame.
            console.error("KyutaiTextToSpeechAdapter: decode error", decodeError);
          }
        });

        ws.on("error", (err: Error) => {
          clearTimeout(timeout);
          finish(null, new Error(`Kyutai TTS WebSocket error: ${err.message}`));
        });

        ws.on("close", () => {
          clearTimeout(timeout);
          if (resolved) return;
          if (totalSamples === 0) {
            finish(null, new Error("Kyutai TTS WS closed before any audio"));
            return;
          }
          const merged = new Float32Array(totalSamples);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          const wav = encodeFloat32ToWav(merged, KYUTAI_TTS_TARGET_SAMPLE_RATE);
          finish(
            {
              audioBase64: wav.toString("base64"),
              mimeType: "audio/wav",
            },
            null,
          );
        });
      },
    );
  }
}

export function resolveSttProvider(provider?: string): SttProvider {
  const normalized = (provider ?? process.env.STT_PROVIDER ?? "openai").trim().toLowerCase();
  return normalized === "kyutai" ? "kyutai" : "openai";
}

export function createSpeechToTextAdapter(provider?: string): {
  provider: SttProvider;
  adapter: SpeechToTextAdapter;
} {
  const resolved = resolveSttProvider(provider);
  if (resolved === "kyutai") {
    return { provider: resolved, adapter: new KyutaiSpeechToTextAdapter() };
  }
  return { provider: resolved, adapter: new OpenAISpeechToTextAdapter() };
}

export function resolveTtsProvider(provider?: string): TtsProvider {
  const normalized = (provider ?? process.env.TTS_PROVIDER ?? "openai").toLowerCase();

  if (normalized === "elevenlabs" || normalized === "eleven") {
    return "elevenlabs";
  }
  if (normalized === "kyutai") {
    return "kyutai";
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
  if (resolved === "kyutai") {
    return { provider: resolved, adapter: new KyutaiTextToSpeechAdapter() };
  }

  return { provider: resolved, adapter: new OpenAITextToSpeechAdapter() };
}

export function getAudioRuntimeConfig(requestedProvider?: string) {
  const attemptOrder = resolveTtsAttemptOrder(requestedProvider);
  const elevenLabsModelConfig = getElevenLabsPricingGuardInfo();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY);
  const hasElevenLabsVoice = Boolean(process.env.ELEVENLABS_VOICE_ID);
  const kyutaiSttBaseUrl = getKyutaiSttBaseUrl();
  const kyutaiTtsBaseUrl = getKyutaiTtsBaseUrl();
  const sttProvider = resolveSttProvider();

  return {
    stt: {
      provider: sttProvider,
      configured:
        sttProvider === "kyutai" ? Boolean(kyutaiSttBaseUrl) : hasOpenAIKey,
      providers: {
        openai: { configured: hasOpenAIKey },
        kyutai: {
          configured: Boolean(kyutaiSttBaseUrl),
          baseUrl: kyutaiSttBaseUrl,
        },
      },
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
        kyutai: {
          configured: Boolean(kyutaiTtsBaseUrl),
          baseUrl: kyutaiTtsBaseUrl,
        },
      },
    },
  };
}
