import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { WebSocket as NodeWebSocket } from "ws";
import { getCharacterStore, getWorldSessionStore } from "@odyssey/db";
import { TraceEnvelope } from "@/lib/voice-trace";
import { buildVoiceSystemPrompt } from "@/lib/character-system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/voice-stream
 *
 * Single endpoint that pipes the LLM directly into Kyutai TTS server-side
 * and returns ONE merged SSE stream containing both:
 *   - LLM tokens for live transcript display ("token" events)
 *   - Base64-encoded PCM audio frames as TTS produces them ("audio" events)
 *
 * This eliminates the browser's two-network-hop architecture (browser ↔
 * /voice-chat plus browser ↔ Modal TTS WS). The browser opens one HTTP
 * connection and receives a fused stream of tokens and audio. Saves
 * ~150–300ms vs the dual-fetch path.
 *
 * Body: {
 *   promptChunk?: string;
 *   message: string;
 *   history?: Array<{ role: "user" | "assistant"; content: string }>;
 *   provider?: "cerebras" | "anthropic";
 *   model?: string;
 *   maxTokens?: number;
 *   voice?: string;        // Kyutai TTS voice file path
 * }
 *
 * SSE events:
 *   event: "token"        { delta: string }
 *   event: "first-audio"  { latencyMs: number }
 *   event: "audio"        { pcm: base64, samples: number, sampleRate: 24000 }
 *   event: "done"         { llmTokens, audioSamples, durationMs, firstAudioMs, totalMs, provider, model }
 *   event: "error"        { message: string }
 */

type LlmProvider = "cerebras" | "anthropic";

type VoiceStreamBody = {
  sessionId?: string;
  turnId?: string;
  promptChunk?: string;
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  provider?: LlmProvider;
  model?: string;
  maxTokens?: number;
  voice?: string;
};

const CEREBRAS_DEFAULT_MODEL = "llama3.1-8b";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 200;
const TTS_DEFAULT_VOICE = "expresso/ex03-ex01_happy_001_channel1_334s.wav";
const TTS_SAMPLE_RATE = 24000;
const TTS_PUBLIC_BASE_URL = "https://binnyplotkin--audio-rt-moshi-tts-serve.modal.run";

function utf8Encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function utf8Decode(input: Uint8Array): string {
  return new TextDecoder().decode(input);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeNumber(value: number): Uint8Array {
  if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
    return Uint8Array.of(value);
  }
  if (Number.isInteger(value) && value >= -32 && value < 0) {
    return Uint8Array.of(0xe0 | (value + 32));
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xff) {
    return Uint8Array.of(0xcc, value);
  }
  if (Number.isInteger(value) && value >= -0x80 && value <= 0x7f) {
    return Uint8Array.of(0xd0, value & 0xff);
  }
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) {
    return Uint8Array.of(0xcd, (value >> 8) & 0xff, value & 0xff);
  }
  if (Number.isInteger(value) && value >= -0x8000 && value <= 0x7fff) {
    return Uint8Array.of(0xd1, (value >> 8) & 0xff, value & 0xff);
  }
  const buffer = new ArrayBuffer(9);
  const view = new DataView(buffer);
  view.setUint8(0, 0xcb);
  view.setFloat64(1, value, false);
  return new Uint8Array(buffer);
}

function encodeString(value: string): Uint8Array {
  const bytes = utf8Encode(value);
  const length = bytes.length;
  if (length <= 31) {
    return concatBytes([Uint8Array.of(0xa0 | length), bytes]);
  }
  if (length <= 0xff) {
    return concatBytes([Uint8Array.of(0xd9, length), bytes]);
  }
  if (length <= 0xffff) {
    return concatBytes([Uint8Array.of(0xda, (length >> 8) & 0xff, length & 0xff), bytes]);
  }
  return concatBytes([
    Uint8Array.of(0xdb, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff),
    bytes,
  ]);
}

function msgpackEncode(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return Uint8Array.of(0xc0);
  }
  if (typeof value === "boolean") {
    return Uint8Array.of(value ? 0xc3 : 0xc2);
  }
  if (typeof value === "number") {
    return encodeNumber(value);
  }
  if (typeof value === "string") {
    return encodeString(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((entry) => msgpackEncode(entry));
    const length = items.length;
    let header: Uint8Array;
    if (length <= 15) {
      header = Uint8Array.of(0x90 | length);
    } else if (length <= 0xffff) {
      header = Uint8Array.of(0xdc, (length >> 8) & 0xff, length & 0xff);
    } else {
      header = Uint8Array.of(
        0xdd,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    }
    return concatBytes([header, ...items]);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    const length = entries.length;
    let header: Uint8Array;
    if (length <= 15) {
      header = Uint8Array.of(0x80 | length);
    } else if (length <= 0xffff) {
      header = Uint8Array.of(0xde, (length >> 8) & 0xff, length & 0xff);
    } else {
      header = Uint8Array.of(
        0xdf,
        (length >>> 24) & 0xff,
        (length >>> 16) & 0xff,
        (length >>> 8) & 0xff,
        length & 0xff,
      );
    }
    const chunks: Uint8Array[] = [header];
    for (const [key, entryValue] of entries) {
      chunks.push(encodeString(key));
      chunks.push(msgpackEncode(entryValue));
    }
    return concatBytes(chunks);
  }
  throw new Error("Unsupported MessagePack value.");
}

function msgpackDecode(bytes: Uint8Array): unknown {
  let offset = 0;

  const read = (): unknown => {
    const prefix = bytes[offset++];
    if (prefix <= 0x7f) return prefix;
    if ((prefix & 0xe0) === 0xa0) {
      const length = prefix & 0x1f;
      const out = utf8Decode(bytes.subarray(offset, offset + length));
      offset += length;
      return out;
    }
    if ((prefix & 0xf0) === 0x90) {
      const length = prefix & 0x0f;
      const out: unknown[] = [];
      for (let i = 0; i < length; i += 1) out.push(read());
      return out;
    }
    if ((prefix & 0xf0) === 0x80) {
      const length = prefix & 0x0f;
      const out: Record<string, unknown> = {};
      for (let i = 0; i < length; i += 1) {
        const key = read();
        out[String(key)] = read();
      }
      return out;
    }
    if (prefix >= 0xe0) return prefix - 0x100;
    switch (prefix) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xcc: {
        return bytes[offset++];
      }
      case 0xcd: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return value;
      }
      case 0xd0: {
        const value = (bytes[offset] << 24) >> 24;
        offset += 1;
        return value;
      }
      case 0xd1: {
        const value = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        return (value << 16) >> 16;
      }
      case 0xd9: {
        const length = bytes[offset++];
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xda: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdb: {
        const length =
          (bytes[offset] << 24) |
          (bytes[offset + 1] << 16) |
          (bytes[offset + 2] << 8) |
          bytes[offset + 3];
        offset += 4;
        const out = utf8Decode(bytes.subarray(offset, offset + length));
        offset += length;
        return out;
      }
      case 0xdc: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: unknown[] = [];
        for (let i = 0; i < length; i += 1) out.push(read());
        return out;
      }
      case 0xde: {
        const length = (bytes[offset] << 8) | bytes[offset + 1];
        offset += 2;
        const out: Record<string, unknown> = {};
        for (let i = 0; i < length; i += 1) {
          const key = read();
          out[String(key)] = read();
        }
        return out;
      }
      case 0xca: {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
        const value = view.getFloat32(0, false);
        offset += 4;
        return value;
      }
      case 0xcb: {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
        const value = view.getFloat64(0, false);
        offset += 8;
        return value;
      }
      default:
        throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
    }
  };

  const value = read();
  if (offset !== bytes.length) {
    throw new Error("Unexpected trailing MessagePack bytes.");
  }
  return value;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: VoiceStreamBody;
  try {
    body = (await req.json()) as VoiceStreamBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const message = body.message?.trim();
  if (!message) return jsonError(400, "message is required");

  const promptChunk = body.promptChunk ?? "";

  const fallbackCharacter =
    id === "abraham-fallback" ? { id, slug: "abraham", title: "Abraham" } : null;
  const character = fallbackCharacter ?? (await getCharacterStore().getById(id));
  if (!character) return jsonError(404, "character not found");

  const requestedProvider: LlmProvider = body.provider ?? "cerebras";
  const hasCerebras = Boolean(process.env.CEREBRAS_API_KEY?.trim());
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const provider: LlmProvider =
    requestedProvider === "cerebras"
      ? hasCerebras
        ? "cerebras"
        : hasAnthropic
          ? "anthropic"
          : "cerebras"
      : hasAnthropic
        ? "anthropic"
        : hasCerebras
          ? "cerebras"
          : "anthropic";
  const maxTokens = Math.max(64, Math.min(1024, body.maxTokens ?? DEFAULT_MAX_TOKENS));
  const voice = body.voice ?? TTS_DEFAULT_VOICE;

  if (!hasCerebras && !hasAnthropic) {
    return jsonError(
      500,
      "No LLM provider key configured. Set CEREBRAS_API_KEY or ANTHROPIC_API_KEY.",
    );
  }

  const ttsBaseUrl = ((process.env.KYUTAI_TTS_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
    TTS_PUBLIC_BASE_URL);
  const ttsApiKey = (process.env.KYUTAI_API_KEY ?? "public_token").trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = performance.now();
      // Per-turn server-side telemetry. The browser rebases these events onto
      // its `voice-stream.posted` mark when it merges the final trace shipped
      // in the `done` event. Keep this milestone-only; audio frames stay hot.
      const serverTrace = new TraceEnvelope();
      serverTrace.mark("server.request.received", {
        requestedProvider,
        chosenProvider: provider,
        model: body.model ?? null,
      });
      let closed = false;

      const sendEvent = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller may already be closed (client aborted) — swallow.
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      let firstAudioAt: number | null = null;
      let totalSamples = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let modelId = "";

      // Open the TTS WebSocket up front so its handshake races with the
      // LLM call below. Words flush into it as they arrive from the LLM,
      // and frames flow back here to be re-emitted as SSE audio events.
      const ttsUrl = new URL(`${ttsBaseUrl}/api/tts_streaming`);
      ttsUrl.searchParams.set("voice", voice);
      ttsUrl.searchParams.set("format", "PcmMessagePack");
      ttsUrl.searchParams.set("auth_id", ttsApiKey);
      const wsUrl = ttsUrl.toString().replace(/^https?:/, "wss:");

      const ttsWs = new NodeWebSocket(wsUrl);

      let ttsClosedResolve: () => void = () => {};
      const ttsClosedPromise = new Promise<void>((resolve) => {
        ttsClosedResolve = resolve;
      });

      ttsWs.on("message", (raw: Buffer) => {
        try {
          const data = msgpackDecode(new Uint8Array(raw)) as
            | { type: "Audio"; pcm: number[] }
            | { type: "Text"; text: string }
            | { type: "Ready" }
            | { type: "Error"; message?: string };

          if (data.type === "Audio") {
            if (firstAudioAt === null) {
              firstAudioAt = performance.now();
              serverTrace.mark("server.tts.first-audio", {
                latencyMs: Math.round(firstAudioAt - startedAt),
              });
              sendEvent("first-audio", {
                latencyMs: Math.round(firstAudioAt - startedAt),
              });
            }
            // Float32 → little-endian bytes → base64. The browser decodes back
            // to Float32 and schedules buffers via Web Audio.
            const samples = new Float32Array(data.pcm);
            totalSamples += samples.length;
            const bytes = new Uint8Array(samples.buffer.slice(0));
            const pcmBase64 = Buffer.from(bytes).toString("base64");
            sendEvent("audio", {
              pcm: pcmBase64,
              samples: samples.length,
              sampleRate: TTS_SAMPLE_RATE,
            });
          } else if (data.type === "Error") {
            sendEvent("error", {
              message: `Kyutai TTS error: ${data.message ?? "unknown"}`,
            });
          }
        } catch (decodeErr) {
          console.error("[voice-stream] tts msgpack decode failed", decodeErr);
        }
      });

      ttsWs.on("error", (err: Error) => {
        serverTrace.mark("server.tts.error", { message: err.message });
        sendEvent("error", { message: `Kyutai TTS WebSocket error: ${err.message}` });
        ttsClosedResolve();
      });

      ttsWs.on("close", () => {
        serverTrace.mark("server.tts.ws.close");
        ttsClosedResolve();
      });

      // Forward client aborts (e.g. barge-in) → close TTS WS so we stop
      // generating audio for a turn the user has already cancelled.
      const onAbort = () => {
        try {
          if (ttsWs.readyState === NodeWebSocket.OPEN || ttsWs.readyState === NodeWebSocket.CONNECTING) {
            ttsWs.close();
          }
        } catch {
          /* ignore */
        }
        ttsClosedResolve();
        closeStream();
      };
      req.signal.addEventListener("abort", onAbort);

      // Race the TTS WS handshake with the LLM call (instead of awaiting
      // the handshake first). Tokens that arrive before the WS opens get
      // buffered; the moment the WS is ready, they all flush at once.
      // This typically saves the full WS handshake cost (~250-400ms) off
      // the perceived first-audio latency.
      let ttsReady = ttsWs.readyState === NodeWebSocket.OPEN;
      const pendingWords: string[] = [];
      // Tracks whether we've sent any Text frame yet. Hoisted so both the
      // WS-open drain path and the LLM streaming path can mark
      // `tts.first-text` in whichever branch sends the first word.
      let firstTextSent = false;
      const ttsReadyPromise = new Promise<void>((resolve, reject) => {
        if (ttsReady) {
          resolve();
          return;
        }
        ttsWs.once("open", () => {
          serverTrace.mark("server.tts.ws.open");
          ttsReady = true;
          // Drain anything queued during the handshake.
          if (ttsWs.readyState === NodeWebSocket.OPEN && pendingWords.length > 0) {
            if (!firstTextSent) {
              firstTextSent = true;
              serverTrace.mark("server.tts.first-text");
            }
            for (const word of pendingWords) {
              ttsWs.send(msgpackEncode({ type: "Text", text: word }));
            }
            pendingWords.length = 0;
          }
          resolve();
        });
        ttsWs.once("error", (err: unknown) => reject(err));
      });

      try {
        if (req.signal.aborted) return;

        const systemPrompt = buildVoiceSystemPrompt(character.title, promptChunk);
        serverTrace.mark("server.context.attached", {
          characterId: character.id,
          sessionId: body.sessionId ?? null,
          turnId: body.turnId ?? null,
          promptChunkChars: promptChunk.length,
          systemPromptChars: systemPrompt.length,
          historyTurns: body.history?.length ?? 0,
          messageChars: message.length,
        });
        sendEvent("trace", serverTrace.toJSON());
        const history: Array<{ role: "user" | "assistant"; content: string }> =
          (body.history ?? []).filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          );

        // Buffer of LLM text awaiting a whitespace boundary. Once we see
        // whitespace we either send the words to the open TTS WS or queue
        // them for delivery the moment the handshake completes.
        const tokenBuffer = { value: "" };
        const flushWords = (text: string) => {
          if (req.signal.aborted) return;
          for (const word of text.split(/\s+/).filter(Boolean)) {
            if (ttsReady && ttsWs.readyState === NodeWebSocket.OPEN) {
              if (!firstTextSent) {
                firstTextSent = true;
                serverTrace.mark("server.tts.first-text");
              }
              ttsWs.send(msgpackEncode({ type: "Text", text: word }));
            } else {
              pendingWords.push(word);
            }
          }
        };

        let emittedAnyToken = false;
        const onToken = (delta: string) => {
          if (req.signal.aborted) return;
          if (!delta) return;
          if (!emittedAnyToken) {
            serverTrace.mark("server.llm.first-token");
          }
          emittedAnyToken = true;
          sendEvent("token", { delta });
          tokenBuffer.value += delta;
          const match = tokenBuffer.value.match(/^([\s\S]*\s)(\S*)$/);
          if (match) {
            flushWords(match[1]);
            tokenBuffer.value = match[2];
          }
        };

        const providerOrder: LlmProvider[] =
          provider === "cerebras" ? ["cerebras", "anthropic"] : ["anthropic", "cerebras"];
        const canUse = (p: LlmProvider) => (p === "cerebras" ? hasCerebras : hasAnthropic);
        let chosenProvider: LlmProvider | null = null;
        let lastProviderError: unknown = null;

        for (const attemptProvider of providerOrder) {
          if (!canUse(attemptProvider)) continue;
          try {
            serverTrace.mark("server.llm.attempt", { provider: attemptProvider });
            if (attemptProvider === "cerebras") {
              modelId = body.model ?? CEREBRAS_DEFAULT_MODEL;
              ({ inputTokens, outputTokens } = await streamFromCerebras({
                apiKey: process.env.CEREBRAS_API_KEY!.trim(),
                model: modelId,
                systemPrompt,
                history,
                message,
                maxTokens,
                onToken,
                abortSignal: req.signal,
              }));
            } else {
              modelId = body.model ?? ANTHROPIC_DEFAULT_MODEL;
              ({ inputTokens, outputTokens } = await streamFromAnthropic({
                apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
                model: modelId,
                systemPrompt,
                history,
                message,
                maxTokens,
                onToken,
              }));
            }
            chosenProvider = attemptProvider;
            serverTrace.mark("server.llm.succeeded", {
              provider: attemptProvider,
              model: modelId,
            });
            break;
          } catch (providerErr) {
            lastProviderError = providerErr;
            serverTrace.mark("server.llm.failed", {
              provider: attemptProvider,
              message: providerErr instanceof Error ? providerErr.message : String(providerErr),
            });
            const messageText =
              providerErr instanceof Error ? providerErr.message.toLowerCase() : String(providerErr).toLowerCase();
            const authLike =
              messageText.includes("401") ||
              messageText.includes("403") ||
              messageText.includes("unauthorized") ||
              messageText.includes("invalid api key") ||
              messageText.includes("authentication") ||
              messageText.includes("permission");
            if (emittedAnyToken || !authLike) {
              throw providerErr;
            }
          }
        }

        if (!chosenProvider) {
          throw (lastProviderError ?? new Error("No LLM provider attempt succeeded."));
        }

        serverTrace.mark("server.llm.done", {
          provider: chosenProvider,
          model: modelId,
          inputTokens,
          outputTokens,
        });

        if (req.signal.aborted) return;

        // Flush any partial tail token, then signal end-of-stream to TTS.
        const remaining = tokenBuffer.value.trim();
        if (remaining) {
          flushWords(remaining);
          tokenBuffer.value = "";
        }

        // Wait for the WS handshake to complete before sending Eos. If the
        // LLM was very fast (e.g. a one-word reply), we may have produced
        // all our tokens before the WS opened — they're queued in
        // pendingWords. Awaiting ttsReadyPromise guarantees the queued
        // words get flushed first; the open handler does that flush.
        await ttsReadyPromise;
        if (req.signal.aborted) return;
        if (ttsWs.readyState === NodeWebSocket.OPEN) {
          serverTrace.mark("server.tts.eos-sent");
          ttsWs.send(msgpackEncode({ type: "Eos" }));
        }

        // Wait until TTS server finishes draining audio and closes the WS.
        await ttsClosedPromise;

        serverTrace.mark("server.tts.done", { audioSamples: totalSamples });
        if (body.sessionId) {
          await getWorldSessionStore().appendEvent({
            sessionId: body.sessionId,
            turnId: body.turnId ?? null,
            type: "voice_stream.done",
            source: "system",
            payload: {
              provider: chosenProvider,
              model: modelId,
              inputTokens,
              outputTokens,
              audioSamples: totalSamples,
              firstAudioMs:
                firstAudioAt !== null
                  ? Math.round(firstAudioAt - startedAt)
                  : -1,
              totalMs: Math.round(performance.now() - startedAt),
              serverTrace: serverTrace.toJSON(),
            },
          });
        }

        sendEvent("done", {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          audioSamples: totalSamples,
          durationMs: Math.round((totalSamples / TTS_SAMPLE_RATE) * 1000),
          firstAudioMs:
            firstAudioAt !== null
              ? Math.round(firstAudioAt - startedAt)
              : -1,
          totalMs: Math.round(performance.now() - startedAt),
          provider: chosenProvider,
          model: modelId,
          serverTrace: serverTrace.toJSON(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        serverTrace.mark("server.error", { message: msg });
        if (body.sessionId) {
          await getWorldSessionStore().appendEvent({
            sessionId: body.sessionId,
            turnId: body.turnId ?? null,
            type: "voice_stream.error",
            source: "system",
            payload: {
              message: msg,
              serverTrace: serverTrace.toJSON(),
            },
          });
        }
        sendEvent("error", { message: msg });
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        if (ttsWs.readyState === NodeWebSocket.OPEN || ttsWs.readyState === NodeWebSocket.CONNECTING) {
          try {
            ttsWs.close();
          } catch {
            /* ignore */
          }
        }
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ── LLM streaming helpers ──────────────────────────────────────── */

async function streamFromAnthropic(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  maxTokens: number;
  onToken: (delta: string) => void;
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const messages = [
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: opts.message },
  ];

  const resp = anthropic.messages.stream({
    model: opts.model,
    system: opts.systemPrompt,
    messages,
    max_tokens: opts.maxTokens,
  });

  let outputTokens = 0;
  let inputTokens = 0;
  for await (const ev of resp) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      opts.onToken(ev.delta.text);
    }
    if (ev.type === "message_start" && ev.message.usage) {
      inputTokens = ev.message.usage.input_tokens ?? 0;
    }
    if (ev.type === "message_delta" && ev.usage) {
      outputTokens = ev.usage.output_tokens ?? 0;
    }
  }
  return { inputTokens, outputTokens };
}

async function streamFromCerebras(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  maxTokens: number;
  onToken: (delta: string) => void;
  abortSignal: AbortSignal;
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const messages = [
    { role: "system", content: opts.systemPrompt },
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.message },
  ];

  const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: true,
      max_completion_tokens: opts.maxTokens,
    }),
    signal: opts.abortSignal,
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Cerebras ${resp.status}: ${text.slice(0, 300) || "no body"}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (opts.abortSignal.aborted) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd: number;
    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) opts.onToken(delta);
        if (event.usage) {
          inputTokens = event.usage.prompt_tokens ?? inputTokens;
          outputTokens = event.usage.completion_tokens ?? outputTokens;
        }
      } catch {
        /* skip malformed frames */
      }
    }
  }
  return { inputTokens, outputTokens };
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
