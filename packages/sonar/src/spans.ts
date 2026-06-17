/**
 * Span extraction for the voice-stream leg — normalizes the raw trace
 * marks the routes emit today into Sonar's canonical span names, so the
 * emitters can be renamed/migrated later without breaking comparability.
 *
 * The STT leg's spans and the headline `voice-to-voice` span are computed
 * in the runner (they need wall-clock origins the SSE trace doesn't carry);
 * this module covers everything derivable from the voice-stream frames +
 * serverTrace.
 */

import type {
  SonarSpanName,
  SonarTurnFlags,
  SonarTurnUsage,
  TimedSseFrame,
  TraceContract,
} from "./types";

type Marks = {
  at: (name: string) => number | null;
  has: (name: string) => boolean;
  diff: (a: string, b: string) => number | null;
};

function marksOf(trace: TraceContract | null): Marks {
  const events = trace?.events ?? [];
  const at = (name: string): number | null => {
    const ev = events.find((e) => e.name === name);
    return ev ? ev.elapsedMs : null;
  };
  return {
    at,
    has: (name) => at(name) !== null,
    diff: (a, b) => {
      const ta = at(a);
      const tb = at(b);
      return ta !== null && tb !== null ? round1(tb - ta) : null;
    },
  };
}

export function extractServerTrace(frames: TimedSseFrame[]): TraceContract | null {
  const done = frames.find((f) => f.event === "done");
  const fromDone = done?.data?.serverTrace as TraceContract | undefined;
  if (fromDone?.events) return fromDone;
  const traceFrame = frames.find((f) => f.event === "trace");
  const direct = traceFrame?.data as TraceContract | undefined;
  return direct?.events ? direct : null;
}

/**
 * Extract the voice-stream leg's spans (client-observed `vs.*` and
 * server-side `server.*` / `orchestrate.llm`). Headline `voice-to-voice`
 * and `stt.*` are added by the runner.
 */
export function extractVoiceStreamSpans(input: {
  frames: TimedSseFrame[];
  orchestrate?: { totalMs: number; trace: TraceContract | null } | null;
}): {
  spans: Partial<Record<SonarSpanName, number | null>>;
  flags: Omit<SonarTurnFlags, "sttEmpty" | "error"> & { error: string | null };
  usage: SonarTurnUsage;
  serverTrace: TraceContract | null;
} {
  const { frames } = input;
  const serverTrace = extractServerTrace(frames);
  const server = marksOf(serverTrace);
  const orchestrate = marksOf(input.orchestrate?.trace ?? null);

  const firstToken = frames.find((f) => f.event === "token")?.atMs ?? null;
  const firstAudio = frames.find((f) => f.event === "audio")?.atMs ?? null;
  const doneFrame = frames.find((f) => f.event === "done");
  const errorFrame = frames.find((f) => f.event === "error");
  const done = doneFrame?.data ?? {};

  const received = server.at("server.request.received");
  const sinceReceived = (mark: string): number | null => {
    const t = server.at(mark);
    return received !== null && t !== null ? round1(t - received) : null;
  };

  const spans: Partial<Record<SonarSpanName, number | null>> = {
    "vs.ttft": firstToken !== null ? round1(firstToken) : null,
    "vs.ttfa": firstAudio !== null ? round1(firstAudio) : null,
    "vs.total": doneFrame ? round1(doneFrame.atMs) : null,
    "orchestrate.total": input.orchestrate ? round1(input.orchestrate.totalMs) : null,
    "orchestrate.llm": orchestrate.diff("orchestrate.llm.start", "orchestrate.llm.done"),
    "server.retrieval": server.diff("server.retrieval.start", "server.retrieval.done"),
    "server.retrieval.embed": server.diff("server.retrieval.start", "server.retrieval.embedded"),
    "server.retrieval.search": server.diff("server.retrieval.embedded", "server.retrieval.done"),
    "server.curator": server.diff("server.curator.start", "server.curator.done"),
    "server.context": sinceReceived("server.context.attached"),
    "server.llm.ttft":
      sinceReceived("server.llm.first-token") ?? numberOrNull(done.brainFirstTokenMs),
    "server.llm.duration": server.diff("server.llm.first-token", "server.llm.done"),
    "server.tts.ttfa": server.diff("server.tts.chunk.dispatched", "server.tts.first-audio"),
    "server.ttfa.main": sinceReceived("server.tts.first-audio"),
    "server.total": sinceReceived("server.tts.done"),
  };

  const flags = {
    contextCacheHit: server.has("server.context.cache.hit"),
    retrievalSkipped: server.has("server.retrieval.skipped"),
    ackDelivered: Boolean(done.ackDelivered),
    ttsFallback: server.has("server.tts.fallback"),
    error: errorFrame ? String(errorFrame.data.message ?? "unknown error") : null,
  };

  const usage: SonarTurnUsage = {
    inputTokens: numberOrNull(done.inputTokens),
    outputTokens: numberOrNull(done.outputTokens),
    estimatedCostUsd: numberOrNull(done.estimatedCostUsd),
    provider: stringOrNull(done.provider),
    model: stringOrNull(done.model),
    ttsProvider: stringOrNull(done.ttsProvider),
    ttsVoice: stringOrNull(done.ttsVoice),
    // Filled by the runner once the reply text length is known.
    ttsChars: null,
    ttsCostUsd: null,
  };

  return { spans, flags, usage, serverTrace };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
