import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import {
  clearSandboxVoiceContextCache,
  sandboxVoiceContextCacheKeyForDebug,
  storeSandboxVoiceContextCache,
} from "@/lib/sandbox-voice-context-cache";
import {
  clearVoiceAckAudioCache,
  storeCachedVoiceAckAudio,
  voiceAckAudioCacheKey,
} from "@/lib/voice-ack-audio-cache";

const upsertTurn = vi.hoisted(() => vi.fn());
const recordContextBuild = vi.hoisted(() => vi.fn());
const appendEvent = vi.hoisted(() => vi.fn());
const ttsTexts = vi.hoisted(() => [] as string[]);
const failAckTts = vi.hoisted(() => ({ current: false }));
const characterVoiceId = vi.hoisted(() => ({ current: null as string | null }));
const buildVoicePromptPlan = vi.hoisted(() =>
  vi.fn(async (input: {
    curatedContext?: {
      promptChunk: string;
      pages: Array<{ page: { slug: string } }>;
      trace: unknown;
      tokensUsed: number;
      tokensBudget: number;
    };
  }) => ({
    systemPrompt: "You are Abraham.",
    systemPromptParts: {
      cached: "You are Abraham.",
      perTurn: input.curatedContext?.promptChunk ?? "Speak plainly.",
    },
    promptChunk: input.curatedContext?.promptChunk ?? "",
    trace: input.curatedContext?.trace ?? {},
    pages: input.curatedContext?.pages ?? [],
    pageSlugs: (input.curatedContext?.pages ?? []).map((selected) => selected.page.slug),
    tokensUsed: input.curatedContext?.tokensUsed ?? 0,
    tokensBudget: input.curatedContext?.tokensBudget ?? 0,
    elapsedMs: 0,
    routingMode: "voice-turn",
    promptKind: "voice",
    timingTrace: {
      startedAt: new Date().toISOString(),
      elapsedMs: 1,
      events: [],
    },
  })),
);
const curate = vi.hoisted(() =>
  vi.fn(async () => ({
    promptChunk: "Lot separated from Abraham near Canaan.",
    pages: [
      {
        page: { slug: "lot", title: "Lot", type: "entity" },
        rendering: "full",
        score: 1000,
        origin: "query-title",
        trail: ["lot"],
        tokens: 128,
      },
      {
        page: {
          slug: "abraham-voice-identity",
          title: "Abraham voice identity",
          type: "voice_identity",
        },
        rendering: "full",
        score: 1000,
        origin: "voice-identity",
        trail: ["abraham-voice-identity"],
        tokens: 256,
      },
    ],
    trace: {
      totalPages: 2,
      seeds: [],
      edges: [],
      timelineFiltered: [],
      scoreDropped: [],
      budgetDropped: [],
    },
    tokensUsed: 384,
    tokensBudget: 2500,
    elapsedMs: 3,
  })),
);

vi.mock("@odyssey/db", () => ({
  getCharacterStore: () => ({
    getById: vi.fn(async (id: string) => ({
      id,
      slug: "abraham",
      title: "Abraham",
      brainModel: {
        provider: "cerebras",
        model: "qwen-3-235b-a22b-instruct-2507",
        maxTokens: 128,
      },
      directive: null,
      identity: null,
      voiceStyle: null,
      voiceId: characterVoiceId.current,
    })),
    getBySlug: vi.fn(async () => null),
  }),
  getVoiceStore: () => ({
    getById: vi.fn(async (id: string) =>
      id === "voice_eleven"
        ? {
            id,
            slug: "liam",
            name: "Liam",
            provider: "elevenlabs",
            status: "ready",
            embeddingPath: null,
            providerConfig: { voiceId: "eleven_voice_1" },
          }
        : null,
    ),
    list: vi.fn(async () => []),
  }),
  getWikiStore: () => ({
    searchPagesByEmbeddingForWikis: vi.fn(async () => []),
  }),
  getWikisStore: () => ({
    listWikisForCharacter: vi.fn(async () => []),
  }),
  getWorldSessionStore: () => ({
    upsertTurn,
    recordContextBuild,
    appendEvent,
  }),
}));

vi.mock("@odyssey/engine", () => ({
  DEFAULT_VOICE_MODEL: "qwen-3-235b-a22b-instruct-2507",
  POCKET_TTS_SAMPLE_RATE: 24_000,
  embedText: vi.fn(async () => null),
  modelMetaFor: vi.fn((id: string) => ({
    id,
    provider: "cerebras",
    pricing: { input: 0.6, output: 1.2 },
  })),
  pricingFor: vi.fn(() => ({ input: 0.6, output: 1.2 })),
  getChatProviderForModel: vi.fn(() => ({
    id: "cerebras",
    stream: async (
      _opts: unknown,
      onEvent: (event: unknown) => void,
    ) => {
      onEvent({ type: "token", delta: "Testing voice pipeline." });
      onEvent({
        type: "done",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheState: "off",
        model: "qwen-3-235b-a22b-instruct-2507",
      });
    },
  })),
  createStreamingTtsAdapterForVoice: vi.fn((voice: { provider?: string; slug: string }) => ({
    provider: voice.provider ?? "pocket_tts",
    voiceContext: { slug: voice.slug },
    adapter: {
      stream: async function* ({ text }: { text: string }) {
        ttsTexts.push(text);
        if (failAckTts.current && text === "Yes, I remember Lot.") {
          yield { type: "error", message: "ack synth failed" };
          return;
        }
        const samples = new Float32Array([0, 0.2, -0.2, 0]);
        yield {
          type: "audio",
          pcmFloat32Base64: Buffer.from(samples.buffer).toString("base64"),
          samples: samples.length,
          sampleRate: 24_000,
        };
      },
    },
  })),
}));

vi.mock("@odyssey/orchestration/server", () => ({
  buildVoicePromptPlan,
  OrchestrationContextError: class OrchestrationContextError extends Error {
    constructor(message: string, public readonly status = 500) {
      super(message);
    }
  },
}));

vi.mock("@odyssey/wiki-curator", () => ({
  curate,
}));

vi.mock("@/lib/voice-context-helpers", () => ({
  shouldSkipRetrieval: vi.fn(() => ({ skip: true, reason: "test" })),
  getRecentTurnSummaries: vi.fn(async () => []),
  formatRecentConversation: vi.fn(() => ""),
  summarizeTurnInBackground: vi.fn(),
}));

const routeCtx = {
  params: Promise.resolve({ id: "char_1" }),
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/characters/char_1/voice-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function seedLotContextCache() {
  storeSandboxVoiceContextCache({
    characterId: "char_1",
    sessionId: "session_1",
    scene: undefined,
    tokenBudget: 2500,
    result: {
      promptChunk: "Cached voice identity and Lot context.",
      pages: [
        {
          page: { slug: "lot", title: "Lot", type: "entity" } as never,
          rendering: "summary",
          score: 900,
          origin: "cache",
          trail: ["lot"],
          tokens: 64,
        },
      ],
      trace: {
        totalPages: 1,
        seeds: [{ slug: "lot", reason: "query-title", score: 900 }],
        edges: [],
        timelineFiltered: [],
        scoreDropped: [],
        budgetDropped: [],
      },
      tokensUsed: 64,
      tokensBudget: 2500,
      elapsedMs: 1,
    },
  });
}

describe("character voice-stream persistence", () => {
  beforeEach(() => {
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    vi.stubEnv("VOICE_SEMANTIC_RETRIEVAL", "0");
  });

  afterEach(() => {
    upsertTurn.mockReset();
    recordContextBuild.mockReset();
    appendEvent.mockReset();
    ttsTexts.length = 0;
    failAckTts.current = false;
    characterVoiceId.current = null;
    buildVoicePromptPlan.mockClear();
    curate.mockClear();
    clearSandboxVoiceContextCache();
    clearVoiceAckAudioCache();
    vi.unstubAllEnvs();
  });

  it("streams voice and persists turn, context, latency, audio, and cost", async () => {
    const response = await POST(
      request({
        sessionId: "session_1",
        turnId: "turn_1",
        message: "Are you there?",
        history: [],
        scene: { activeEntities: ["lot"], location: "canaan" },
        model: "qwen-3-235b-a22b-instruct-2507",
      }),
      routeCtx,
    );
    expect(response.status).toBe(200);

    const events = await collectSse(response);
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(["trace", "token", "first-audio", "audio", "done"]),
    );
    const done = events.find((event) => event.event === "done")?.data as {
      totalTokens?: number;
      audioSamples?: number;
      durationMs?: number;
      firstAudioMs?: number;
      totalMs?: number;
      estimatedCostUsd?: number;
    };
    expect(done).toMatchObject({
      totalTokens: 120,
      audioSamples: 4,
      durationMs: 0,
    });
    expect(done.estimatedCostUsd).toBeGreaterThan(0);
    expect(done.firstAudioMs).toBeGreaterThanOrEqual(0);
    expect(done.totalMs).toBeGreaterThanOrEqual(done.firstAudioMs ?? 0);

    expect(curate).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "char_1",
        query: "Are you there?",
        scene: { activeEntities: ["lot"], location: "canaan" },
        semanticSeeds: [],
        tokenBudget: 2500,
      }),
    );
    expect(buildVoicePromptPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        curatedContext: expect.objectContaining({
          promptChunk: expect.stringContaining("Lot separated from Abraham"),
          pages: expect.arrayContaining([
            expect.objectContaining({
              page: expect.objectContaining({ slug: "lot" }),
            }),
            expect.objectContaining({
              page: expect.objectContaining({ slug: "abraham-voice-identity" }),
            }),
          ]),
          tokensUsed: 384,
          tokensBudget: 2500,
        }),
      }),
      expect.any(Object),
    );
    expect(recordContextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        turnId: "turn_1",
        mode: "voice",
        promptKind: "voice",
        systemPrompt: "You are Abraham.",
        selectedPages: expect.arrayContaining([
          expect.objectContaining({
            page: expect.objectContaining({ slug: "lot" }),
          }),
          expect.objectContaining({
            page: expect.objectContaining({ slug: "abraham-voice-identity" }),
          }),
        ]),
        promptChunk: expect.stringContaining("## Relevant knowledge"),
        metadata: expect.objectContaining({
          pageSlugs: ["lot", "abraham-voice-identity"],
        }),
      }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        turnId: "turn_1",
        type: "voice_stream.done",
        payload: expect.objectContaining({
          inputTokens: 100,
          outputTokens: 20,
          audioSamples: 4,
          estimatedCostUsd: expect.any(Number),
        }),
      }),
    );
    expect(upsertTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "turn_1",
        sessionId: "session_1",
        inputMode: "voice",
        userText: "Are you there?",
        assistantText: "Testing voice pipeline.",
        status: "completed",
        tokenUsage: expect.objectContaining({
          input: 100,
          output: 20,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          estimatedCostUsd: expect.any(Number),
        }),
        audioMetrics: expect.objectContaining({
          audioSamples: 4,
          sampleRate: 24_000,
        }),
        latencySummary: expect.objectContaining({
          firstAudioMs: expect.any(Number),
          totalMs: expect.any(Number),
        }),
        metadata: expect.objectContaining({
          cost: expect.objectContaining({
            estimatedCostUsd: expect.any(Number),
          }),
          ttsProvider: "pocket_tts",
        }),
      }),
    );
  });

  it("uses warmed sandbox voice context on the realtime path", async () => {
    storeSandboxVoiceContextCache({
      characterId: "char_1",
      sessionId: "session_1",
      scene: undefined,
      tokenBudget: 2500,
      result: {
        promptChunk: "Cached voice identity and Lot context.",
        pages: [
          {
            page: { slug: "lot", title: "Lot", type: "entity" } as never,
            rendering: "summary",
            score: 900,
            origin: "cache",
            trail: ["lot"],
            tokens: 64,
          },
        ],
        trace: {
          totalPages: 1,
          seeds: [{ slug: "lot", reason: "query-title", score: 900 }],
          edges: [],
          timelineFiltered: [],
          scoreDropped: [],
          budgetDropped: [],
        },
        tokensUsed: 64,
        tokensBudget: 2500,
        elapsedMs: 1,
      },
    });
    curate.mockClear();
    buildVoicePromptPlan.mockClear();

    const response = await POST(
      request({
        sessionId: "session_1",
        turnId: "turn_cached",
        message: "Tell me more about Lot.",
        history: [],
        scene: { activeEntities: ["abraham"], location: "character sandbox" },
        model: "qwen-3-235b-a22b-instruct-2507",
      }),
      routeCtx,
    );
    expect(response.status).toBe(200);

    const events = await collectSse(response);
    expect(events.filter((event) => event.event === "token").map((event) => (event.data as { delta: string }).delta)).toEqual([
      "Yes, I remember Lot. ",
      "Testing voice pipeline.",
    ]);
    const trace = events.find((event) => event.event === "trace")?.data as {
      events?: Array<{ name?: string; meta?: Record<string, unknown> }>;
    };
    expect(trace.events?.some((event) => event.name === "server.context.cache.hit")).toBe(true);
    expect(trace.events?.some((event) => event.name === "server.ack.selected")).toBe(true);
    expect(ttsTexts[0]).toBe("Yes, I remember Lot.");
    const done = events.find((event) => event.event === "done")?.data as {
      ackText?: string | null;
      ackDelivered?: boolean;
      ackFirstAudioMs?: number | null;
      brainFirstTokenMs?: number | null;
      serverTrace?: { events?: Array<{ name?: string }> };
    };
    expect(done).toMatchObject({
      ackText: "Yes, I remember Lot.",
      ackDelivered: true,
      ackFirstAudioMs: expect.any(Number),
      brainFirstTokenMs: expect.any(Number),
    });
    expect(done.serverTrace?.events?.some((event) => event.name === "server.ack.tts.first-audio")).toBe(true);
    expect(buildVoicePromptPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        curatedContext: expect.objectContaining({
          promptChunk: expect.stringContaining("Cached voice identity and Lot context"),
          tokensUsed: 64,
          tokensBudget: 2500,
        }),
      }),
      expect.any(Object),
    );
    expect(recordContextBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn_cached",
        metadata: expect.objectContaining({
          contextCacheHit: true,
          realtimeLane: true,
          ackText: "Yes, I remember Lot.",
        }),
      }),
    );
    expect(upsertTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantText: "Yes, I remember Lot. Testing voice pipeline.",
        metadata: expect.objectContaining({
          ackText: "Yes, I remember Lot.",
          ackDelivered: true,
        }),
      }),
    );
  });

  it("prefers the character's bound voice provider over a static Pocket voice override", async () => {
    characterVoiceId.current = "voice_eleven";

    const response = await POST(
      request({
        sessionId: "session_1",
        turnId: "turn_bound_voice",
        message: "Answer in one sentence.",
        history: [],
        scene: { activeEntities: ["abraham"], location: "character sandbox" },
        model: "qwen-3-235b-a22b-instruct-2507",
        voice: "abraham",
        ackMode: "off",
      }),
      routeCtx,
    );
    expect(response.status).toBe(200);

    const events = await collectSse(response);
    const done = events.find((event) => event.event === "done")?.data as {
      serverTrace?: {
        events?: Array<{ name?: string; meta?: Record<string, unknown> }>;
      };
    };
    expect(done.serverTrace?.events?.some((event) =>
      event.name === "server.tts.chunk.dispatched" &&
      event.meta?.kind === "main",
    )).toBe(true);
    expect(done.serverTrace?.events?.some((event) =>
      event.name === "server.tts.fetch.opened" &&
      event.meta?.provider === "elevenlabs",
    )).toBe(true);
    expect(upsertTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ttsProvider: "elevenlabs",
          ttsVoice: "liam",
        }),
      }),
    );
  });

  it("does not run the acknowledgement lane when disabled by request", async () => {
    seedLotContextCache();

    const response = await POST(
      request({
        sessionId: "session_1",
        turnId: "turn_ack_off",
        message: "Tell me more about Lot.",
        history: [],
        scene: { activeEntities: ["abraham"], location: "character sandbox" },
        model: "qwen-3-235b-a22b-instruct-2507",
        ackMode: "off",
      }),
      routeCtx,
    );
    expect(response.status).toBe(200);

    const events = await collectSse(response);
    expect(events.filter((event) => event.event === "token").map((event) => (event.data as { delta: string }).delta)).toEqual([
      "Testing voice pipeline.",
    ]);
    const done = events.find((event) => event.event === "done")?.data as {
      ackText?: string | null;
      ackDelivered?: boolean;
      serverTrace?: { events?: Array<{ name?: string }> };
    };
    expect(done.ackText).toBeNull();
    expect(done.ackDelivered).toBe(false);
    expect(done.serverTrace?.events?.some((event) => event.name === "server.ack.selected")).toBe(false);
    expect(ttsTexts[0]).toBe("Testing voice pipeline.");
    expect(upsertTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantText: "Testing voice pipeline.",
        metadata: expect.objectContaining({
          ackText: null,
          ackDelivered: false,
        }),
      }),
    );
  });

  it("uses prepared acknowledgement audio when it is cached", async () => {
    seedLotContextCache();
    const contextCacheKey = sandboxVoiceContextCacheKeyForDebug({
      characterId: "char_1",
      sessionId: "session_1",
      scene: undefined,
      tokenBudget: 2500,
    });
    storeCachedVoiceAckAudio({
      key: voiceAckAudioCacheKey({
        contextCacheKey,
        ttsProvider: "pocket_tts",
        ttsVoice: "abraham",
        ackText: "Yes, I remember Lot.",
      }),
      ackText: "Yes, I remember Lot.",
      frames: [
        {
          pcmFloat32Base64: Buffer.from(new Float32Array([0, 0.1, -0.1, 0]).buffer).toString("base64"),
          samples: 4,
          sampleRate: 24_000,
        },
      ],
    });

    const response = await POST(
      request({
        sessionId: "session_1",
        turnId: "turn_ack_cached",
        message: "Tell me more about Lot.",
        history: [],
        scene: { activeEntities: ["abraham"], location: "character sandbox" },
        model: "qwen-3-235b-a22b-instruct-2507",
      }),
      routeCtx,
    );
    expect(response.status).toBe(200);

    const events = await collectSse(response);
    expect(events.filter((event) => event.event === "token").map((event) => (event.data as { delta: string }).delta)).toEqual([
      "Yes, I remember Lot. ",
      "Testing voice pipeline.",
    ]);
    expect(ttsTexts).toEqual(["Testing voice pipeline."]);
    const done = events.find((event) => event.event === "done")?.data as {
      ackAudioCacheHit?: boolean;
      audioSamples?: number;
      serverTrace?: { events?: Array<{ name?: string }> };
    };
    expect(done.ackAudioCacheHit).toBe(true);
    expect(done.audioSamples).toBe(8);
    expect(done.serverTrace?.events?.some((event) => event.name === "server.ack.audio_cache.hit")).toBe(true);
    expect(done.serverTrace?.events?.some((event) => event.name === "server.ack.audio_cache.dispatched")).toBe(true);
    expect(upsertTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantText: "Yes, I remember Lot. Testing voice pipeline.",
        metadata: expect.objectContaining({
          ackAudioCacheHit: true,
        }),
      }),
    );
  });

  it("continues the main stream when acknowledgement TTS fails", async () => {
    seedLotContextCache();
    failAckTts.current = true;

    const response = await POST(
      request({
        sessionId: "session_1",
        turnId: "turn_ack_fail",
        message: "Tell me more about Lot.",
        history: [],
        scene: { activeEntities: ["abraham"], location: "character sandbox" },
        model: "qwen-3-235b-a22b-instruct-2507",
      }),
      routeCtx,
    );
    expect(response.status).toBe(200);

    const events = await collectSse(response);
    expect(events.filter((event) => event.event === "token").map((event) => (event.data as { delta: string }).delta)).toEqual([
      "Testing voice pipeline.",
    ]);
    expect(ttsTexts).toEqual(["Yes, I remember Lot.", "Testing voice pipeline."]);
    const done = events.find((event) => event.event === "done")?.data as {
      ackText?: string | null;
      ackDelivered?: boolean;
      ackFirstAudioMs?: number | null;
      serverTrace?: { events?: Array<{ name?: string }> };
    };
    expect(done.ackText).toBe("Yes, I remember Lot.");
    expect(done.ackDelivered).toBe(false);
    expect(done.ackFirstAudioMs).toBeNull();
    expect(done.serverTrace?.events?.some((event) => event.name === "server.ack.tts.failed")).toBe(true);
    expect(upsertTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantText: "Testing voice pipeline.",
        status: "completed",
        metadata: expect.objectContaining({
          ackText: "Yes, I remember Lot.",
          ackDelivered: false,
        }),
      }),
    );
  });
});

async function collectSse(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? "";
      const dataRaw = frame.match(/^data: (.+)$/m)?.[1] ?? "{}";
      return { event, data: JSON.parse(dataRaw) as unknown };
    });
}
