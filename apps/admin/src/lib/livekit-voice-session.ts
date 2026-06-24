import type {
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  Room,
} from "livekit-client";
import { type SceneAudioMetrics, createAudioContext } from "@odyssey/scene-player";

// livekit-client touches browser globals, so it must never load during SSR of the
// (server-rendered) "use client" sandbox — even with the flag off. We type-only
// import above and dynamic-import the runtime module inside connect() (client-only).
type LiveKitModule = typeof import("livekit-client");

export type LiveKitVoiceState = "idle" | "listening" | "thinking" | "speaking";

export interface LiveKitVoiceTranscript {
  id: string;
  text: string;
  role: "user" | "agent";
  final: boolean;
}

export interface LiveKitVoiceCallbacks {
  onStateChange?: (state: LiveKitVoiceState) => void;
  onAudioMetrics?: (metrics: SceneAudioMetrics) => void;
  onTranscript?: (segment: LiveKitVoiceTranscript) => void;
  onError?: (message: string) => void;
}

export interface LiveKitVoiceConnectOptions {
  characterId: string;
  sessionId?: string;
  /** Reuse the sandbox's user-gesture AudioContext so playback is unlocked on Safari. */
  audioContext?: AudioContext;
}

/**
 * Drives a sandbox voice session over a LiveKit room instead of the audio-rt STT +
 * SSE `streamVoice` path. The browser publishes its mic; the voice-agent worker does
 * STT + turn detection + the knowledge-graph brain + TTS and publishes the
 * character's voice back. We attach that track for playback and tap an analyser to
 * feed the wavefield. State: listening (connected, your turn) ↔ speaking (agent
 * talking). The flag/seam lives in the sandbox; this class is transport only.
 */
export class LiveKitVoiceSession {
  readonly #callbacks: LiveKitVoiceCallbacks;
  #lk: LiveKitModule | null = null;
  #room: Room | null = null;
  #audioEl: HTMLAudioElement | null = null;
  #audioCtx: AudioContext | null = null;
  #ownsAudioCtx = false;
  #analyser: AnalyserNode | null = null;
  #source: MediaStreamAudioSourceNode | null = null;
  #raf: number | null = null;
  #state: LiveKitVoiceState = "idle";

  constructor(callbacks: LiveKitVoiceCallbacks = {}) {
    this.#callbacks = callbacks;
  }

  get state(): LiveKitVoiceState {
    return this.#state;
  }

  #setState(next: LiveKitVoiceState): void {
    if (next === this.#state) return;
    this.#state = next;
    this.#callbacks.onStateChange?.(next);
  }

  async connect(opts: LiveKitVoiceConnectOptions): Promise<void> {
    const res = await fetch("/api/voice/livekit-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: opts.characterId, sessionId: opts.sessionId }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`livekit-token ${res.status}: ${detail.slice(0, 200)}`);
    }
    const { url, token } = (await res.json()) as { url: string; token: string; room: string };

    if (opts.audioContext) {
      this.#audioCtx = opts.audioContext;
      this.#ownsAudioCtx = false;
    } else {
      this.#audioCtx = createAudioContext();
      this.#ownsAudioCtx = true;
    }

    const lk = await import("livekit-client");
    this.#lk = lk;
    const room = new lk.Room({ adaptiveStream: false, dynacast: false });
    this.#room = room;
    room
      .on(lk.RoomEvent.TrackSubscribed, (track, _pub, participant) =>
        this.#onTrack(track, participant),
      )
      .on(lk.RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === lk.Track.Kind.Audio) this.#teardownAnalyser();
      })
      .on(lk.RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const agentSpeaking = speakers.some(
          (participant) => participant.identity !== room.localParticipant.identity,
        );
        this.#setState(agentSpeaking ? "speaking" : "listening");
      })
      .on(lk.RoomEvent.Disconnected, () => this.#setState("idle"))
      .on(lk.RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        // The agent publishes grouped turn transcripts on this topic: the user's
        // FULL turn and the character's streaming reply text (not raw per-pause STT
        // segments). The sandbox upserts these by id.
        if (topic !== "odyssey.transcript") return;
        try {
          const message = JSON.parse(
            new TextDecoder().decode(payload),
          ) as LiveKitVoiceTranscript;
          this.#callbacks.onTranscript?.(message);
        } catch {
          // ignore malformed payloads
        }
      });

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    this.#setState("listening");

    // The agent may have joined and published before us — attach existing tracks.
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track && publication.track.kind === lk.Track.Kind.Audio) {
          this.#onTrack(publication.track, participant);
        }
      }
    }
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    await this.#room?.localParticipant.setMicrophoneEnabled(enabled);
  }

  async disconnect(): Promise<void> {
    this.#teardownAnalyser();
    if (this.#audioEl) {
      this.#audioEl.srcObject = null;
      this.#audioEl.remove();
      this.#audioEl = null;
    }
    if (this.#room) {
      await this.#room.disconnect().catch(() => undefined);
      this.#room = null;
    }
    if (this.#ownsAudioCtx && this.#audioCtx) {
      await this.#audioCtx.close().catch(() => undefined);
    }
    this.#audioCtx = null;
    this.#setState("idle");
  }

  #onTrack(track: RemoteTrack, _participant: RemoteParticipant): void {
    if (track.kind !== this.#lk?.Track.Kind.Audio) return;
    if (!this.#audioEl) {
      const el = document.createElement("audio");
      el.autoplay = true;
      el.setAttribute("playsinline", "true");
      this.#audioEl = el;
    }
    (track as RemoteAudioTrack).attach(this.#audioEl);
    this.#setupAnalyser(track.mediaStreamTrack);
  }

  #setupAnalyser(mediaStreamTrack: MediaStreamTrack): void {
    const ctx = this.#audioCtx;
    if (!ctx) return;
    this.#teardownAnalyser();
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    this.#source = source;
    this.#analyser = analyser;

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    const loop = (): void => {
      const active = this.#analyser;
      if (!active) return;
      active.getByteFrequencyData(freq);
      active.getByteTimeDomainData(time);
      this.#callbacks.onAudioMetrics?.(toMetrics(freq, time));
      this.#raf = requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  #teardownAnalyser(): void {
    if (this.#raf != null) {
      cancelAnimationFrame(this.#raf);
      this.#raf = null;
    }
    this.#source?.disconnect();
    this.#source = null;
    this.#analyser = null;
  }
}

/** Analyser bins → the wavefield's SceneAudioMetrics (energy/bass/mid/high/peak/active). */
function toMetrics(freq: Uint8Array, time: Uint8Array): SceneAudioMetrics {
  const n = freq.length;
  const bassEnd = Math.max(1, Math.floor(n * 0.1));
  const midEnd = Math.max(bassEnd + 1, Math.floor(n * 0.4));
  let bass = 0;
  let mid = 0;
  let high = 0;
  for (let i = 0; i < n; i++) {
    const v = (freq[i] ?? 0) / 255;
    if (i < bassEnd) bass += v;
    else if (i < midEnd) mid += v;
    else high += v;
  }
  bass /= bassEnd;
  mid /= midEnd - bassEnd;
  high /= Math.max(1, n - midEnd);

  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < time.length; i++) {
    const s = ((time[i] ?? 128) - 128) / 128;
    sumSq += s * s;
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, time.length));
  const energy = Math.min(1, rms * 2.4);
  return {
    energy,
    bass: Math.min(1, bass * 1.4),
    mid: Math.min(1, mid * 1.4),
    high: Math.min(1, high * 1.6),
    peak: Math.min(1, peak),
    active: energy > 0.01,
  };
}
