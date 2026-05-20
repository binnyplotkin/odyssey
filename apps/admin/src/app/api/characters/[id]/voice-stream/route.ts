import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  getCharacterStore,
  getVoiceStore,
  getWikiStore,
  getWikisStore,
  getWorldSessionStore,
} from "@odyssey/db";
import { embedText } from "@odyssey/engine";
import { curate } from "@odyssey/wiki-curator";
import { TraceEnvelope } from "@/lib/voice-trace";
import { buildVoiceSystemPrompt } from "@odyssey/engine";
import {
  shouldSkipRetrieval,
  getRecentTurnSummaries,
  formatRecentConversation,
  summarizeTurnInBackground,
} from "@/lib/voice-context-helpers";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";

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
 * Pocket TTS doesn't accept streaming text input the way Moshi did, but we
 * still want first-audio to land as soon as possible. Strategy: detect
 * sentence boundaries inside the LLM token stream and fire one /speak per
 * sentence the moment it completes. Fetches run in parallel; audio events
 * are forwarded to the browser in dispatch order via a serial drain chain
 * so chunks always play in sequence. For multi-sentence replies this drops
 * first-audio from "LLM total + TTS first chunk" to roughly "LLM first
 * sentence + TTS first chunk".
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

const CEREBRAS_DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 1024;
const TTS_DEFAULT_VOICE = "abraham";
const TTS_SAMPLE_RATE = 24000;
const TTS_PUBLIC_BASE_URL = "https://audio-rt-production.up.railway.app";
const TTS_MAX_CHUNK_CHARS = 220;

// Abbreviations where a "." doesn't terminate a sentence. Tiny allow-list —
// false negatives ("Dr. Smith" → split into two chunks) sound only slightly
// off; false positives (failing to split at "The U.S. is huge.") cost real
// latency by holding the whole reply in one chunk.
const TTS_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "jr", "sr",
  "vs", "etc", "eg", "ie", "prof", "rev", "hon",
  "no", "vol",
]);

function findTtsBoundary(text: string, fromIndex: number): number {
  // Returns the index *after* a sentence-terminating punctuation followed by
  // whitespace, or -1 if no boundary is visible in the buffer yet. Caller is
  // responsible for the final flush at end-of-stream.
  for (let i = fromIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\n") return i + 1;
    if (ch !== "." && ch !== "?" && ch !== "!") continue;
    // Need whitespace after the punctuation, else we're mid-token ("3.14",
    // "node.js"). At end-of-buffer, wait for more tokens.
    if (i + 1 >= text.length) return -1;
    if (!/\s/.test(text[i + 1])) continue;
    if (ch === ".") {
      let wordStart = i;
      while (wordStart > 0 && /[A-Za-z]/.test(text[wordStart - 1])) wordStart -= 1;
      const word = text.slice(wordStart, i).toLowerCase();
      if (word && TTS_ABBREVIATIONS.has(word)) continue;
    }
    return i + 1;
  }
  return -1;
}

function findForceFlushBoundary(text: string, fromIndex: number): number {
  // If the unsent tail exceeds TTS_MAX_CHUNK_CHARS with no sentence boundary
  // in sight, cut at the latest comma or whitespace within the window so the
  // chunk lands on a natural prosodic break. Returns -1 if we should wait.
  const tail = text.length - fromIndex;
  if (tail < TTS_MAX_CHUNK_CHARS) return -1;
  const slice = text.slice(fromIndex, fromIndex + TTS_MAX_CHUNK_CHARS);
  const lastComma = slice.lastIndexOf(",");
  if (lastComma >= 60) return fromIndex + lastComma + 1;
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= 60) return fromIndex + lastSpace + 1;
  return fromIndex + TTS_MAX_CHUNK_CHARS;
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
    id === "abraham-fallback"
      ? { id, slug: "abraham", title: "Abraham", brainModel: null }
      : null;
  // Accept either a UUID id or a slug. Slug-based lookup makes scene
  // definitions (which carry slugs, not generated ids) trivially compose
  // with this route — no resolution layer in the caller.
  const store = getCharacterStore();
  const character =
    fallbackCharacter ?? (await store.getById(id)) ?? (await store.getBySlug(id));
  if (!character) return jsonError(404, "character not found");

  // Resolve the voice-mode preference baked into the character's L04
  // Mind/Model config. `brainModel.voice` is the per-mode override block;
  // anything not set there falls back to the chat-mode top-level fields,
  // so a character that only specifies voice.model inherits temperature/
  // topP/maxTokens from chat. Request body still overrides everything —
  // the wavefield UI's live picker is the highest-priority signal so a
  // developer can swap models mid-session without re-saving L04.
  const voiceCfg = character.brainModel?.voice;
  const characterVoiceProvider: LlmProvider | undefined =
    voiceCfg?.provider === "anthropic" || voiceCfg?.provider === "cerebras"
      ? voiceCfg.provider
      : character.brainModel?.provider === "anthropic" || character.brainModel?.provider === "cerebras"
        ? (character.brainModel.provider as LlmProvider)
        : undefined;
  const characterVoiceModel: string | undefined = voiceCfg?.model ?? character.brainModel?.model;
  const characterVoiceMaxTokens: number | undefined =
    voiceCfg?.maxTokens ?? character.brainModel?.maxTokens;

  // Hardcoded fallback when neither body nor character specify a provider:
  // "cerebras" wins because voice latency budget favors it.
  const requestedProvider: LlmProvider = body.provider ?? characterVoiceProvider ?? "cerebras";
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
  const maxTokens = Math.max(
    64,
    Math.min(1024, body.maxTokens ?? characterVoiceMaxTokens ?? DEFAULT_MAX_TOKENS),
  );
  // Voice resolution priority:
  //   1. body.voice explicit override (caller knows the slug)
  //   2. character.voiceId binding → resolve to slug + signed embedding URL
  //   3. fallback default
  // The signed URL is passed alongside the slug so audio-rt can fetch
  // Supabase-managed voices that aren't baked into its Docker image.
  // URL is one-shot per request — 1h TTL is plenty for the longest voice
  // session.
  let voice: string;
  let voiceUrl: string | null = null;
  if (body.voice) {
    voice = body.voice;
  } else if (
    "voiceId" in character &&
    typeof character.voiceId === "string" &&
    character.voiceId
  ) {
    const bound = await getVoiceStore().getById(character.voiceId);
    if (bound?.status === "ready" && bound.embeddingPath) {
      voice = bound.slug;
      voiceUrl = await createEmbeddingSignedUrl(bound.embeddingPath).catch(
        () => null,
      );
    } else {
      voice = character.slug ?? TTS_DEFAULT_VOICE;
    }
  } else {
    voice = TTS_DEFAULT_VOICE;
  }

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

        // ── Context augmentation ────────────────────────────────────
        //
        // Three additive layers stacked on top of the cached baseline:
        //   1. Recent conversation summary — read in parallel, near-zero cost
        //   2. Adaptive retrieval gate — skip embedding+search on greetings /
        //      one-word fluff that would never benefit, saves ~500ms/turn
        //   3. Per-turn semantic retrieval — embed → pgvector → curator
        //
        // Failures in any of these are non-fatal: the cached baseline alone
        // is enough for a coherent reply, so we degrade gracefully instead
        // of breaking the user's turn.

        const skipDecision = shouldSkipRetrieval(message);
        let augmentedChunk = "";
        let semanticHitCount = 0;
        // Hoisted so we can persist these on the contextBuild record below
        // (the workbench's KnowledgeGraphPanel reads `selectedPages` to render
        // which wiki pages were pulled in for this turn).
        let curatorSelectedPages: unknown = null;
        let curatorTrace: unknown = null;
        let curatorTokensUsed: number | null = null;
        let curatorTokensBudget: number | null = null;

        // Run summary-fetch in parallel with retrieval — both read-only,
        // independent. Promise.all keeps the latency floor at max(both).
        const summariesPromise = getRecentTurnSummaries(body.sessionId, 3);

        if (skipDecision.skip) {
          serverTrace.mark("server.retrieval.skipped", { reason: skipDecision.reason });
        } else {
          try {
            if (process.env.VOICE_SEMANTIC_RETRIEVAL !== "0") {
              serverTrace.mark("server.retrieval.start");

              // Fold the most recent turn summary into the embedding query
              // so pronoun-y referential utterances ("tell me more about
              // that", "what about her?") still hit relevant pages instead
              // of embedding the bare 4-word fragment. The summary fetch
              // was already kicked off in parallel above; awaiting it here
              // is sub-50ms and adds nothing to the critical path beyond
              // what the embedding API call already takes.
              const summariesForQuery = await summariesPromise;
              const lastSummary = summariesForQuery[summariesForQuery.length - 1];
              const embedQuery = lastSummary
                ? `Previous turn: ${lastSummary}\nUser now asks: ${message}`
                : message;
              const queryEmbedding = await embedText(embedQuery);
              if (queryEmbedding) {
                const activeWikiIds = (await getWikisStore().listWikisForCharacter(character.id))
                  .filter((wiki) => wiki.binding.isActive)
                  .map((wiki) => wiki.id);
                const hits = await getWikiStore().searchPagesByEmbeddingForWikis(
                  activeWikiIds,
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
                  curatorSelectedPages = augmented.pages;
                  curatorTrace = augmented.trace;
                  curatorTokensUsed = augmented.tokensUsed;
                  curatorTokensBudget = augmented.tokensBudget ?? 1500;
                  serverTrace.mark("server.retrieval.done", {
                    hits: semanticHitCount,
                    selectedPages: augmented.pages.length,
                    tokensUsed: augmented.tokensUsed,
                    curatorMs: augmented.elapsedMs,
                    embedQueryAware: Boolean(lastSummary),
                  });
                } else {
                  serverTrace.mark("server.retrieval.done", {
                    hits: 0,
                    embedQueryAware: Boolean(lastSummary),
                  });
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
        }

        const recentSummaries = await summariesPromise;
        const recentSection = formatRecentConversation(recentSummaries);
        const augmentedSection = augmentedChunk
          ? `\n\n## Relevant context for this turn\n${augmentedChunk}`
          : "";
        const composedPromptChunk = `${promptChunk}${recentSection}${augmentedSection}`;
        const systemPrompt = buildVoiceSystemPrompt(character.title, composedPromptChunk);
        serverTrace.mark("server.context.attached", {
          characterId: character.id,
          sessionId: body.sessionId ?? null,
          turnId: body.turnId ?? null,
          promptChunkChars: promptChunk.length,
          augmentedChunkChars: augmentedChunk.length,
          semanticHits: semanticHitCount,
          retrievalSkipped: skipDecision.skip,
          retrievalSkipReason: skipDecision.skip ? skipDecision.reason : null,
          recentSummaries: recentSummaries.length,
          systemPromptChars: systemPrompt.length,
          historyTurns: body.history?.length ?? 0,
          messageChars: message.length,
        });
        sendEvent("trace", serverTrace.toJSON());

        // Persist the assembled context + turn-start record so the session
        // workbench can render exactly what the LLM saw on this turn. Both
        // calls are gated on sessionId + turnId — without them there's no
        // place to attach the records. Failures here are non-fatal: the
        // turn still proceeds, the workbench just won't have data for it.
        if (body.sessionId && body.turnId) {
          const sessionStore = getWorldSessionStore();
          try {
            await sessionStore.upsertTurn({
              id: body.turnId,
              sessionId: body.sessionId,
              inputMode: "voice",
              userText: message,
              status: "in_progress",
              startedAt: new Date(startedAt).toISOString(),
            });
          } catch (turnErr) {
            console.error("[voice-stream] upsertTurn (start) failed", turnErr);
          }
          try {
            await sessionStore.recordContextBuild({
              sessionId: body.sessionId,
              turnId: body.turnId,
              mode: "voice",
              promptKind: "voice",
              query: message,
              tokenBudget: curatorTokensBudget,
              tokensUsed: curatorTokensUsed,
              tokensBudget: curatorTokensBudget,
              selectedPages: curatorSelectedPages,
              curatorTrace,
              promptChunk: composedPromptChunk,
              systemPrompt,
              metadata: {
                semanticHits: semanticHitCount,
                retrievalSkipped: skipDecision.skip,
                retrievalSkipReason: skipDecision.skip ? skipDecision.reason : null,
                recentSummaries: recentSummaries.length,
                augmentedChunkChars: augmentedChunk.length,
              },
            });
          } catch (ctxErr) {
            console.error("[voice-stream] recordContextBuild failed", ctxErr);
          }
        }

        const history: Array<{ role: "user" | "assistant"; content: string }> =
          (body.history ?? []).filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          );

        // Stream LLM tokens to the browser AND fire Pocket TTS calls per
        // completed sentence so audio starts flowing while the LLM is still
        // generating. Each `/speak` is kicked off the instant a boundary is
        // detected; their audio events are forwarded to the client in
        // dispatch order via `drainChain` so chunks never play out of
        // sequence. The fetches themselves run in parallel, gated only by
        // Pocket TTS's own concurrency on the gateway side.
        let replyText = "";
        let emittedAnyToken = false;
        let ttsCursor = 0;
        let ttsChunkCount = 0;
        let drainChain: Promise<void> = Promise.resolve();

        const drainOneChunk = async (
          chunkIdx: number,
          fetchPromise: Promise<Response>,
        ): Promise<void> => {
          if (req.signal.aborted) return;
          const ttsResp = await fetchPromise;
          if (chunkIdx === 0) {
            serverTrace.mark("server.tts.fetch.opened", { status: ttsResp.status });
          }
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
                    chunkIdx,
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
          serverTrace.mark("server.tts.chunk.drained", { chunkIdx });
        };

        const dispatchTtsChunk = (text: string): void => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const chunkIdx = ttsChunkCount++;
          if (chunkIdx === 0) {
            serverTrace.mark("server.tts.fetch.requested", {
              voice,
              firstChunkChars: trimmed.length,
            });
          }
          serverTrace.mark("server.tts.chunk.dispatched", {
            chunkIdx,
            chars: trimmed.length,
          });
          const fetchPromise = fetch(`${ttsBaseUrl}/speak`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: trimmed, voice, voiceUrl }),
            signal: ttsAbort.signal,
          });
          // Attach a no-op rejection handler in case the drain chain rejects
          // upstream and this fetch's failure is never observed by an awaiter
          // — otherwise it surfaces as an unhandled promise rejection.
          fetchPromise.catch(() => null);
          drainChain = drainChain.then(() => drainOneChunk(chunkIdx, fetchPromise));
        };

        const onToken = (delta: string) => {
          if (req.signal.aborted) return;
          if (!delta) return;
          if (!emittedAnyToken) {
            serverTrace.mark("server.llm.first-token");
            emittedAnyToken = true;
          }
          replyText += delta;
          sendEvent("token", { delta });

          // Flush every sentence boundary visible in the new tail. One token
          // can include multiple boundaries (rare but possible — "Yes. Why?").
          while (true) {
            const boundary = findTtsBoundary(replyText, ttsCursor);
            if (boundary < 0) break;
            dispatchTtsChunk(replyText.slice(ttsCursor, boundary));
            ttsCursor = boundary;
          }
          // Runaway-sentence guard: force-flush if the unsent tail crosses
          // TTS_MAX_CHUNK_CHARS without a terminator.
          const forced = findForceFlushBoundary(replyText, ttsCursor);
          if (forced > 0) {
            dispatchTtsChunk(replyText.slice(ttsCursor, forced));
            ttsCursor = forced;
          }
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
          // Priority: body.model → character voice/chat model → hardcoded Anthropic default.
          // Only honor the character's model when it's actually an Anthropic-side model;
          // a character pinned to a Cerebras model shouldn't bleed into the Anthropic
          // fallback branch (which only fires when env steers us here anyway).
          const characterAnthropicModel =
            characterVoiceProvider === "anthropic" && characterVoiceModel
              ? characterVoiceModel
              : undefined;
          modelId = body.model ?? characterAnthropicModel ?? ANTHROPIC_DEFAULT_MODEL;
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
          // Same priority order as the Anthropic branch — body wins, then
          // character pref (when Cerebras-side), then hardcoded default.
          const characterCerebrasModel =
            characterVoiceProvider === "cerebras" && characterVoiceModel
              ? characterVoiceModel
              : undefined;
          modelId = body.model ?? characterCerebrasModel ?? CEREBRAS_DEFAULT_MODEL;
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

        // Final flush: hand any unsent tail to TTS. Everything before
        // ttsCursor was already dispatched as sentences completed.
        if (ttsCursor < replyText.length) {
          dispatchTtsChunk(replyText.slice(ttsCursor));
          ttsCursor = replyText.length;
        }

        if (ttsChunkCount === 0) {
          throw new Error("LLM returned an empty reply.");
        }

        // Wait for every dispatched chunk to finish forwarding audio to the
        // browser. Errors from any chunk surface here. On success, the
        // browser has already received every audio frame.
        await drainChain;

        serverTrace.mark("server.tts.done", {
          audioSamples: totalSamples,
          chunks: ttsChunkCount,
        });
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

          // Mark the turn complete with the assistant's reply + headline
          // metrics. This is what the workbench's turn timeline reads.
          if (body.turnId) {
            try {
              await getWorldSessionStore().upsertTurn({
                id: body.turnId,
                sessionId: body.sessionId,
                inputMode: "voice",
                userText: message,
                assistantText: replyText,
                provider: chosenProvider,
                model: modelId,
                status: "completed",
                startedAt: new Date(startedAt).toISOString(),
                completedAt: new Date().toISOString(),
                tokenUsage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                audioMetrics: {
                  audioSamples: totalSamples,
                  durationMs: Math.round((totalSamples / TTS_SAMPLE_RATE) * 1000),
                },
                latencySummary: {
                  firstAudioMs: firstAudioAt !== null ? Math.round(firstAudioAt - startedAt) : -1,
                  totalMs: Math.round(performance.now() - startedAt),
                },
                trace: serverTrace.toJSON(),
              });
            } catch (turnErr) {
              console.error("[voice-stream] upsertTurn (complete) failed", turnErr);
            }
          }

          // Background: summarize this turn into ≤30 words and persist as a
          // voice.summary event for the next turn's "Recent conversation"
          // section. Fire-and-forget — we don't block the SSE close.
          if (process.env.CEREBRAS_API_KEY?.trim()) {
            summarizeTurnInBackground({
              sessionId: body.sessionId,
              turnId: body.turnId ?? null,
              characterTitle: character.title,
              userMessage: message,
              agentReply: replyText,
              cerebrasApiKey: process.env.CEREBRAS_API_KEY.trim(),
              cerebrasModel: CEREBRAS_DEFAULT_MODEL,
            });
          }
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
        // Cancel any /speak fetches that may still be in flight — relevant
        // when a chunk's drain threw and later chunks' requests are now
        // orphaned (no consumer reads their body). On success this is a
        // no-op since every chunk has already completed.
        if (!ttsAbort.signal.aborted) ttsAbort.abort();
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
