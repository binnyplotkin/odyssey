import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCharacterStore, getWikiStore, getWorldSessionStore } from "@odyssey/db";
import { embedText } from "@odyssey/engine";
import { curate } from "@odyssey/wiki-curator";
import { TraceEnvelope } from "@/lib/voice-trace";
import { buildVoiceSystemPrompt } from "@/lib/character-system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/voice-stream
 *
 * Pipes the LLM into Kyutai Pocket TTS (CPU, 100M, hosted on Railway) and
 * returns ONE merged SSE stream containing both:
 *   - LLM tokens for live transcript display ("token" events)
 *   - Base64-encoded Float32 PCM frames as TTS produces them ("audio" events)
 *
 * Wire format toward the browser is unchanged from the previous Moshi-WS
 * pipeline (Float32 PCM base64); this route translates int16 from the
 * Pocket TTS HTTP/SSE gateway into Float32 to preserve that contract.
 *
 * Pocket TTS does not accept streaming text input the way Moshi did, so we
 * wait for the full LLM reply before calling /speak. For the 1-2 sentence
 * voice agent shape this adds <300ms vs the old token-pipelined path.
 *
 * SSE events:
 *   event: "trace"        TraceEnvelope JSON
 *   event: "token"        { delta: string }
 *   event: "first-audio"  { latencyMs: number }
 *   event: "audio"        { pcm: base64<Float32>, samples: number, sampleRate: 24000 }
 *   event: "done"         { ... }
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
const TTS_DEFAULT_VOICE = "abraham";
const TTS_SAMPLE_RATE = 24000;
const TTS_PUBLIC_BASE_URL = "https://audio-rt-production.up.railway.app";

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = performance.now();
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

      // Abort the downstream TTS fetch if the client disconnects (barge-in).
      const ttsAbort = new AbortController();
      const onAbort = () => {
        ttsAbort.abort();
        closeStream();
      };
      req.signal.addEventListener("abort", onAbort);

      let firstAudioAt: number | null = null;
      let totalSamples = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let modelId = "";

      try {
        if (req.signal.aborted) return;

        // Per-turn semantic retrieval. Embed the user's transcript, vector-
        // search the character's wiki for the most similar pages, hand the
        // hits to the curator as semantic seeds. The graph traversal,
        // timeline filter, and budget logic in @odyssey/wiki-curator runs
        // unchanged on top of the enriched seeds. Failures are non-fatal —
        // we fall back to the cached baseline if either step throws.
        let augmentedChunk = "";
        let semanticHitCount = 0;
        try {
          if (process.env.VOICE_SEMANTIC_RETRIEVAL !== "0") {
            serverTrace.mark("server.retrieval.start");
            const queryEmbedding = await embedText(message);
            if (queryEmbedding) {
              const hits = await getWikiStore().searchPagesByEmbedding(
                character.id,
                queryEmbedding,
                { topK: 5, minSimilarity: 0.5 },
              );
              semanticHitCount = hits.length;
              if (hits.length > 0) {
                const augmented = await curate({
                  characterId: character.id,
                  query: message,
                  semanticSeeds: hits.map((h) => ({
                    pageId: h.pageId,
                    slug: h.slug,
                    similarity: h.similarity,
                  })),
                  tokenBudget: 1500,
                });
                augmentedChunk = augmented.promptChunk;
                serverTrace.mark("server.retrieval.done", {
                  hits: semanticHitCount,
                  selectedPages: augmented.pages.length,
                  tokensUsed: augmented.tokensUsed,
                  curatorMs: augmented.elapsedMs,
                });
              } else {
                serverTrace.mark("server.retrieval.done", { hits: 0 });
              }
            } else {
              serverTrace.mark("server.retrieval.skipped", { reason: "no-embedding" });
            }
          }
        } catch (retrievalErr) {
          serverTrace.mark("server.retrieval.error", {
            message: retrievalErr instanceof Error ? retrievalErr.message : String(retrievalErr),
          });
        }

        const composedPromptChunk = augmentedChunk
          ? `${promptChunk}\n\n## Relevant context for this turn\n${augmentedChunk}`
          : promptChunk;
        const systemPrompt = buildVoiceSystemPrompt(character.title, composedPromptChunk);
        serverTrace.mark("server.context.attached", {
          characterId: character.id,
          sessionId: body.sessionId ?? null,
          turnId: body.turnId ?? null,
          promptChunkChars: promptChunk.length,
          augmentedChunkChars: augmentedChunk.length,
          semanticHits: semanticHitCount,
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

        // Stream LLM tokens to the browser as they arrive AND accumulate the
        // full reply so we can hand it to TTS as a single text in one /speak
        // call once the LLM finishes.
        let replyText = "";
        let emittedAnyToken = false;
        const onToken = (delta: string) => {
          if (req.signal.aborted) return;
          if (!delta) return;
          if (!emittedAnyToken) {
            serverTrace.mark("server.llm.first-token");
            emittedAnyToken = true;
          }
          replyText += delta;
          sendEvent("token", { delta });
        };

        // Cerebras-only with retry-once on rate-limit / queue-exceeded.
        // No Anthropic fallback — voice latency budget makes Anthropic Haiku
        // (~600ms TTFT) slower than just surfacing a clean error to the UI.
        let chosenProvider: LlmProvider | null = null;
        if (provider === "cerebras" && !hasCerebras) {
          throw new Error("CEREBRAS_API_KEY is not configured.");
        }
        if (provider === "anthropic") {
          // Explicit override — keep Anthropic available when caller asks for it.
          modelId = body.model ?? ANTHROPIC_DEFAULT_MODEL;
          serverTrace.mark("server.llm.attempt", { provider: "anthropic" });
          ({ inputTokens, outputTokens } = await streamFromAnthropic({
            apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
            model: modelId,
            systemPrompt,
            history,
            message,
            maxTokens,
            onToken,
          }));
          chosenProvider = "anthropic";
          serverTrace.mark("server.llm.succeeded", { provider: "anthropic", model: modelId });
        } else {
          modelId = body.model ?? CEREBRAS_DEFAULT_MODEL;
          for (let attempt = 1; attempt <= 2; attempt += 1) {
            serverTrace.mark("server.llm.attempt", { provider: "cerebras", attempt });
            try {
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
              chosenProvider = "cerebras";
              serverTrace.mark("server.llm.succeeded", { provider: "cerebras", model: modelId, attempt });
              break;
            } catch (providerErr) {
              serverTrace.mark("server.llm.failed", {
                provider: "cerebras",
                attempt,
                message: providerErr instanceof Error ? providerErr.message : String(providerErr),
              });
              const text =
                providerErr instanceof Error ? providerErr.message.toLowerCase() : String(providerErr).toLowerCase();
              const rateLimited =
                text.includes("429") ||
                text.includes("queue_exceeded") ||
                text.includes("too_many_requests") ||
                text.includes("rate limit") ||
                text.includes("rate_limit");
              // Retry once on rate-limit-like errors, only if no tokens have
              // been emitted yet (otherwise the user already sees a partial
              // reply and a retry would duplicate it).
              if (rateLimited && attempt < 2 && !emittedAnyToken && !req.signal.aborted) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                continue;
              }
              throw providerErr;
            }
          }
        }

        if (!chosenProvider) {
          throw new Error("LLM call did not complete.");
        }

        serverTrace.mark("server.llm.done", {
          provider: chosenProvider,
          model: modelId,
          inputTokens,
          outputTokens,
        });

        if (req.signal.aborted) return;

        const finalText = replyText.trim();
        if (!finalText) {
          throw new Error("LLM returned an empty reply.");
        }

        // Hand the full reply to Pocket TTS. /speak streams int16 PCM frames
        // back as SSE; we convert each to Float32 and forward as base64 PCM
        // so the browser keeps its existing decoder.
        serverTrace.mark("server.tts.fetch.requested", { chars: finalText.length, voice });
        const ttsResp = await fetch(`${ttsBaseUrl}/speak`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: finalText, voice }),
          signal: ttsAbort.signal,
        });
        serverTrace.mark("server.tts.fetch.opened", { status: ttsResp.status });
        if (!ttsResp.ok || !ttsResp.body) {
          const detail = await ttsResp.text().catch(() => "");
          throw new Error(
            `Pocket TTS ${ttsResp.status}: ${detail.slice(0, 300) || "no body"}`,
          );
        }

        const reader = ttsResp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (req.signal.aborted) break;
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
              const payload = JSON.parse(dataLine) as { chunk: string };
              const float32B64 = int16Base64ToFloat32Base64(payload.chunk);
              const samples = (Buffer.from(float32B64, "base64").byteLength / 4) | 0;
              totalSamples += samples;
              if (firstAudioAt === null) {
                firstAudioAt = performance.now();
                serverTrace.mark("server.tts.first-audio", {
                  latencyMs: Math.round(firstAudioAt - startedAt),
                });
                sendEvent("first-audio", {
                  latencyMs: Math.round(firstAudioAt - startedAt),
                });
              }
              sendEvent("audio", {
                pcm: float32B64,
                samples,
                sampleRate: TTS_SAMPLE_RATE,
              });
            } else if (eventName === "error") {
              const payload = JSON.parse(dataLine) as { message?: string };
              throw new Error(`Pocket TTS error: ${payload.message ?? "unknown"}`);
            }
            // "meta" and "done" from /speak are absorbed; we emit our own
            // browser-facing "done" below with combined LLM+TTS metrics.
          }
        }

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

/* ── int16 → Float32 PCM conversion ─────────────────────────────── */

// Pocket TTS gateway sends int16 little-endian base64. The browser decoder
// expects Float32 little-endian base64 (legacy contract from the Moshi WS
// pipeline). Convert in one allocation per chunk.
function int16Base64ToFloat32Base64(input: string): string {
  const int16Bytes = Buffer.from(input, "base64");
  const sampleCount = int16Bytes.byteLength / 2;
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(int16Bytes.buffer, int16Bytes.byteOffset, int16Bytes.byteLength);
  for (let i = 0; i < sampleCount; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength).toString("base64");
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
