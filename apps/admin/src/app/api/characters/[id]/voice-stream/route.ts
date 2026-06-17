import { NextRequest } from "next/server";
import {
  getCharacterStore,
  getVoiceStore,
  getWikiStore,
  getWikisStore,
  getSceneSessionStore,
} from "@odyssey/db";
import {
  createStreamingTtsAdapterForVoice,
  DEFAULT_VOICE_MODEL,
  embedText,
  embedTextLocal,
  getChatProviderForModel,
  modelMetaFor,
  POCKET_TTS_SAMPLE_RATE,
  type ChatSystemBlock,
  type ProviderId,
  type StreamingTtsProvider,
  type VoiceForRouting,
} from "@odyssey/engine";
import { curate, type Scene as CuratorScene, type SemanticSeed } from "@odyssey/wiki-curator";
import { TraceEnvelope } from "@/lib/voice-trace";
import { VOICE_STREAM_SSE_EVENT_NAMES } from "@/lib/voice-stream-events";
import { buildVoicePromptPlan } from "@odyssey/orchestration/server";
import {
  shouldSkipRetrieval,
  getRecentTurnSummaries,
  formatRecentConversation,
  summarizeTurnInBackground,
} from "@/lib/voice-context-helpers";
import {
  buildAndStoreSandboxVoiceContextCache,
  getOrWaitSandboxVoiceContextCache,
  sandboxVoiceContextCacheKeyForDebug,
} from "@/lib/sandbox-voice-context-cache";
import {
  getCachedVoiceAckAudio,
  voiceAckAudioCacheKey,
  type CachedVoiceAckAudio,
} from "@/lib/voice-ack-audio-cache";
import { isAckLaneEnabled, selectVoiceAck } from "@/lib/voice-ack-lane";
import { createEmbeddingSignedUrl } from "@/lib/voices-storage";
import { estimateSessionTurnCost } from "@/lib/session-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/voice-stream
 *
 * Pipes the LLM into a streaming TTS adapter and returns ONE merged SSE
 * stream containing both:
 *   - LLM tokens for live transcript display ("token" events)
 *   - Base64-encoded Float32 PCM frames as TTS produces them ("audio" events)
 *
 * Provider routing: the character's bound voice (via `character.voiceId`)
 * names a provider in the voices table. createStreamingTtsAdapterForVoice
 * dispatches on that — Pocket today, ElevenLabs/Cartesia/OpenAI as their
 * adapters land. All adapters normalize to Float32 LE PCM base64 so the
 * browser decoder stays a single code path (legacy contract from Moshi-WS).
 *
 * Live-harness chunking: TTS doesn't accept streaming text input, but we
 * still want first-audio to land as soon as possible. Strategy: detect
 * sentence boundaries inside the LLM token stream and dispatch one TTS
 * chunk per sentence the moment it completes. Chunks stream in parallel
 * via separate adapter.stream() invocations; audio frames are forwarded
 * to the browser in dispatch order via a serial drain chain so chunks
 * always play in sequence. For multi-sentence replies this drops
 * first-audio from "LLM total + TTS first chunk" to roughly "LLM first
 * sentence + TTS first chunk".
 *
 * SSE events:
 *   event: "trace"        TraceEnvelope JSON
 *   event: "token"        { delta: string }
 *   event: "first-audio"  { latencyMs: number }
 *   event: "audio"        { pcm: base64<Float32>, samples: number, sampleRate: number }
 *   event: "done"         { ... }
 *   event: "error"        { message: string }
 */

type LlmProvider = ProviderId;
type StreamingTtsRouting = ReturnType<typeof createStreamingTtsAdapterForVoice>;

type VoiceStreamBody = {
  sessionId?: string;
  turnId?: string;
  promptChunk?: string;
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  scene?: CuratorScene;
  provider?: LlmProvider;
  model?: string;
  maxTokens?: number;
  voice?: string;
  ackMode?: "auto" | "off";
  // Opt-in TTS override: name a voices-table slug to route this turn through
  // that voice's provider instead of the character's binding, leaving the
  // rest of the pipeline (identity, context, LLM) identical. The server
  // resolves all provider config from the DB row — the client supplies only
  // the slug, never credentials. Used for A/B benchmarking (Sonar) and
  // voice preview. Falls through to normal resolution if the slug is unknown
  // or not ready.
  ttsVoiceSlug?: string;
};

const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const OPENAI_DEFAULT_MODEL = "gpt-5-nano";
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_MAX_TOKENS = 1024;
// Fallback chain when no voice is bound: the legacy hardcoded Pocket slug
// kept the harness alive before voices were a first-class table. Once the
// migration backfills `provider='pocket_tts'` on every existing row, this
// only fires for the synthetic `abraham-fallback` character path.
const TTS_DEFAULT_VOICE_SLUG = "abraham";
const TTS_DEFAULT_PROVIDER: StreamingTtsProvider = "pocket_tts";
const TTS_MAX_CHUNK_CHARS = 220;
const TTS_FIRST_CHUNK_TARGET_CHARS = 80;
const VOICE_CONTEXT_TOKEN_BUDGET = 2500;
const VOICE_CONTEXT_PREP_WAIT_MS = 100;
type CurateOutput = Awaited<ReturnType<typeof curate>>;
const EMPTY_CURATOR_TRACE: CurateOutput["trace"] = {
  totalPages: 0,
  seeds: [],
  edges: [],
  timelineFiltered: [],
  scoreDropped: [],
  budgetDropped: [],
};

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

function findForceFlushBoundary(
  text: string,
  fromIndex: number,
  maxChunkChars = TTS_MAX_CHUNK_CHARS,
): number {
  // If the unsent tail exceeds TTS_MAX_CHUNK_CHARS with no sentence boundary
  // in sight, cut at the latest comma or whitespace within the window so the
  // chunk lands on a natural prosodic break. Returns -1 if we should wait.
  const tail = text.length - fromIndex;
  if (tail < maxChunkChars) return -1;
  const slice = text.slice(fromIndex, fromIndex + maxChunkChars);
  const minBreak = Math.min(60, Math.max(24, Math.floor(maxChunkChars * 0.45)));
  const lastComma = slice.lastIndexOf(",");
  if (lastComma >= minBreak) return fromIndex + lastComma + 1;
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= minBreak) return fromIndex + lastSpace + 1;
  return fromIndex + maxChunkChars;
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

  const sandboxPromptChunk = body.promptChunk ?? "";

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
  const requestedProvider = normalizeProvider(
    body.provider ?? voiceCfg?.provider ?? character.brainModel?.provider,
  );
  const modelId =
    body.model?.trim() ||
    voiceCfg?.model?.trim() ||
    character.brainModel?.model?.trim() ||
    defaultVoiceModelForProvider(requestedProvider ?? "cerebras");
  const modelMeta = modelMetaFor(modelId);
  if (!modelMeta) return jsonError(400, `unknown model "${modelId}"`);
  const provider: LlmProvider = modelMeta.provider;
  const characterVoiceMaxTokens = voiceCfg?.maxTokens ?? character.brainModel?.maxTokens;
  const maxTokens = Math.max(
    64,
    Math.min(1024, body.maxTokens ?? characterVoiceMaxTokens ?? DEFAULT_MAX_TOKENS),
  );
  // Voice resolution priority:
  //   1. character.voiceId binding → load the voices row, then dispatch to
  //      its provider via createStreamingTtsAdapterForVoice
  //   2. body.voice explicit Pocket slug fallback for static/authored scenes
  //      whose character has no ready voice binding yet
  //   3. fallback to a baked Pocket slug
  //
  // For Pocket voices the signed URL is generated alongside the slug so
  // audio-rt can fetch Supabase-managed embeddings; the URL is one-shot
  // (1h TTL) and only used for this request.
  let voiceForRouting: VoiceForRouting;
  // Opt-in override (benchmarking / preview): route through a named voices
  // row instead of the character's binding. Resolved entirely from the DB.
  const ttsOverrideVoice = body.ttsVoiceSlug
    ? await getVoiceStore()
        .getBySlug(body.ttsVoiceSlug)
        .catch(() => null)
    : null;
  if (ttsOverrideVoice && ttsOverrideVoice.status === "ready") {
    const embeddingUrl =
      ttsOverrideVoice.provider === "pocket_tts" && ttsOverrideVoice.embeddingPath
        ? await createEmbeddingSignedUrl(ttsOverrideVoice.embeddingPath).catch(() => null)
        : null;
    voiceForRouting = {
      provider: ttsOverrideVoice.provider as StreamingTtsProvider,
      slug: ttsOverrideVoice.slug,
      embeddingUrl,
      providerConfig: ttsOverrideVoice.providerConfig,
      voiceSettings: null,
    };
  } else if (
    "voiceId" in character &&
    typeof character.voiceId === "string" &&
    character.voiceId
  ) {
    const bound = await getVoiceStore().getById(character.voiceId);
    if (bound?.status === "ready") {
      const embeddingUrl =
        bound.provider === "pocket_tts" && bound.embeddingPath
          ? await createEmbeddingSignedUrl(bound.embeddingPath).catch(() => null)
          : null;
      voiceForRouting = {
        provider: bound.provider as StreamingTtsProvider,
        slug: bound.slug,
        embeddingUrl,
        providerConfig: bound.providerConfig,
        // Per-binding tuning overlay (jsonb on the character row). The
        // engine resolver merges this on top of providerConfig at synth
        // time and silently ignores it if the provider tags don't match
        // (e.g. stale override after a re-bind to a different provider).
        voiceSettings:
          (character.voiceSettings as Record<string, unknown> | null) ?? null,
      };
    } else {
      voiceForRouting = {
        provider: TTS_DEFAULT_PROVIDER,
        slug: body.voice ?? character.slug ?? TTS_DEFAULT_VOICE_SLUG,
        embeddingUrl: null,
      };
    }
  } else if (body.voice) {
    voiceForRouting = {
      provider: "pocket_tts",
      slug: body.voice,
      embeddingUrl: null,
    };
  } else {
    voiceForRouting = {
      provider: TTS_DEFAULT_PROVIDER,
      slug: TTS_DEFAULT_VOICE_SLUG,
      embeddingUrl: null,
    };
  }

  // Resolve the streaming adapter up front so misconfiguration (an
  // unimplemented provider, e.g. a character bound to an ElevenLabs voice
  // before that adapter ships) surfaces as a clean 4xx instead of a
  // mid-stream throw after the LLM has already started spending tokens.
  let ttsRouting: StreamingTtsRouting | null = null;
  try {
    ttsRouting = createStreamingTtsAdapterForVoice(voiceForRouting);
  } catch (routingErr) {
    return jsonError(
      501,
      routingErr instanceof Error ? routingErr.message : String(routingErr),
    );
  }
  const ttsVoiceContext = ttsRouting.voiceContext;
  const ttsProvider = ttsRouting.provider;
  const ttsFallbackRouting = await resolveVoiceStreamTtsFallback({
    primaryProvider: ttsProvider,
    primaryVoiceSlug: ttsVoiceContext.slug,
  });

  const missingProviderReason = missingProviderKeyReason(provider);
  if (missingProviderReason) {
    return jsonError(500, missingProviderReason);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = performance.now();
      const startedAtWall = Date.now();
      const serverTrace = new TraceEnvelope();
      serverTrace.mark("server.request.received", {
        requestedProvider,
        chosenProvider: provider,
        model: modelId,
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

      // Abort any in-flight adapter.stream() calls if the client disconnects
      // (barge-in). Adapters wire this through to their underlying fetch.
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
      let replyText = "";
      let emittedAnyToken = false;
      let brainFirstTokenAt: number | null = null;
      let ackFirstAudioAt: number | null = null;
      let ttsCursor = 0;
      let ttsChunkCount = 0;
      let drainChain: Promise<void> = Promise.resolve();
      let ackText: string | null = null;
      let cachedAckAudio: CachedVoiceAckAudio | null = null;
      let mainTokenGateOpen = true;
      const queuedMainTokenDeltas: string[] = [];

      const emitMainTokenDelta = (delta: string) => {
        if (!mainTokenGateOpen) {
          queuedMainTokenDeltas.push(delta);
          return;
        }
        sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.token, { delta });
      };

      const releaseMainTokenGate = () => {
        if (mainTokenGateOpen) return;
        mainTokenGateOpen = true;
        while (queuedMainTokenDeltas.length > 0) {
          sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.token, {
            delta: queuedMainTokenDeltas.shift()!,
          });
        }
      };

      const dispatchCachedAckAudio = (cached: CachedVoiceAckAudio): void => {
        const chunkIdx = ttsChunkCount++;
        serverTrace.mark("server.ack.audio_cache.dispatched", {
          chunkIdx,
          frames: cached.frames.length,
          samples: cached.totalSamples,
        });
        serverTrace.mark("server.tts.chunk.dispatched", {
          chunkIdx,
          kind: "ack",
          chars: cached.ackText.length,
          cachedAudio: true,
        });
        drainChain = drainChain.then(async () => {
          for (const frame of cached.frames) {
            if (req.signal.aborted) break;
            totalSamples += frame.samples;
            if (ackFirstAudioAt === null) {
              ackFirstAudioAt = performance.now();
              serverTrace.mark("server.ack.tts.first-audio", {
                latencyMs: Math.round(ackFirstAudioAt - startedAt),
                provider: ttsProvider,
                attempt: "cache",
              });
              sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.token, { delta: `${cached.ackText} ` });
              releaseMainTokenGate();
            }
            if (firstAudioAt === null) {
              firstAudioAt = performance.now();
              serverTrace.mark("server.tts.first-audio", {
                latencyMs: Math.round(firstAudioAt - startedAt),
                chunkIdx,
                kind: "ack",
                provider: ttsProvider,
                attempt: "cache",
              });
              sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.firstAudio, {
                latencyMs: Math.round(firstAudioAt - startedAt),
              });
            }
            sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.audio, {
              pcm: frame.pcmFloat32Base64,
              samples: frame.samples,
              sampleRate: frame.sampleRate,
            });
          }
          serverTrace.mark("server.tts.chunk.drained", {
            chunkIdx,
            kind: "ack",
            provider: ttsProvider,
            attempt: "cache",
          });
        });
      };

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
        let wikiPromptChunk = "";
        let semanticHitCount = 0;
        let semanticSeeds: SemanticSeed[] = [];
        let contextCacheHit = false;
        let contextCacheScope: "session" | "character" | null = null;
        let contextCacheBuiltAt: string | null = null;
        const contextCacheKey = sandboxVoiceContextCacheKeyForDebug({
          characterId: character.id,
          sessionId: body.sessionId,
          scene: body.scene,
          tokenBudget: VOICE_CONTEXT_TOKEN_BUDGET,
        });
        // Hoisted so we can persist these on the contextBuild record below
        // (the workbench's KnowledgeGraphPanel reads `selectedPages` to render
        // which wiki pages were pulled in for this turn).
        let curatorSelectedPages: CurateOutput["pages"] = [];
        let curatorTrace: CurateOutput["trace"] = EMPTY_CURATOR_TRACE;
        let curatorTokensUsed: number | null = null;
        let curatorTokensBudget: number | null = null;

        // Run summary-fetch in parallel with retrieval — both read-only,
        // independent. Promise.all keeps the latency floor at max(both).
        const summariesPromise = getRecentTurnSummaries(body.sessionId, 3);
        const cachedContextCandidate = await getOrWaitSandboxVoiceContextCache({
          characterId: character.id,
          sessionId: body.sessionId,
          scene: body.scene,
          tokenBudget: VOICE_CONTEXT_TOKEN_BUDGET,
        }, VOICE_CONTEXT_PREP_WAIT_MS);
        const cachedContext = cachedContextCandidate && isCachedContextReusableForMessage(
          cachedContextCandidate.sourceQuery,
          message,
        )
          ? cachedContextCandidate
          : null;
        if (cachedContextCandidate && !cachedContext) {
          serverTrace.mark("server.context.cache.miss_stale", {
            sourceQuery: cachedContextCandidate.sourceQuery,
            messageChars: message.length,
            selectedPages: cachedContextCandidate.pages.length,
          });
        }

        if (cachedContext) {
          contextCacheHit = true;
          contextCacheScope = cachedContext.cacheScope;
          contextCacheBuiltAt = cachedContext.builtAt;
          wikiPromptChunk = cachedContext.promptChunk;
          curatorSelectedPages = cachedContext.pages;
          curatorTrace = cachedContext.trace;
          curatorTokensUsed = cachedContext.tokensUsed;
          curatorTokensBudget = cachedContext.tokensBudget;
          serverTrace.mark("server.context.cache.hit", {
            scope: cachedContext.cacheScope,
            selectedPages: cachedContext.pages.length,
            tokensUsed: cachedContext.tokensUsed,
            sourceQuery: cachedContext.sourceQuery,
            builtAt: cachedContext.builtAt,
          });
        } else if (skipDecision.skip) {
          serverTrace.mark("server.retrieval.skipped", { reason: skipDecision.reason });
        } else if (process.env.VOICE_SEMANTIC_RETRIEVAL === "0") {
          serverTrace.mark("server.retrieval.skipped", { reason: "disabled" });
        } else {
          try {
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
            // Move 01 cutover (flag-gated, default OpenAI): the co-located
            // bge-small embedder + the 384-dim embedding_bge column when
            // EMBEDDING_PROVIDER=bge; otherwise OpenAI text-embedding-3-small
            // against embedding(1536). Each path uses its matching column.
            const useBge = process.env.EMBEDDING_PROVIDER === "bge";
            const queryEmbedding = useBge
              ? await embedTextLocal(embedQuery, { isQuery: true })
              : await embedText(embedQuery);
            // Split the retrieval span: embed (Move 01's target) vs pgvector search.
            serverTrace.mark("server.retrieval.embedded", {
              dims: queryEmbedding?.length ?? 0,
              embedder: useBge ? "bge-small" : "openai",
            });
            if (queryEmbedding) {
              const activeWikiIds = (await getWikisStore().listWikisForCharacter(character.id))
                .filter((wiki) => wiki.binding.isActive)
                .map((wiki) => wiki.id);
              const hits = useBge
                ? await getWikiStore().searchPagesByBgeEmbeddingForWikis(
                    activeWikiIds,
                    queryEmbedding,
                    { topK: 5, minSimilarity: 0.5 },
                  )
                : await getWikiStore().searchPagesByEmbeddingForWikis(
                    activeWikiIds,
                    queryEmbedding,
                    { topK: 5, minSimilarity: 0.5 },
                  );
              semanticHitCount = hits.length;
              semanticSeeds = hits.map((h) => ({
                pageId: h.pageId,
                slug: h.slug,
                similarity: h.similarity,
              }));
              serverTrace.mark("server.retrieval.done", {
                hits: semanticHitCount,
                embedQueryAware: Boolean(lastSummary),
              });
            } else {
              serverTrace.mark("server.retrieval.skipped", { reason: "no-embedding" });
            }
          } catch (retrievalErr) {
            serverTrace.mark("server.retrieval.error", {
              message: retrievalErr instanceof Error ? retrievalErr.message : String(retrievalErr),
            });
          }
        }

        if (!cachedContext) {
          try {
            serverTrace.mark("server.curator.start", {
              hasScene: Boolean(body.scene?.activeEntities?.length || body.scene?.location),
              semanticSeeds: semanticSeeds.length,
            });
            const curated = await buildAndStoreSandboxVoiceContextCache({
              characterId: character.id,
              sessionId: body.sessionId,
              query: message,
              scene: body.scene,
              semanticSeeds,
              tokenBudget: VOICE_CONTEXT_TOKEN_BUDGET,
            });
            wikiPromptChunk = curated.promptChunk;
            curatorSelectedPages = curated.pages;
            curatorTrace = curated.trace;
            curatorTokensUsed = curated.tokensUsed;
            curatorTokensBudget = curated.tokensBudget;
            contextCacheScope = curated.cacheScope;
            contextCacheBuiltAt = curated.builtAt;
            serverTrace.mark("server.curator.done", {
              selectedPages: curated.pages.length,
              tokensUsed: curated.tokensUsed,
              tokensBudget: curated.tokensBudget,
              curatorMs: curated.elapsedMs,
              cachedForNextTurn: true,
            });
          } catch (curatorErr) {
            serverTrace.mark("server.curator.error", {
              message: curatorErr instanceof Error ? curatorErr.message : String(curatorErr),
            });
          }
        }

        const activeContextCacheKey = cachedContext?.key ?? contextCacheKey;
        const ackEnabled =
          contextCacheHit &&
          body.ackMode !== "off" &&
          isAckLaneEnabled();
        ackText = selectVoiceAck({
          enabled: ackEnabled,
          characterTitle: character.title,
          message,
          selectedPages: curatorSelectedPages,
        });
        if (ackText) {
          mainTokenGateOpen = false;
          serverTrace.mark("server.ack.selected", {
            text: ackText,
            selectedPages: curatorSelectedPages.map((selected) => selected.page.slug),
          });
          cachedAckAudio = getCachedVoiceAckAudio(voiceAckAudioCacheKey({
            contextCacheKey: activeContextCacheKey,
            ttsProvider,
            ttsVoice: ttsVoiceContext.slug,
            ackText,
          }));
          serverTrace.mark(
            cachedAckAudio ? "server.ack.audio_cache.hit" : "server.ack.audio_cache.miss",
            {
              provider: ttsProvider,
              voice: ttsVoiceContext.slug,
              text: ackText,
              frames: cachedAckAudio?.frames.length ?? 0,
              samples: cachedAckAudio?.totalSamples ?? 0,
            },
          );
          if (cachedAckAudio) {
            dispatchCachedAckAudio(cachedAckAudio);
          }
        }

        const recentSummaries = await summariesPromise;
        const recentSection = formatRecentConversation(recentSummaries);
        const composedPromptChunk = [
          sandboxPromptChunk.trim(),
          recentSection.trim(),
          wikiPromptChunk ? `## Relevant knowledge\n${wikiPromptChunk}` : "",
        ].filter(Boolean).join("\n\n");
        const promptPlan = await buildVoicePromptPlan(
          {
            characterId: character.id,
            character,
            mode: "voice-turn",
            promptKind: "voice",
            curatedContext: {
              promptChunk: composedPromptChunk,
              pages: curatorSelectedPages,
              trace: curatorTrace,
              tokensUsed: curatorTokensUsed ?? 0,
              tokensBudget: curatorTokensBudget ?? 0,
              elapsedMs: 0,
            },
          },
          {
            getCharacterById: (characterId) => getCharacterStore().getById(characterId),
            curate,
          },
        );
        const systemPrompt = promptPlan.systemPrompt;
        serverTrace.mark("server.context.attached", {
          characterId: character.id,
          sessionId: body.sessionId ?? null,
          turnId: body.turnId ?? null,
          promptChunkChars: sandboxPromptChunk.length,
          wikiPromptChunkChars: wikiPromptChunk.length,
          semanticHits: semanticHitCount,
          selectedPages: curatorSelectedPages.length,
          selectedPageSlugs: curatorSelectedPages.map((selected) => selected.page.slug),
          retrievalSkipped: skipDecision.skip,
          retrievalSkipReason: skipDecision.skip ? skipDecision.reason : null,
          recentSummaries: recentSummaries.length,
          systemPromptChars: systemPrompt.length,
          historyTurns: body.history?.length ?? 0,
          messageChars: message.length,
          contextCacheHit,
          contextCacheScope,
          contextCacheBuiltAt,
          ackEnabled,
          ackSelected: Boolean(ackText),
          ackAudioCacheHit: Boolean(cachedAckAudio),
        });
        sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.trace, serverTrace.toJSON());

        // Persist the assembled context + turn-start record so the session
        // workbench can render exactly what the LLM saw on this turn. Both
        // calls are gated on sessionId + turnId — without them there's no
        // place to attach the records. Failures here are non-fatal: the
        // turn still proceeds, the workbench just won't have data for it.
        if (body.sessionId && body.turnId) {
          const sessionStore = getSceneSessionStore();
          try {
            await sessionStore.upsertTurn({
              id: body.turnId,
              sessionId: body.sessionId,
              inputMode: "voice",
              speakerSlug: character.slug,
              userText: message,
              status: "in_progress",
              startedAt: new Date(startedAtWall).toISOString(),
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
              scene: body.scene,
              tokenBudget: curatorTokensBudget,
              tokensUsed: curatorTokensUsed,
              tokensBudget: curatorTokensBudget,
              selectedPages: curatorSelectedPages,
              curatorTrace,
              timingTrace: serverTrace.toJSON(),
              promptChunk: composedPromptChunk,
              systemPrompt,
              metadata: {
                semanticHits: semanticHitCount,
                retrievalSkipped: skipDecision.skip,
                retrievalSkipReason: skipDecision.skip ? skipDecision.reason : null,
                recentSummaries: recentSummaries.length,
                wikiPromptChunkChars: wikiPromptChunk.length,
                pageSlugs: curatorSelectedPages.map((selected) => selected.page.slug),
                contextCacheHit,
                contextCacheKey: activeContextCacheKey,
                contextCacheScope,
                contextCacheBuiltAt,
                realtimeLane: contextCacheHit,
                ackEnabled,
                ackText,
                ackAudioCacheHit: Boolean(cachedAckAudio),
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
        const drainOneChunk = async (
          chunkIdx: number,
          chunkText: string,
          kind: "ack" | "main",
        ): Promise<void> => {
          if (req.signal.aborted) return;
          const drainWithRouting = async (
            routing: StreamingTtsRouting,
            attempt: "primary" | "fallback",
          ) => {
            let openedTraced = false;
            for await (const frame of routing.adapter.stream({
              text: chunkText,
              voice: routing.voiceContext,
              signal: ttsAbort.signal,
            })) {
              if (req.signal.aborted) break;
              if (!openedTraced) {
                serverTrace.mark("server.tts.fetch.opened", {
                  provider: routing.provider,
                  chunkIdx,
                  kind,
                  attempt,
                });
                openedTraced = true;
              }
              if (frame.type === "audio") {
                totalSamples += frame.samples;
                if (kind === "ack" && ackFirstAudioAt === null) {
                  ackFirstAudioAt = performance.now();
                  serverTrace.mark("server.ack.tts.first-audio", {
                    latencyMs: Math.round(ackFirstAudioAt - startedAt),
                    provider: routing.provider,
                    attempt,
                  });
                  if (ackText) {
                    sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.token, { delta: `${ackText} ` });
                  }
                  releaseMainTokenGate();
                }
                if (firstAudioAt === null) {
                  firstAudioAt = performance.now();
                  serverTrace.mark("server.tts.first-audio", {
                    latencyMs: Math.round(firstAudioAt - startedAt),
                    chunkIdx,
                    kind,
                    provider: routing.provider,
                    attempt,
                  });
                  sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.firstAudio, {
                    latencyMs: Math.round(firstAudioAt - startedAt),
                  });
                }
                sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.audio, {
                  pcm: frame.pcmFloat32Base64,
                  samples: frame.samples,
                  sampleRate: frame.sampleRate,
                });
              } else if (frame.type === "error") {
                throw new Error(frame.message);
              }
            }
            serverTrace.mark("server.tts.chunk.drained", {
              chunkIdx,
              kind,
              provider: routing.provider,
              attempt,
            });
          };

          try {
            await drainWithRouting(ttsRouting!, "primary");
          } catch (primaryErr) {
            if (!ttsFallbackRouting || req.signal.aborted) throw primaryErr;
            const message =
              primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
            serverTrace.mark("server.tts.fallback", {
              chunkIdx,
              kind,
              fromProvider: ttsProvider,
              toProvider: ttsFallbackRouting.provider,
              toVoice: ttsFallbackRouting.voiceContext.slug,
              reason: message,
            });
            if (body.sessionId) {
              await getSceneSessionStore().appendEvent({
                sessionId: body.sessionId,
                turnId: body.turnId ?? null,
                type: "tts.provider_fallback",
                source: "system",
                payload: {
                  chunkIdx,
                  fromProvider: ttsProvider,
                  fromVoice: ttsVoiceContext.slug,
                  toProvider: ttsFallbackRouting.provider,
                  toVoice: ttsFallbackRouting.voiceContext.slug,
                  reason: message,
                },
              }).catch((eventErr) => {
                console.error("[voice-stream] fallback event failed", eventErr);
              });
            }
            await drainWithRouting(ttsFallbackRouting, "fallback");
          }
        };

        const dispatchTtsChunk = (text: string): void => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const chunkIdx = ttsChunkCount++;
          if (chunkIdx === 0) {
            serverTrace.mark("server.tts.fetch.requested", {
              provider: ttsProvider,
              voice: ttsVoiceContext.slug,
              firstChunkChars: trimmed.length,
            });
          }
          serverTrace.mark("server.tts.chunk.dispatched", {
            chunkIdx,
            kind: "main",
            chars: trimmed.length,
          });
          drainChain = drainChain.then(() => drainOneChunk(chunkIdx, trimmed, "main"));
        };

        const dispatchAckChunk = (text: string): void => {
          const trimmed = text.trim();
          if (!trimmed) return;
          const chunkIdx = ttsChunkCount++;
          serverTrace.mark("server.ack.tts.requested", {
            provider: ttsProvider,
            voice: ttsVoiceContext.slug,
            chars: trimmed.length,
          });
          serverTrace.mark("server.tts.chunk.dispatched", {
            chunkIdx,
            kind: "ack",
            chars: trimmed.length,
          });
          drainChain = drainChain
            .then(() => drainOneChunk(chunkIdx, trimmed, "ack"))
            .catch((ackErr) => {
              serverTrace.mark("server.ack.tts.failed", {
                message: ackErr instanceof Error ? ackErr.message : String(ackErr),
              });
              releaseMainTokenGate();
            });
        };

        const onToken = (delta: string) => {
          if (req.signal.aborted) return;
          if (!delta) return;
          if (!emittedAnyToken) {
            brainFirstTokenAt = performance.now();
            serverTrace.mark("server.llm.first-token");
            emittedAnyToken = true;
          }
          replyText += delta;
          emitMainTokenDelta(delta);

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
          const forced = findForceFlushBoundary(
            replyText,
            ttsCursor,
            ttsChunkCount === 0 ? TTS_FIRST_CHUNK_TARGET_CHARS : TTS_MAX_CHUNK_CHARS,
          );
          if (forced > 0) {
            dispatchTtsChunk(replyText.slice(ttsCursor, forced));
            ttsCursor = forced;
          }
        };

        if (ackText && !cachedAckAudio) {
          dispatchAckChunk(ackText);
        }

        let chosenProvider: LlmProvider | null = null;
        const attempts = provider === "cerebras" || provider === "groq" ? 2 : 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          serverTrace.mark("server.llm.attempt", { provider, model: modelId, attempt });
          try {
            ({ inputTokens, outputTokens } = await streamFromCharacterModel({
              model: modelId,
              systemPromptParts: promptPlan.systemPromptParts,
              history,
              message,
              maxTokens,
              temperature: voiceCfg?.temperature ?? character.brainModel?.temperature,
              topP: voiceCfg?.topP ?? character.brainModel?.topP,
              signal: req.signal,
              onToken,
            }));
            chosenProvider = provider;
            serverTrace.mark("server.llm.succeeded", {
              provider,
              model: modelId,
              attempt,
            });
            break;
          } catch (providerErr) {
            serverTrace.mark("server.llm.failed", {
              provider,
              model: modelId,
              attempt,
              message: providerErr instanceof Error ? providerErr.message : String(providerErr),
            });
            const rateLimited = isRateLimitError(providerErr);
            if (rateLimited && attempt < attempts && !emittedAnyToken && !req.signal.aborted) {
              await new Promise((resolve) => setTimeout(resolve, 200));
              continue;
            }
            throw providerErr;
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
        releaseMainTokenGate();

        serverTrace.mark("server.tts.done", {
          audioSamples: totalSamples,
          chunks: ttsChunkCount,
        });
        const deliveredAckText = ackFirstAudioAt !== null ? ackText : null;
        const assistantText = [deliveredAckText, replyText].filter(Boolean).join(" ").trim();
        const ackFirstAudioMs =
          ackFirstAudioAt !== null ? Math.round(ackFirstAudioAt - startedAt) : null;
        const brainFirstTokenMs =
          brainFirstTokenAt !== null ? Math.round(brainFirstTokenAt - startedAt) : null;
        const ackDelivered = Boolean(deliveredAckText);
        if (body.sessionId) {
          const firstAudioMs =
            firstAudioAt !== null
              ? Math.round(firstAudioAt - startedAt)
              : -1;
          const totalMs = Math.round(performance.now() - startedAt);
          const durationMs = Math.round((totalSamples / POCKET_TTS_SAMPLE_RATE) * 1000);
          const cost = estimateSessionTurnCost(modelId, {
            inputTokens,
            outputTokens,
          });
          await getSceneSessionStore().appendEvent({
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
              durationMs,
              firstAudioMs,
              totalMs,
              estimatedCostUsd: cost.estimatedCostUsd,
              ackEnabled,
              ackText,
              ackDelivered,
              ackFirstAudioMs,
              brainFirstTokenMs,
              ackAudioCacheHit: Boolean(cachedAckAudio),
              serverTrace: serverTrace.toJSON(),
            },
          });

          // Mark the turn complete with the assistant's reply + headline
          // metrics. This is what the workbench's turn timeline reads.
          if (body.turnId) {
            try {
              await getSceneSessionStore().upsertTurn({
                id: body.turnId,
                sessionId: body.sessionId,
                inputMode: "voice",
                speakerSlug: character.slug,
                userText: message,
                assistantText,
                provider: chosenProvider,
                model: modelId,
                status: "completed",
                startedAt: new Date(startedAtWall).toISOString(),
                completedAt: new Date().toISOString(),
                tokenUsage: {
                  input: inputTokens,
                  output: outputTokens,
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                  estimatedCostUsd: cost.estimatedCostUsd,
                },
                audioMetrics: {
                  audioSamples: totalSamples,
                  durationMs,
                  sampleRate: POCKET_TTS_SAMPLE_RATE,
                },
                latencySummary: {
                  firstAudioMs,
                  totalMs,
                  ackFirstAudioMs,
                  brainFirstTokenMs,
                },
                trace: serverTrace.toJSON(),
                metadata: {
                  source: "character-sandbox",
                  cost,
                  ttsProvider,
                  ttsVoice: ttsVoiceContext.slug,
                  ackEnabled,
                  ackText,
                  ackDelivered,
                  ackFirstAudioMs,
                  brainFirstTokenMs,
                  ackAudioCacheHit: Boolean(cachedAckAudio),
                },
              });
            } catch (turnErr) {
              console.error("[voice-stream] upsertTurn (complete) failed", turnErr);
            }
          }

          if (contextCacheHit) {
            refreshSandboxVoiceContextCacheInBackground({
              characterId: character.id,
              sessionId: body.sessionId,
              turnId: body.turnId ?? null,
              query: message,
              scene: body.scene,
              tokenBudget: VOICE_CONTEXT_TOKEN_BUDGET,
            });
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
              agentReply: assistantText,
              cerebrasApiKey: process.env.CEREBRAS_API_KEY.trim(),
              cerebrasModel: DEFAULT_VOICE_MODEL,
            });
          }
        }

        sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.done, {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          audioSamples: totalSamples,
          durationMs: Math.round((totalSamples / POCKET_TTS_SAMPLE_RATE) * 1000),
          firstAudioMs:
            firstAudioAt !== null
              ? Math.round(firstAudioAt - startedAt)
              : -1,
          totalMs: Math.round(performance.now() - startedAt),
          provider: chosenProvider,
          model: modelId,
          ttsProvider,
          ttsVoice: ttsVoiceContext.slug,
          ackEnabled,
          ackText,
          ackDelivered,
          ackFirstAudioMs,
          brainFirstTokenMs,
          ackAudioCacheHit: Boolean(cachedAckAudio),
          estimatedCostUsd: estimateSessionTurnCost(modelId, {
            inputTokens,
            outputTokens,
          }).estimatedCostUsd,
          serverTrace: serverTrace.toJSON(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        serverTrace.mark("server.error", { message: msg });
        if (body.sessionId) {
          await getSceneSessionStore().appendEvent({
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
        sendEvent(VOICE_STREAM_SSE_EVENT_NAMES.error, { message: msg });
      } finally {
        // Cancel any in-flight adapter.stream() reads — relevant when a
        // chunk's drain threw and later chunks are still mid-iteration.
        // On success this is a no-op since every chunk has already drained.
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

function refreshSandboxVoiceContextCacheInBackground(args: {
  characterId: string;
  sessionId: string;
  turnId: string | null;
  query: string;
  scene?: CuratorScene;
  tokenBudget: number;
}): void {
  void (async () => {
    const startedAt = performance.now();
    const refreshed = await buildAndStoreSandboxVoiceContextCache({
      characterId: args.characterId,
      sessionId: args.sessionId,
      query: args.query,
      scene: args.scene,
      tokenBudget: args.tokenBudget,
    });
    await getSceneSessionStore().appendEvent({
      sessionId: args.sessionId,
      turnId: args.turnId,
      type: "context.cache_refreshed",
      source: "system",
      payload: {
        characterId: args.characterId,
        cacheKey: refreshed.key,
        cacheScope: refreshed.cacheScope,
        sourceQuery: refreshed.sourceQuery,
        selectedPages: refreshed.pages.map((selected) => selected.page.slug),
        tokensUsed: refreshed.tokensUsed,
        tokensBudget: refreshed.tokensBudget,
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    });
  })().catch((err) => {
    console.error("[voice-stream] context cache refresh failed", err);
  });
}

function isCachedContextReusableForMessage(sourceQuery: string | null, message: string): boolean {
  const currentTerms = contentTerms(message);
  if (currentTerms.length <= 2) return true;
  const sourceTerms = contentTerms(sourceQuery ?? "");
  if (sourceTerms.length === 0) return false;
  const sourceSet = new Set(sourceTerms);
  const overlap = currentTerms.filter((term) => sourceSet.has(term)).length;
  return overlap >= Math.min(2, currentTerms.length) || overlap / currentTerms.length >= 0.4;
}

function contentTerms(value: string): string[] {
  const raw = value.toLowerCase().split(/[^a-z0-9'-]+/).filter(Boolean);
  return Array.from(new Set(raw.filter((term) => term.length > 2 && !CONTEXT_CACHE_STOPWORDS.has(term))));
}

const CONTEXT_CACHE_STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "you", "your", "they", "them", "who",
  "what", "when", "where", "why", "how", "this", "that", "these", "those",
  "tell", "talk", "came", "come", "keep", "connect", "referring", "about",
  "from", "into", "onto", "with", "than", "then", "though", "thus", "yet",
  "not", "all", "any", "some", "more", "most", "much", "very", "just",
  "also", "only", "still", "even", "such", "other", "our", "say", "did",
  "does", "have", "has", "had", "was", "were", "will", "now",
]);

/* ── TTS fallback helpers ───────────────────────────────────────── */

async function resolveVoiceStreamTtsFallback(input: {
  primaryProvider: StreamingTtsProvider;
  primaryVoiceSlug: string;
}): Promise<StreamingTtsRouting | null> {
  if (input.primaryProvider === "elevenlabs") return null;

  const requested = normalizeStreamingTtsProvider(
    process.env.VOICE_STREAM_TTS_FALLBACK_PROVIDER ??
      process.env.TTS_PROVIDER,
  );
  if (requested !== "elevenlabs") return null;
  if (!process.env.ELEVENLABS_API_KEY?.trim()) return null;

  const selector =
    process.env.ELEVENLABS_FALLBACK_VOICE_ID?.trim() ??
    process.env.ELEVENLABS_FALLBACK_VOICE_SLUG?.trim() ??
    "";
  const voices = await getVoiceStore().list().catch((err) => {
    console.error("[voice-stream] fallback voice list failed", err);
    return [];
  });
  const fallback = voices.find((voice) => {
    if (voice.provider !== "elevenlabs" || voice.status !== "ready") return false;
    if (!selector) return voice.slug !== input.primaryVoiceSlug;
    const providerVoiceId =
      typeof voice.providerConfig?.voiceId === "string"
        ? voice.providerConfig.voiceId
        : "";
    return (
      voice.id === selector ||
      voice.slug === selector ||
      providerVoiceId === selector
    );
  });
  if (!fallback) return null;

  return createStreamingTtsAdapterForVoice({
    provider: "elevenlabs",
    slug: fallback.slug,
    providerConfig: fallback.providerConfig,
  });
}

function normalizeStreamingTtsProvider(value?: string | null): StreamingTtsProvider | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "pocket_tts" ||
    normalized === "elevenlabs" ||
    normalized === "openai" ||
    normalized === "cartesia"
  ) {
    return normalized;
  }
  return null;
}

/* ── LLM streaming helpers ──────────────────────────────────────── */

async function streamFromCharacterModel(opts: {
  model: string;
  systemPromptParts: { cached: string; perTurn: string };
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  signal: AbortSignal;
  onToken: (delta: string) => void;
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const provider = getChatProviderForModel(opts.model);
  const system = buildSystemBlocks(opts.systemPromptParts);
  const messages = [
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: opts.message },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let errorMessage: string | null = null;
  let completed = false;

  await provider.stream(
    {
      model: opts.model,
      system,
      messages,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      ...(typeof opts.topP === "number" ? { topP: opts.topP } : {}),
    },
    (ev) => {
      if (ev.type === "token") {
        opts.onToken(ev.delta);
      } else if (ev.type === "done") {
        inputTokens = ev.inputTokens;
        outputTokens = ev.outputTokens;
        completed = true;
      } else if (ev.type === "error") {
        errorMessage = ev.message;
      }
    },
  );

  if (errorMessage) {
    throw new Error(errorMessage);
  }
  if (!completed) {
    throw new Error("LLM stream ended before completion.");
  }
  return { inputTokens, outputTokens };
}

function buildSystemBlocks(parts: { cached: string; perTurn: string }): ChatSystemBlock[] {
  const blocks: ChatSystemBlock[] = [];
  if (parts.cached.trim()) blocks.push({ type: "text", text: parts.cached });
  if (parts.perTurn.trim()) blocks.push({ type: "text", text: parts.perTurn });
  return blocks.length > 0 ? blocks : [{ type: "text", text: " " }];
}

function normalizeProvider(value?: string | null): ProviderId | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "anthropic" ||
    normalized === "openai" ||
    normalized === "cerebras" ||
    normalized === "groq"
  ) {
    return normalized;
  }
  return null;
}

function defaultVoiceModelForProvider(provider: ProviderId): string {
  switch (provider) {
    case "anthropic":
      return ANTHROPIC_DEFAULT_MODEL;
    case "openai":
      return OPENAI_DEFAULT_MODEL;
    case "groq":
      return GROQ_DEFAULT_MODEL;
    case "cerebras":
      return DEFAULT_VOICE_MODEL;
  }
}

function missingProviderKeyReason(provider: ProviderId): string | null {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim()
        ? null
        : "ANTHROPIC_API_KEY is not configured.";
    case "openai":
      return process.env.OPENAI_API_KEY?.trim()
        ? null
        : "OPENAI_API_KEY is not configured.";
    case "cerebras":
      return process.env.CEREBRAS_API_KEY?.trim()
        ? null
        : "CEREBRAS_API_KEY is not configured.";
    case "groq":
      return process.env.GROQ_API_KEY?.trim()
        ? null
        : "GROQ_API_KEY is not configured.";
  }
}

function isRateLimitError(err: unknown): boolean {
  const text = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    text.includes("429") ||
    text.includes("queue_exceeded") ||
    text.includes("too_many_requests") ||
    text.includes("rate limit") ||
    text.includes("rate_limit")
  );
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
