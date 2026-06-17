/**
 * Sandbox stream helpers — thin SSE consumers around the existing
 * `/api/characters/:id/chat` and `/api/characters/:id/voice-stream`
 * routes. Both routes return a single ReadableStream of `event: <name>\n
 * data: <json>\n\n` frames; these helpers parse the frames and dispatch
 * per-event callbacks so the sandbox UI can update incrementally without
 * re-reading the parsing boilerplate.
 *
 * Audio playback for voice is owned by `playPcmFrame()` — frames arrive
 * as base64-encoded Float32 @ 24kHz from the voice-stream route, get
 * decoded into an AudioBuffer, and queued in a simple serial chain so
 * sentences land in order.
 */

export type ChatHistoryTurn = { role: "user" | "assistant"; content: string };

export type ChatStreamCallbacks = {
  onCurator?: (curator: {
    trace?: unknown;
    pages: Array<{ slug: string; title: string }>;
    pageSlugs?: string[];
    tokensUsed: number;
    tokensBudget: number;
    elapsedMs: number;
    timingTrace?: unknown;
    systemPrompt?: string;
    routingMode?: string;
    promptKind?: string;
  }) => void;
  onToken?: (delta: string) => void;
  onDone?: (totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
    estimatedCostUsd?: number;
  }) => void;
  onError?: (message: string) => void;
};

export type StreamChatOptions = {
  characterId: string;
  sessionId?: string | null;
  turnId?: string;
  message: string;
  history: ChatHistoryTurn[];
  scene?: { activeEntities?: string[]; location?: string };
  model?: string;
  signal?: AbortSignal;
  callbacks: ChatStreamCallbacks;
};

/**
 * POST /api/characters/:id/chat and dispatch parsed SSE events to the
 * caller. Returns when the stream completes (done or error frame).
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const res = await fetch(`/api/characters/${opts.characterId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: opts.sessionId ?? undefined,
      turnId: opts.turnId,
      message: opts.message,
      history: opts.history,
      scene: opts.scene,
      model: opts.model,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const detail = res.body ? await res.text() : `${res.status}`;
    opts.callbacks.onError?.(`chat: ${detail.slice(0, 200)}`);
    return;
  }
  await consumeSse(res.body, (event, payload) => {
    switch (event) {
      case "curator":
        opts.callbacks.onCurator?.(payload as Parameters<NonNullable<ChatStreamCallbacks["onCurator"]>>[0]);
        return;
      case "token":
        opts.callbacks.onToken?.((payload as { delta: string }).delta);
        return;
      case "done":
        opts.callbacks.onDone?.(
          payload as {
            inputTokens: number;
            outputTokens: number;
            totalTokens?: number;
            provider?: string;
            model?: string;
            estimatedCostUsd?: number;
          },
        );
        return;
      case "error":
        opts.callbacks.onError?.((payload as { message: string }).message);
        return;
    }
  });
}

/* ── Voice stream ─────────────────────────────────────────────── */

export type VoiceStreamCallbacks = {
  onTrace?: (trace: unknown) => void;
  onToken?: (delta: string) => void;
  onFirstAudio?: (latencyMs: number) => void;
  onAudio?: (pcmBase64: string, samples: number, sampleRate: number) => void;
  onDone?: (totals: unknown) => void;
  onError?: (message: string) => void;
};

export type StreamVoiceOptions = {
  characterId: string;
  sessionId?: string | null;
  turnId?: string;
  promptChunk?: string;
  message: string;
  history: ChatHistoryTurn[];
  scene?: { activeEntities?: string[]; location?: string };
  model?: string;
  ackMode?: "auto" | "off";
  signal?: AbortSignal;
  callbacks: VoiceStreamCallbacks;
};

export type WarmSandboxVoiceContextOptions = {
  characterId: string;
  sessionId?: string | null;
  scene?: { activeEntities?: string[]; location?: string };
  tokenBudget?: number;
  query?: string;
  signal?: AbortSignal;
};

export type WarmSandboxVoiceContextResult = {
  characterTitle: string;
  promptChunk: string;
  pageSlugs: string[];
  tokensUsed: number;
  tokensBudget: number;
  elapsedMs: number;
  cacheKey?: string;
  cacheWarmed?: boolean;
  cacheScope?: string;
};

export async function warmSandboxVoiceContext(
  opts: WarmSandboxVoiceContextOptions,
): Promise<WarmSandboxVoiceContextResult> {
  const res = await fetch(`/api/characters/${opts.characterId}/voice-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: opts.sessionId ?? undefined,
      scene: opts.scene,
      tokenBudget: opts.tokenBudget,
      query: opts.query,
    }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`voice-context: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as WarmSandboxVoiceContextResult;
}

export async function prepareSandboxVoiceTurn(opts: {
  characterId: string;
  sessionId?: string | null;
  turnId?: string | null;
  partialTranscript: string;
  scene?: { activeEntities?: string[]; location?: string };
  tokenBudget?: number;
  startedAtMs?: number;
  signal?: AbortSignal;
}): Promise<{ accepted: boolean; cacheKey?: string; reason?: string }> {
  const res = await fetch(
    `/api/characters/${opts.characterId}/voice-live/prepare`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: opts.sessionId ?? undefined,
        turnId: opts.turnId ?? undefined,
        partialTranscript: opts.partialTranscript,
        scene: opts.scene,
        tokenBudget: opts.tokenBudget,
        startedAtMs: opts.startedAtMs,
      }),
      signal: opts.signal,
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => `${res.status}`);
    throw new Error(`voice-live.prepare: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as { accepted: boolean; cacheKey?: string; reason?: string };
}

/**
 * POST /api/characters/:id/voice-stream and dispatch parsed SSE events.
 * The route merges LLM token deltas + Kyutai TTS audio frames into one
 * stream — both flow through here.
 */
export async function streamVoice(opts: StreamVoiceOptions): Promise<void> {
  const res = await fetch(
    `/api/characters/${opts.characterId}/voice-stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: opts.sessionId ?? undefined,
        turnId: opts.turnId,
        promptChunk: opts.promptChunk,
        message: opts.message,
        history: opts.history,
        scene: opts.scene,
        model: opts.model,
        ackMode: opts.ackMode,
      }),
      signal: opts.signal,
    },
  );
  if (!res.ok || !res.body) {
    const detail = res.body ? await res.text() : `${res.status}`;
    opts.callbacks.onError?.(`voice-stream: ${detail.slice(0, 200)}`);
    return;
  }
  await consumeSse(res.body, (event, payload) => {
    switch (event) {
      case "trace":
        opts.callbacks.onTrace?.(payload);
        return;
      case "token":
        opts.callbacks.onToken?.((payload as { delta: string }).delta);
        return;
      case "first-audio":
        opts.callbacks.onFirstAudio?.(
          (payload as { latencyMs: number }).latencyMs,
        );
        return;
      case "audio": {
        const a = payload as {
          pcm: string;
          samples: number;
          sampleRate: number;
        };
        opts.callbacks.onAudio?.(a.pcm, a.samples, a.sampleRate);
        return;
      }
      case "done":
        opts.callbacks.onDone?.(payload);
        return;
      case "error":
        opts.callbacks.onError?.((payload as { message: string }).message);
        return;
    }
  });
}

/* ── SSE frame parser ─────────────────────────────────────────── */

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  dispatch: (event: string, payload: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
      let payload: unknown;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue;
      }
      dispatch(eventName, payload);
    }
  }
}

/* ── STT (audio → transcript) ─────────────────────────────────── */

export type TranscribeResult = {
  transcript: string;
  provider: string;
  model: string;
  latencyMs: number;
};

export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
): Promise<TranscribeResult> {
  const res = await fetch("/api/audio/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64, mimeType }),
  });
  if (!res.ok) throw new Error(`transcribe: ${res.status}`);
  return (await res.json()) as TranscribeResult;
}

/* ── Audio playback ───────────────────────────────────────────── */

// PcmPlayer now lives in @odyssey/scene-player so both the character sandbox
// and the scenes player share one implementation. Re-exported here so existing
// `@/lib/sandbox-streams` importers keep working.
export { PcmPlayer, createAudioContext } from "@odyssey/scene-player";

/* ── Mic capture ──────────────────────────────────────────────── */

/**
 * Pick the first supported audio MIME type the browser advertises for
 * MediaRecorder. Opus-in-WebM is widely supported; mp4 is the Safari
 * fallback. Returns "" when MediaRecorder isn't available at all (SSR
 * or unsupported browser).
 */
export function pickMimeType(): string {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  return (
    candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? ""
  );
}

export async function captureMic(options?: { deviceId?: string }): Promise<{
  recorder: MediaRecorder;
  stream: MediaStream;
  mimeType: string;
}> {
  const mimeType = pickMimeType();
  const audio: MediaTrackConstraints | boolean = options?.deviceId
    ? { deviceId: { exact: options.deviceId } }
    : true;
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  return { recorder, stream, mimeType };
}

/** Read a Blob as base64 (without the data:..;base64, prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("expected string result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
