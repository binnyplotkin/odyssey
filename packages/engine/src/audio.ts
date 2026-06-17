// Bare "module" (not "node:module"): the Next/webpack server build externalizes
// bare node builtins, but its loader rejects the "node:" URI scheme with
// UnhandledSchemeError, which 500s the whole admin dev build. Same builtin,
// no scheme — keeps createRequire's runtime require("ws") + the env-ordering
// on the lines below intact.
import { createRequire } from "module";
// Avoid a broken optional `bufferutil` native binding from taking down
// ElevenLabs streaming sends. `ws` falls back to its pure-JS masking path.
process.env.WS_NO_BUFFER_UTIL ??= "1";
process.env.WS_NO_UTF_8_VALIDATE ??= "1";
const require = createRequire(import.meta.url);
import { getOpenAIClient } from "./openai-client";
import {
  SpeechToTextAdapter,
  StreamingTextToSpeechAdapter,
  StreamingTtsChunk,
  TextToSpeechAdapter,
  VoiceContext,
} from "./interfaces";

export type SttProvider = "openai" | "kyutai";
export type TtsProvider = "openai" | "elevenlabs";

// Live-harness providers — adapters that can stream audio per-chunk for the
// /voice-stream route. Mirrors VoiceProvider in @odyssey/db (kept as a
// string-literal union here so this package stays db-independent).
export type StreamingTtsProvider =
  | "pocket_tts"
  | "elevenlabs"
  | "openai"
  | "cartesia";

export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_flash_v2_5";
export const POCKET_TTS_PUBLIC_BASE_URL = "https://audio-rt-production.up.railway.app";
export const POCKET_TTS_SAMPLE_RATE = 24000;
// Cartesia Sonic streaming. Version is the API contract date (override via
// CARTESIA_VERSION if the account is pinned to a newer one). Model defaults to
// sonic-2; CARTESIA_MODEL_ID or the voice row's providerConfig.modelId wins.
export const CARTESIA_DEFAULT_MODEL_ID = "sonic-2";
export const CARTESIA_DEFAULT_VERSION = "2024-11-13";
export const CARTESIA_SAMPLE_RATE = 24000;
const DEFAULT_TTS_FIRST_AUDIO_TIMEOUT_MS = 15_000;

type StreamReadResult<T> =
  | { done: false; value: T }
  | { done: true; value?: T };

type NodeWebSocket = {
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "error", listener: (err: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  once(event: "open", listener: () => void): void;
  once(event: "error", listener: (err: unknown) => void): void;
  once(event: "close", listener: (code: number, reason: Buffer) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string | Buffer): void;
};

type NodeWebSocketCtor = new (
  url: string,
  options?: { headers?: Record<string, string> },
) => NodeWebSocket;

const WebSocket = (require("ws") as { WebSocket: NodeWebSocketCtor }).WebSocket;

function getKyutaiSttBaseUrl(): string | null {
  const raw = (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return raw || null;
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

// ── Streaming TTS adapters (live harness) ─────────────────────────────
//
// `synthesize`-style adapters above return a single payload — fine for
// previews and /api/audio/speak. The live /voice-stream route needs
// per-frame streaming so audio starts playing before the LLM is done.
//
// All streaming adapters yield Float32 LE base64 PCM (the browser decoder
// has consumed this format since the original Moshi pipeline). Adapters
// that emit int16 (Pocket) or mp3 (ElevenLabs default) convert in-adapter
// so consumers don't have to know.

export function getPocketTtsBaseUrl(): string {
  return ((process.env.KYUTAI_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
    POCKET_TTS_PUBLIC_BASE_URL);
}

function getTtsFirstAudioTimeoutMs(): number {
  const raw = Number(process.env.TTS_FIRST_AUDIO_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_TTS_FIRST_AUDIO_TIMEOUT_MS;
}

function int16Base64ToFloat32Base64(input: string): {
  base64: string;
  samples: number;
} {
  const int16Bytes = Buffer.from(input, "base64");
  const samples = (int16Bytes.byteLength / 2) | 0;
  const float32 = new Float32Array(samples);
  const view = new DataView(
    int16Bytes.buffer,
    int16Bytes.byteOffset,
    int16Bytes.byteLength,
  );
  for (let i = 0; i < samples; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return {
    base64: Buffer.from(
      float32.buffer,
      float32.byteOffset,
      float32.byteLength,
    ).toString("base64"),
    samples,
  };
}

export class PocketTtsStreamingAdapter implements StreamingTextToSpeechAdapter {
  constructor(private readonly baseUrl: string = getPocketTtsBaseUrl()) {}

  async *stream({
    text,
    voice,
    signal,
  }: {
    text: string;
    voice: VoiceContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamingTtsChunk> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const abort = new AbortController();
    const onAbort = () => abort.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });

    const resp = await fetch(`${this.baseUrl}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmed,
        voice: voice.slug,
        voiceUrl: voice.embeddingUrl ?? null,
      }),
      signal: abort.signal,
    }).finally(() => {
      signal?.removeEventListener("abort", onAbort);
    });

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => "");
      yield {
        type: "error",
        message: `Pocket TTS ${resp.status}: ${detail.slice(0, 300) || "no body"}`,
      };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedAudio = false;
    const firstAudioTimeoutMs = getTtsFirstAudioTimeoutMs();

    while (true) {
      const next = receivedAudio
        ? reader.read()
        : readWithTimeout(reader, firstAudioTimeoutMs);
      const { done, value } = await next.catch(async (err) => {
        await reader.cancel().catch(() => undefined);
        throw err;
      });
      if (done) break;
      if (signal?.aborted) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        let eventName: string | null = null;
        let dataLine = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLine += line.slice(6);
        }
        if (!eventName || !dataLine) continue;

        if (eventName === "audio") {
          receivedAudio = true;
          const payload = JSON.parse(dataLine) as { chunk: string };
          const { base64, samples } = int16Base64ToFloat32Base64(payload.chunk);
          yield {
            type: "audio",
            pcmFloat32Base64: base64,
            samples,
            sampleRate: POCKET_TTS_SAMPLE_RATE,
          };
        } else if (eventName === "error") {
          const payload = JSON.parse(dataLine) as { message?: string };
          yield {
            type: "error",
            message: `Pocket TTS error: ${payload.message ?? "unknown"}`,
          };
          return;
        }
        // "meta" and "done" are absorbed: caller emits its own done frame
        // once all chunks have drained.
      }
    }
  }
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<StreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<StreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`TTS first audio timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// ── ElevenLabs streaming adapter ──────────────────────────────────────
//
// Uses ElevenLabs's `/v1/text-to-speech/{id}/stream-input` websocket
// (one socket per sentence chunk — matches our LLM-token-aware dispatch
// in voice-stream/route.ts). We request `output_format=pcm_24000` so we
// can reuse the same int16→Float32 conversion as Pocket and skip MP3
// decoding entirely. (PCM outputs are a paid-tier feature on
// ElevenLabs; free-tier accounts must use the batch /api/audio/speak
// path with the MP3 default.)
//
// Voice settings (stability, similarity_boost, style) come from the
// voices row's `providerConfig`. Adding the voice via the "+ new voice"
// flow (PR2) is where those values are captured.

export interface ElevenLabsVoiceProviderConfig {
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

/**
 * Resolves the effective ElevenLabs config by overlaying a per-binding
 * override (from `characters.voice_settings`) on top of the voice row's
 * `providerConfig`. The override is a sparse jsonb tagged with its
 * provider; we only apply it when the tag matches, so re-binding a
 * character to a different-provider voice silently ignores stale
 * overrides instead of mangling the synth call.
 *
 * `voiceId` is intentionally never overrideable — that's the voice's
 * identity, not a tuning knob.
 */
export function resolveElevenLabsConfig(
  base: Partial<ElevenLabsVoiceProviderConfig>,
  override: Record<string, unknown> | null | undefined,
): Partial<ElevenLabsVoiceProviderConfig> {
  if (!override || override.provider !== "elevenlabs") return base;
  const pickNum = (k: string): number | undefined => {
    const v = override[k];
    return typeof v === "number" ? v : undefined;
  };
  const pickStr = (k: string): string | undefined => {
    const v = override[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  return {
    voiceId: base.voiceId,
    modelId: pickStr("modelId") ?? base.modelId,
    stability: pickNum("stability") ?? base.stability,
    similarityBoost: pickNum("similarityBoost") ?? base.similarityBoost,
    style: pickNum("style") ?? base.style,
  };
}

export class ElevenLabsStreamingAdapter
  implements StreamingTextToSpeechAdapter
{
  async *stream({
    text,
    voice,
    signal,
  }: {
    text: string;
    voice: VoiceContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamingTtsChunk> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      yield {
        type: "error",
        message: "ELEVENLABS_API_KEY is not configured.",
      };
      return;
    }

    const baseConfig = (voice.providerConfig ?? {}) as Partial<ElevenLabsVoiceProviderConfig>;
    const config = resolveElevenLabsConfig(baseConfig, voice.voiceSettings);
    if (!config.voiceId) {
      yield {
        type: "error",
        message: `ElevenLabs voice "${voice.slug}" is missing providerConfig.voiceId.`,
      };
      return;
    }

    // Reuse the existing pricing guard. modelId override on the voice
    // row wins over the env default; both pass through the same check.
    let modelId: string;
    try {
      modelId = config.modelId ?? resolveElevenLabsModelId();
      if (config.modelId) {
        // Re-validate the per-voice override against the pricing guard.
        const guard = getElevenLabsPricingGuardInfo();
        if (guard.enforceNormalPricing &&
            !guard.allowedModelIds.includes(config.modelId)) {
          yield {
            type: "error",
            message: `Model ${config.modelId} is blocked by ELEVENLABS_ENFORCE_NORMAL_PRICING.`,
          };
          return;
        }
      }
    } catch (guardErr) {
      yield {
        type: "error",
        message: guardErr instanceof Error ? guardErr.message : String(guardErr),
      };
      return;
    }

    const url =
      `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream-input` +
      `?model_id=${encodeURIComponent(modelId)}` +
      `&output_format=pcm_24000`;

    // ws supports custom headers; ElevenLabs accepts xi-api-key as a
    // header (cleaner than the query-param alternative since the key
    // won't leak into proxy logs).
    const ws = new WebSocket(url, { headers: { "xi-api-key": apiKey } });

    // Bridge ws events into an async generator. Three sources push
    // chunks into `pending`; the consumer loop drains it. `streamEnded`
    // becomes true on close, error, abort, or isFinal — once it's true
    // and `pending` is empty we return.
    const pending: StreamingTtsChunk[] = [];
    let pendingResolve: (() => void) | null = null;
    let streamEnded = false;

    const wake = () => {
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r();
      }
    };
    const push = (chunk: StreamingTtsChunk) => {
      pending.push(chunk);
      wake();
    };
    const end = () => {
      streamEnded = true;
      wake();
    };

    ws.on("message", (data: unknown) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
        const payload = JSON.parse(raw) as {
          audio?: string;
          isFinal?: boolean;
          error?: string;
          message?: string;
        };
        if (payload.error) {
          push({
            type: "error",
            message: `ElevenLabs: ${payload.error}${payload.message ? ` — ${payload.message}` : ""}`,
          });
          end();
          return;
        }
        if (payload.audio) {
          const { base64, samples } = int16Base64ToFloat32Base64(payload.audio);
          push({
            type: "audio",
            pcmFloat32Base64: base64,
            samples,
            sampleRate: 24000,
          });
        }
        if (payload.isFinal) end();
      } catch (parseErr) {
        push({
          type: "error",
          message: `ElevenLabs WS parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        });
        end();
      }
    });

    ws.on("error", (err: unknown) => {
      push({
        type: "error",
        message: `ElevenLabs WebSocket error: ${err instanceof Error ? err.message : String(err)}`,
      });
      end();
    });

    ws.on("close", () => end());

    const onAbort = () => {
      try {
        ws.close(1000, "client aborted");
      } catch {
        /* socket may already be closing */
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // Wait for the socket to open (or reject on early error/close).
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", (err: unknown) =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
        // If the server closes before "open" (e.g. 401) we'd never resolve.
        ws.once("close", (code: number, reason: Buffer) => {
          reject(
            new Error(
              `ElevenLabs WS closed before open: ${code}${reason?.length ? ` ${reason.toString("utf-8")}` : ""}`,
            ),
          );
        });
      });
    } catch (openErr) {
      signal?.removeEventListener("abort", onAbort);
      yield {
        type: "error",
        message:
          openErr instanceof Error ? openErr.message : String(openErr),
      };
      return;
    }

    // Three-frame send protocol:
    //   1. initial config: opening whitespace + voice_settings
    //   2. the actual text with try_trigger_generation so synthesis
    //      starts immediately instead of waiting for the EOS
    //   3. empty text = EOS marker so the server flushes and closes
    try {
      ws.send(
        JSON.stringify({
          text: " ",
          voice_settings: {
            stability: config.stability ?? 0.5,
            similarity_boost: config.similarityBoost ?? 0.75,
            style: config.style ?? 0,
          },
        }),
      );
      ws.send(
        JSON.stringify({
          text: trimmed,
          try_trigger_generation: true,
        }),
      );
      ws.send(JSON.stringify({ text: "" }));
    } catch (sendErr) {
      signal?.removeEventListener("abort", onAbort);
      yield {
        type: "error",
        message: `ElevenLabs WS send failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
      };
      try {
        ws.close();
      } catch {
        /* noop */
      }
      return;
    }

    // Drain: yield queued chunks, sleep when empty until the next
    // message event wakes us, exit once the stream has ended AND
    // the queue is drained.
    try {
      while (true) {
        while (pending.length > 0) {
          const chunk = pending.shift()!;
          yield chunk;
          if (chunk.type === "error") return;
        }
        if (streamEnded) return;
        await new Promise<void>((resolve) => {
          pendingResolve = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }
}

// ── Cartesia (Sonic) streaming adapter ────────────────────────────────
//
// Uses Cartesia's `/tts/websocket` streaming endpoint. We request
// `output_format.encoding=pcm_f32le`, so the wire bytes are already
// Float32 LE PCM — the base64 chunk passes straight through to the
// consumer with no int16→float conversion (unlike Pocket/ElevenLabs).
//
// Auth + API version go in the query string (Cartesia's documented WS
// auth). Voice + model come from the voices row's providerConfig
// ({ voiceId, modelId? }); CARTESIA_VERSION / CARTESIA_MODEL_ID env vars
// override the version and the default model.

export interface CartesiaVoiceProviderConfig {
  voiceId: string;
  modelId?: string;
}

export class CartesiaStreamingAdapter
  implements StreamingTextToSpeechAdapter
{
  async *stream({
    text,
    voice,
    signal,
  }: {
    text: string;
    voice: VoiceContext;
    signal?: AbortSignal;
  }): AsyncIterable<StreamingTtsChunk> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) {
      yield { type: "error", message: "CARTESIA_API_KEY is not configured." };
      return;
    }

    const config = (voice.providerConfig ?? {}) as Partial<CartesiaVoiceProviderConfig>;
    if (!config.voiceId) {
      yield {
        type: "error",
        message: `Cartesia voice "${voice.slug}" is missing providerConfig.voiceId.`,
      };
      return;
    }
    const modelId =
      config.modelId ?? (process.env.CARTESIA_MODEL_ID?.trim() || CARTESIA_DEFAULT_MODEL_ID);
    const version = process.env.CARTESIA_VERSION?.trim() || CARTESIA_DEFAULT_VERSION;

    // Auth in the query string is Cartesia's documented WS handshake. We
    // never echo the URL in error messages so the key can't leak into logs.
    const url =
      `wss://api.cartesia.ai/tts/websocket` +
      `?api_key=${encodeURIComponent(apiKey)}` +
      `&cartesia_version=${encodeURIComponent(version)}`;

    const ws = new WebSocket(url);

    // Same ws→async-generator bridge as ElevenLabs: message/error/close
    // push into `pending`; the drain loop yields it; `streamEnded` flips on
    // done/error/close/abort and, once `pending` is empty, the loop returns.
    const pending: StreamingTtsChunk[] = [];
    let pendingResolve: (() => void) | null = null;
    let streamEnded = false;

    const wake = () => {
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r();
      }
    };
    const push = (chunk: StreamingTtsChunk) => {
      pending.push(chunk);
      wake();
    };
    const end = () => {
      streamEnded = true;
      wake();
    };

    ws.on("message", (data: unknown) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : String(data);
        const payload = JSON.parse(raw) as {
          type?: string;
          data?: string;
          error?: string;
        };
        if (payload.type === "error") {
          push({ type: "error", message: `Cartesia: ${payload.error ?? "unknown error"}` });
          end();
          return;
        }
        if (payload.type === "chunk" && payload.data) {
          // data is base64 of raw pcm_f32le bytes = our wire format already.
          const byteLength = Buffer.from(payload.data, "base64").byteLength;
          push({
            type: "audio",
            pcmFloat32Base64: payload.data,
            samples: (byteLength / 4) | 0,
            sampleRate: CARTESIA_SAMPLE_RATE,
          });
          return;
        }
        if (payload.type === "done") end();
        // Any other type (e.g. timestamps) is absorbed; we don't request them.
      } catch (parseErr) {
        push({
          type: "error",
          message: `Cartesia WS parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        });
        end();
      }
    });

    ws.on("error", (err: unknown) => {
      push({
        type: "error",
        message: `Cartesia WebSocket error: ${err instanceof Error ? err.message : String(err)}`,
      });
      end();
    });

    ws.on("close", () => end());

    const onAbort = () => {
      try {
        ws.close(1000, "client aborted");
      } catch {
        /* socket may already be closing */
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    // Wait for open (or reject on early error/close so a 401/403 surfaces).
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", (err: unknown) =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
        ws.once("close", (code: number, reason: Buffer) => {
          reject(
            new Error(
              `Cartesia WS closed before open: ${code}${reason?.length ? ` ${reason.toString("utf-8")}` : ""}`,
            ),
          );
        });
      });
    } catch (openErr) {
      signal?.removeEventListener("abort", onAbort);
      yield {
        type: "error",
        message: openErr instanceof Error ? openErr.message : String(openErr),
      };
      return;
    }

    // One-shot generation: a single request, terminated by `continue:false`.
    // The server streams `chunk` messages, then a `done`.
    try {
      ws.send(
        JSON.stringify({
          context_id: crypto.randomUUID(),
          model_id: modelId,
          transcript: trimmed,
          voice: { mode: "id", id: config.voiceId },
          output_format: {
            container: "raw",
            encoding: "pcm_f32le",
            sample_rate: CARTESIA_SAMPLE_RATE,
          },
          language: "en",
          continue: false,
        }),
      );
    } catch (sendErr) {
      signal?.removeEventListener("abort", onAbort);
      yield {
        type: "error",
        message: `Cartesia WS send failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
      };
      try {
        ws.close();
      } catch {
        /* noop */
      }
      return;
    }

    try {
      while (true) {
        while (pending.length > 0) {
          const chunk = pending.shift()!;
          yield chunk;
          if (chunk.type === "error") return;
        }
        if (streamEnded) return;
        await new Promise<void>((resolve) => {
          pendingResolve = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Voice-level descriptor sufficient to dispatch to the right streaming
 * adapter. Constructed by the route from a `voices` row (+ a signed URL
 * for Pocket).
 */
export interface VoiceForRouting {
  provider: StreamingTtsProvider;
  slug: string;
  embeddingUrl?: string | null;
  providerConfig?: Record<string, unknown>;
  /** Per-binding tuning overlay; see VoiceContext.voiceSettings. */
  voiceSettings?: Record<string, unknown> | null;
}

/**
 * Returns `{ provider, adapter, voiceContext }` for a voice row. The
 * caller passes `voiceContext` straight into `adapter.stream()`. Throws
 * if the provider has no streaming adapter wired up yet.
 */
export function createStreamingTtsAdapterForVoice(voice: VoiceForRouting): {
  provider: StreamingTtsProvider;
  adapter: StreamingTextToSpeechAdapter;
  voiceContext: VoiceContext;
} {
  switch (voice.provider) {
    case "pocket_tts": {
      return {
        provider: "pocket_tts",
        adapter: new PocketTtsStreamingAdapter(),
        voiceContext: {
          slug: voice.slug,
          embeddingUrl: voice.embeddingUrl ?? null,
        },
      };
    }
    case "elevenlabs": {
      return {
        provider: "elevenlabs",
        adapter: new ElevenLabsStreamingAdapter(),
        voiceContext: {
          slug: voice.slug,
          providerConfig: voice.providerConfig,
          voiceSettings: voice.voiceSettings ?? null,
        },
      };
    }
    case "cartesia": {
      return {
        provider: "cartesia",
        adapter: new CartesiaStreamingAdapter(),
        voiceContext: {
          slug: voice.slug,
          providerConfig: voice.providerConfig,
          voiceSettings: voice.voiceSettings ?? null,
        },
      };
    }
    // Other hosted providers — adapters land here as they're built out.
    case "openai":
      throw new Error(
        `Streaming TTS adapter for "${voice.provider}" is not implemented yet.`,
      );
    default: {
      // Exhaustiveness check — if a new provider gets added to
      // StreamingTtsProvider without a case here, TS surfaces it.
      const _exhaustive: never = voice.provider;
      throw new Error(`Unknown voice provider: ${String(_exhaustive)}`);
    }
  }
}

export function getAudioRuntimeConfig(requestedProvider?: string) {
  const attemptOrder = resolveTtsAttemptOrder(requestedProvider);
  const elevenLabsModelConfig = getElevenLabsPricingGuardInfo();
  const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
  const hasElevenLabsKey = Boolean(process.env.ELEVENLABS_API_KEY);
  const hasElevenLabsVoice = Boolean(process.env.ELEVENLABS_VOICE_ID);
  const kyutaiSttBaseUrl = getKyutaiSttBaseUrl();
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
      },
    },
  };
}
