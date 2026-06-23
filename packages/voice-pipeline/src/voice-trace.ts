/**
 * Voice-pipeline telemetry primitive.
 *
 * A `Trace` is a per-session or per-turn timeline of named markers, each
 * recorded with a timestamp relative to the trace's start. Use `mark(name)`
 * at every interesting step (mic acquired, WS open, first token, …) and
 * `summary()` / `print()` to inspect the result.
 *
 * Three kinds of telemetry to keep separate:
 *   - SessionTrace: from "user lands on the voice page" to "voice servers
 *     ready" — fires once per session.
 *   - TurnTrace: from "user starts speaking" through "audio reply finished" —
 *     fires once per turn. The bulk of useful latency lives here.
 *   - ServerTrace: timings collected on the server during a `/voice-stream`
 *     turn. They arrive in the `done` SSE event and get merged into the
 *     turn trace so the console shows one unified timeline.
 *
 * This file is intentionally small and dependency-free so it can run in any
 * runtime (browser worklet, server route handler, etc).
 */

export type TraceEvent = {
  /** Short, structured name in dotted notation, e.g. `stt.ws.open`. */
  name: string;
  /** Milliseconds since the trace started. */
  t: number;
  /** Optional structured payload for extra context (sample rate, byte count…). */
  meta?: Record<string, unknown>;
};

export type TraceJson = {
  startedAt: number;
  events: TraceEvent[];
};

export type TraceContractEvent = {
  /** Short, structured name in dotted notation, e.g. `server.llm.first-token`. */
  name: string;
  /** Milliseconds since the trace started. */
  elapsedMs: number;
  /** Optional structured payload for extra context. */
  meta?: Record<string, unknown>;
};

export type TraceContract = {
  startedAt: string;
  elapsedMs: number;
  events: TraceContractEvent[];
};

export type TracePayload = TraceJson | TraceContract;

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

export class TraceEnvelope {
  readonly startedAt: string;
  private readonly perfOrigin: number;
  readonly events: TraceContractEvent[] = [];

  constructor(startedAt?: string) {
    this.startedAt = startedAt ?? new Date().toISOString();
    this.perfOrigin = now();
  }

  mark(name: string, meta?: Record<string, unknown>): void {
    const elapsedMs = Math.round((now() - this.perfOrigin) * 1000) / 1000;
    this.events.push({
      name,
      elapsedMs,
      ...(meta ? { meta } : {}),
    });
  }

  toJSON(): TraceContract {
    return {
      startedAt: this.startedAt,
      elapsedMs: Math.round((now() - this.perfOrigin) * 1000) / 1000,
      events: [...this.events],
    };
  }
}

export class Trace {
  /** Wall-clock origin of this trace (ms epoch). Useful for ordering across machines. */
  readonly startedAt: number;
  /** High-resolution origin used to compute relative `t` for each event. */
  private readonly perfOrigin: number;
  readonly events: TraceEvent[] = [];

  constructor(startedAt?: number) {
    this.startedAt = startedAt ?? Date.now();
    this.perfOrigin = now();
  }

  /** Record a named marker with optional metadata. Idempotent on (name, meta). */
  mark(name: string, meta?: Record<string, unknown>): void {
    const t = now() - this.perfOrigin;
    this.events.push({ name, t: Math.round(t * 1000) / 1000, meta });
  }

  /** Return the t-value of the first event matching `name`, or null if absent. */
  at(name: string): number | null {
    const ev = this.events.find((e) => e.name === name);
    return ev ? ev.t : null;
  }

  /** Time between two named markers, or null if either is absent. */
  diff(a: string, b: string): number | null {
    const ta = this.at(a);
    const tb = this.at(b);
    if (ta === null || tb === null) return null;
    return tb - ta;
  }

  /** Append events from another trace, with their `t` rebased onto an offset. */
  merge(other: TracePayload, offsetMs: number): void {
    for (const ev of other.events) {
      const t = "t" in ev ? ev.t : ev.elapsedMs;
      this.events.push({
        name: ev.name,
        t: t + offsetMs,
        ...(ev.meta ? { meta: ev.meta } : {}),
      });
    }
  }

  /** Sort events by time ascending. Useful before printing. */
  sort(): void {
    this.events.sort((a, b) => a.t - b.t);
  }

  /** JSON-serializable form, safe to ship over SSE. */
  toJSON(): TraceJson {
    return { startedAt: this.startedAt, events: [...this.events] };
  }

  /**
   * Pretty multi-line string for console output. Each row shows:
   *   <name> · <absolute ms> · <delta-from-prev ms>
   */
  print(label = "trace"): string {
    this.sort();
    const lines: string[] = [`[${label}]`];
    let prev = 0;
    let nameWidth = 0;
    for (const e of this.events) nameWidth = Math.max(nameWidth, e.name.length);
    for (const e of this.events) {
      const delta = Math.round(e.t - prev);
      const total = Math.round(e.t);
      const padded = e.name.padEnd(nameWidth + 2, " ");
      const meta = e.meta ? "  " + JSON.stringify(e.meta) : "";
      lines.push(`  ${padded}${total.toString().padStart(6)}ms  +${delta}ms${meta}`);
      prev = e.t;
    }
    return lines.join("\n");
  }

  /**
   * Compact summary object — handy for one-line logs and dashboards.
   * Returns the best-known intervals, with `null` for any missing pair.
   */
  summary(): Record<string, number | null> {
    const serverDiff = (a: string, b: string) =>
      this.diff(`server.${a}`, `server.${b}`) ?? this.diff(a, b);
    return {
      "stt.ws.handshake":     this.diff("stt.ws.opening", "stt.ws.open"),
      "stt.first-word":       this.diff("turn.user-start", "stt.word.first"),
      "vad.to-finalize":      this.diff("vad.threshold-crossed", "turn.finalized"),
      "voice-stream.ttft":    this.diff("voice-stream.posted", "sse.first-token"),
      "voice-stream.ttfa":    this.diff("voice-stream.posted", "sse.first-audio"),
      "audio.first-received": this.diff("sse.first-audio", "audio.first-frame-received"),
      "audio.first-played":   this.diff("sse.first-audio", "audio.first-played"),
      "audio.playback-drain": this.diff("sse.done", "audio.playback-drained"),
      "turn.to-sse-done":     this.diff("turn.user-start", "sse.done"),
      "turn.total":           this.diff("turn.user-start", "audio.playback-drained") ?? this.diff("turn.user-start", "sse.done"),
      // Server-side spans (only resolvable once a serverTrace has been merged).
      "tts.ws.handshake":     serverDiff("request.received", "tts.ws.open"),
      "llm.ttft":             serverDiff("request.received", "llm.first-token"),
      "llm.duration":         serverDiff("llm.first-token", "llm.done"),
      "tts.text-to-audio":    serverDiff("tts.first-text", "tts.first-audio"),
      "tts.duration":         serverDiff("tts.first-audio", "tts.ws.close"),
    };
  }
}
