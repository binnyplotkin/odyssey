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

/**
 * Serial PCM frame player. The voice-stream route emits one `audio`
 * event per sentence — each frame is base64<Float32> @ 24kHz. We decode
 * into an AudioBuffer, schedule it at the tail of the previous one, and
 * track the running tail offset so subsequent frames land back-to-back.
 *
 * Create one player per session; call `enqueue()` for each audio event
 * and `stop()` to abort playback (e.g. on session end / mic re-arm).
 */
export class PcmPlayer {
  private static readonly RELEASE_TAIL_MS = 680;
  private ctx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];
  private queuedSourceCount = 0;
  private metricsRaf = 0;
  private releaseRaf = 0;
  private releaseStartedAt = 0;
  private freqBins: Uint8Array | null = null;
  private timeBins: Uint8Array | null = null;
  private lastLiveMetrics = {
    energy: 0,
    bass: 0,
    mid: 0,
    high: 0,
    peak: 0,
  };
  private releaseAnchorMetrics = {
    energy: 0,
    bass: 0,
    mid: 0,
    high: 0,
    peak: 0,
  };
  private callbacks: {
    onPlaybackStateChange?: (playing: boolean) => void;
    onAudioMetrics?: (audio: {
      energy: number;
      bass: number;
      mid: number;
      high: number;
      peak: number;
      active: boolean;
    }) => void;
  };

  constructor(callbacks?: {
    onPlaybackStateChange?: (playing: boolean) => void;
    onAudioMetrics?: (audio: {
      energy: number;
      bass: number;
      mid: number;
      high: number;
      peak: number;
      active: boolean;
    }) => void;
  }) {
    this.callbacks = callbacks ?? {};
  }

  setCallbacks(callbacks: {
    onPlaybackStateChange?: (playing: boolean) => void;
    onAudioMetrics?: (audio: {
      energy: number;
      bass: number;
      mid: number;
      high: number;
      peak: number;
      active: boolean;
    }) => void;
  }) {
    this.callbacks = callbacks;
  }

  async primeFromGesture(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // Browsers may reject resume() when this isn't called from a user
        // gesture. We keep going; a later gesture can retry.
      }
    }
  }

  enqueue(pcmBase64: string, _samples: number, sampleRate: number) {
    const ctx = this.ensureContext();
    const outputGain = this.ensureOutputGain();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    const bytes = base64ToBytes(pcmBase64);
    // Copy into a freshly-allocated ArrayBuffer so the Float32Array view is
    // typed against a concrete ArrayBuffer (Web Audio API rejects views over
    // SharedArrayBuffer-typed lib.dom in TS 5).
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    const f32 = new Float32Array(ab);
    const buffer = ctx.createBuffer(1, f32.length, sampleRate);
    buffer.copyToChannel(f32, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputGain);
    const startAt = Math.max(ctx.currentTime, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.queuedSourceCount += 1;
    if (this.queuedSourceCount === 1) {
      this.stopReleaseTail();
      this.callbacks.onPlaybackStateChange?.(true);
      this.startMetricsLoop();
    }
    source.onended = () => {
      this.sources = this.sources.filter((node) => node !== source);
      this.queuedSourceCount = Math.max(0, this.queuedSourceCount - 1);
      if (this.queuedSourceCount === 0) {
        this.stopMetricsLoop();
        this.startReleaseTail();
      }
    };
    this.sources.push(source);
  }

  stop() {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* already finished */
      }
    }
    this.sources = [];
    this.queuedSourceCount = 0;
    this.nextStart = 0;
    this.stopMetricsLoop();
    this.stopReleaseTail();
    this.lastLiveMetrics = { energy: 0, bass: 0, mid: 0, high: 0, peak: 0 };
    this.releaseAnchorMetrics = {
      energy: 0,
      bass: 0,
      mid: 0,
      high: 0,
      peak: 0,
    };
    this.emitInactiveMetrics();
    this.callbacks.onPlaybackStateChange?.(false);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx =
        new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
    }
    return this.ctx;
  }

  private ensureOutputGain(): GainNode {
    if (this.outputGain) return this.outputGain;
    const ctx = this.ensureContext();
    const gain = ctx.createGain();
    gain.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.24;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    this.outputGain = gain;
    this.analyser = analyser;
    this.freqBins = new Uint8Array(analyser.frequencyBinCount);
    this.timeBins = new Uint8Array(analyser.fftSize);
    return gain;
  }

  private startMetricsLoop() {
    if (this.metricsRaf !== 0) return;
    const tick = () => {
      this.metricsRaf = 0;
      if (this.queuedSourceCount <= 0) return;
      this.emitLiveMetrics();
      this.metricsRaf = window.requestAnimationFrame(tick);
    };
    this.metricsRaf = window.requestAnimationFrame(tick);
  }

  private stopMetricsLoop() {
    if (this.metricsRaf !== 0) {
      window.cancelAnimationFrame(this.metricsRaf);
      this.metricsRaf = 0;
    }
  }

  private startReleaseTail() {
    this.stopReleaseTail();
    this.releaseStartedAt = performance.now();
    const seed = {
      energy: Math.max(this.lastLiveMetrics.energy, this.releaseAnchorMetrics.energy),
      bass: Math.max(this.lastLiveMetrics.bass, this.releaseAnchorMetrics.bass),
      mid: Math.max(this.lastLiveMetrics.mid, this.releaseAnchorMetrics.mid),
      high: Math.max(this.lastLiveMetrics.high, this.releaseAnchorMetrics.high),
      peak: Math.max(this.lastLiveMetrics.peak, this.releaseAnchorMetrics.peak),
    };
    if (seed.energy <= 0.003 && seed.peak <= 0.003) {
      this.emitInactiveMetrics();
      this.callbacks.onPlaybackStateChange?.(false);
      return;
    }
    const tick = () => {
      this.releaseRaf = 0;
      if (this.queuedSourceCount > 0) return;
      const elapsed = performance.now() - this.releaseStartedAt;
      const progress = Math.max(
        0,
        Math.min(1, elapsed / PcmPlayer.RELEASE_TAIL_MS),
      );
      const fade = Math.pow(1 - progress, 1.65);
      this.callbacks.onAudioMetrics?.({
        energy: seed.energy * fade,
        bass: seed.bass * fade,
        mid: seed.mid * fade,
        high: seed.high * fade,
        peak: seed.peak * fade,
        active: true,
      });
      if (progress >= 1) {
        this.releaseAnchorMetrics = {
          energy: 0,
          bass: 0,
          mid: 0,
          high: 0,
          peak: 0,
        };
        this.emitInactiveMetrics();
        this.callbacks.onPlaybackStateChange?.(false);
        return;
      }
      this.releaseRaf = window.requestAnimationFrame(tick);
    };
    this.releaseRaf = window.requestAnimationFrame(tick);
  }

  private stopReleaseTail() {
    if (this.releaseRaf !== 0) {
      window.cancelAnimationFrame(this.releaseRaf);
      this.releaseRaf = 0;
    }
  }

  private emitInactiveMetrics() {
    this.callbacks.onAudioMetrics?.({
      energy: 0,
      bass: 0,
      mid: 0,
      high: 0,
      peak: 0,
      active: false,
    });
  }

  private emitLiveMetrics() {
    const analyser = this.analyser;
    const freq = this.freqBins;
    const time = this.timeBins;
    if (!analyser || !freq || !time) return;

    analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
    analyser.getByteTimeDomainData(time as Uint8Array<ArrayBuffer>);

    let rms = 0;
    for (let i = 0; i < time.length; i += 1) {
      const v = (time[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / time.length);

    const n = freq.length;
    const bEnd = Math.floor(n * 0.16);
    const mEnd = Math.floor(n * 0.56);
    let bass = 0;
    let mid = 0;
    let high = 0;
    for (let i = 0; i < n; i += 1) {
      const v = freq[i] / 255;
      if (i < bEnd) bass += v;
      else if (i < mEnd) mid += v;
      else high += v;
    }
    bass /= Math.max(1, bEnd);
    mid /= Math.max(1, mEnd - bEnd);
    high /= Math.max(1, n - mEnd);
    const spectral = (bass + mid + high) / 3;
    const energy = Math.max(0, Math.min(1, rms * 6.4 + spectral * 1.2));
    this.lastLiveMetrics.energy = energy;
    this.lastLiveMetrics.bass = bass;
    this.lastLiveMetrics.mid = mid;
    this.lastLiveMetrics.high = high;
    this.lastLiveMetrics.peak = Math.max(
      0,
      Math.min(1, energy * 0.85 + high * 0.25),
    );
    const anchorDecay = 0.955;
    this.releaseAnchorMetrics.energy = Math.max(
      energy,
      this.releaseAnchorMetrics.energy * anchorDecay,
    );
    this.releaseAnchorMetrics.bass = Math.max(
      bass,
      this.releaseAnchorMetrics.bass * anchorDecay,
    );
    this.releaseAnchorMetrics.mid = Math.max(
      mid,
      this.releaseAnchorMetrics.mid * anchorDecay,
    );
    this.releaseAnchorMetrics.high = Math.max(
      high,
      this.releaseAnchorMetrics.high * anchorDecay,
    );
    this.releaseAnchorMetrics.peak = Math.max(
      this.lastLiveMetrics.peak,
      this.releaseAnchorMetrics.peak * anchorDecay,
    );

    this.callbacks.onAudioMetrics?.({
      energy,
      bass,
      mid,
      high,
      peak: this.lastLiveMetrics.peak,
      active: true,
    });
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

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

export async function captureMic(): Promise<{
  recorder: MediaRecorder;
  stream: MediaStream;
  mimeType: string;
}> {
  const mimeType = pickMimeType();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
