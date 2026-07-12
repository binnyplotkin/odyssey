/**
 * WorldAudioChannel — the scene's soundscape as a second published LiveKit
 * track ("world-audio") next to "agent-voice".
 *
 * Phase 2 scope: the looping ambience BED. The SceneDriver owns
 * `SceneState.ambience` (an audio_assets slug); this channel executes it —
 * fetch the canonical 48 kHz mono s16 WAV from the sound-processed bucket,
 * loop it, crossfade ~600 ms on bed changes, and duck under the agent's
 * voice. Sfx one-shots (decision.sfx) layer into this same track in
 * Phase 3.
 *
 * Server-side on purpose: state and execution live in one process (no
 * client cue protocol, no drift), every client is a dumb subscriber, and
 * Egress recordings capture the full soundscape. Rooms are single-user,
 * so the room's mix IS the listener's mix — per-session gain is just a
 * constructor knob.
 *
 * Timing comes from AudioSource backpressure: the pump renders small
 * frames and `captureFrame` awaits whenever the (short) queue is full, so
 * the loop self-paces to real time. A short queue keeps duck/crossfade
 * reaction snappy. When nothing is audible the pump parks on a wake
 * promise — an idle scene costs nothing.
 *
 * Audio failures NEVER throw into the scene loop: a missing or unready
 * asset logs a warning and the current bed keeps playing.
 */
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type Room,
} from "@livekit/rtc-node";
import { getAudioAssetStore } from "@odyssey/db";
import {
  SOUND_PROCESSED_BUCKET,
  getSupabaseStorageClient,
} from "@odyssey/voice-pipeline/supabase-storage";

const SAMPLE_RATE = 48_000; // canonical ingest rate (sound-processed bucket)
const FRAME_MS = 50;
const QUEUE_MS = 400; // short buffer → duck/crossfade audible within ~½s
const CROSSFADE_MS = 600; // matches the browser SceneAudioBus bed crossfade
const DUCK_ATTACK_MS = 150;
const DUCK_RELEASE_MS = 400;

/* ── Pure helpers (exported for tests) ────────────────────────────── */

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Linear per-sample gain ramp toward a target. `next()` returns the
 * current gain and advances one sample. */
export class GainRamp {
  #current: number;
  #target: number;
  #step = 0;

  constructor(initial: number) {
    this.#current = initial;
    this.#target = initial;
  }

  setTarget(target: number, ms: number, sampleRate: number = SAMPLE_RATE): void {
    this.#target = target;
    const steps = Math.max(1, Math.round((ms / 1000) * sampleRate));
    this.#step = (target - this.#current) / steps;
  }

  next(): number {
    const value = this.#current;
    if (this.#step !== 0) {
      const nextValue = this.#current + this.#step;
      const arrived =
        this.#step > 0 ? nextValue >= this.#target : nextValue <= this.#target;
      this.#current = arrived ? this.#target : nextValue;
      if (arrived) this.#step = 0;
    }
    return value;
  }

  get value(): number {
    return this.#current;
  }

  get settled(): boolean {
    return this.#step === 0;
  }
}

/**
 * Minimal RIFF/WAVE reader for the canonical ingest output: PCM s16le
 * mono. Scans chunks (tolerates extra chunks before `data`); throws on
 * anything the ingest encoder wouldn't produce.
 */
export function parseWavPcm16Mono(bytes: Buffer): {
  samples: Int16Array;
  sampleRate: number;
} {
  if (
    bytes.length < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a RIFF/WAVE file");
  }

  let sampleRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (chunkId === "fmt ") {
      const audioFormat = bytes.readUInt16LE(body);
      const channels = bytes.readUInt16LE(body + 2);
      const bitsPerSample = bytes.readUInt16LE(body + 14);
      if (audioFormat !== 1) throw new Error(`unsupported WAV format ${audioFormat} (want PCM)`);
      if (channels !== 1) throw new Error(`unsupported channel count ${channels} (want mono)`);
      if (bitsPerSample !== 16) throw new Error(`unsupported bit depth ${bitsPerSample} (want 16)`);
      sampleRate = bytes.readUInt32LE(body + 4);
    } else if (chunkId === "data") {
      if (!sampleRate) throw new Error("WAV data chunk before fmt chunk");
      const end = Math.min(body + chunkSize, bytes.length);
      // Copy to a fresh buffer — Buffer pooling can hand back an unaligned
      // byteOffset, which would make the Int16Array view throw.
      const aligned = bytes.buffer.slice(bytes.byteOffset + body, bytes.byteOffset + end);
      return { samples: new Int16Array(aligned), sampleRate };
    }

    // Chunks are padded to even sizes.
    offset = body + chunkSize + (chunkSize % 2);
  }
  throw new Error("WAV has no data chunk");
}

/* ── Channel ──────────────────────────────────────────────────────── */

type BedSamples = { samples: Int16Array; slug: string };

/** A playing (or fading-out) bed. Position wraps — beds always loop. */
type Deck = {
  bed: BedSamples;
  position: number;
  ramp: GainRamp;
};

export type WorldAudioOptions = {
  /** Master gain applied to the whole world mix. Assets are already
   * RMS-normalized to −20 dBFS at ingest; −12 dB sits the bed well under
   * the voice. */
  masterGainDb?: number;
  /** Additional attenuation while the agent is speaking. */
  duckDb?: number;
};

export class WorldAudioChannel {
  readonly #room: Room;
  readonly #masterGain: number;
  readonly #duckGainLinear: number;

  #source: AudioSource | null = null;
  #track: LocalAudioTrack | null = null;
  #publishPromise: Promise<void> | null = null;

  #active: Deck | null = null;
  #retiring: Deck | null = null;
  #activeSlug: string | null = null;
  /** Latest requested slug — guards against a slow fetch applying a stale bed. */
  #requestedSlug: string | null = null;
  #duck = new GainRamp(1);

  // Promise-cache so concurrent requests for the same slug (prefetch +
  // initial setBed + the first onState all race at session start) share
  // one download instead of three.
  #cache = new Map<string, Promise<BedSamples | null>>();
  #pumpRunning = false;
  #closed = false;
  #wake: (() => void) | null = null;

  constructor(room: Room, opts: WorldAudioOptions = {}) {
    this.#room = room;
    this.#masterGain = dbToLinear(opts.masterGainDb ?? -12);
    this.#duckGainLinear = dbToLinear(opts.duckDb ?? -12);
  }

  /** Switch the ambience bed. `null` fades to silence. Same slug = no-op
   * (the orchestrator restates ambience on most decisions — don't churn). */
  async setBed(slug: string | null): Promise<void> {
    if (this.#closed) return;
    const next = slug?.trim() || null;
    if (next === this.#activeSlug) return;
    this.#requestedSlug = next;

    let bed: BedSamples | null = null;
    if (next) {
      bed = await this.#loadBed(next);
      if (!bed) return; // warned inside — keep the current bed playing
      if (this.#requestedSlug !== next) return; // superseded while fetching
      if (this.#activeSlug === next) return; // a concurrent call already applied it
    }

    // Retire the current deck (fade out); a still-fading previous retiree
    // is dropped — two simultaneous outgoing beds isn't worth the wiring.
    if (this.#active) {
      this.#active.ramp.setTarget(0, CROSSFADE_MS);
      this.#retiring = this.#active;
    }
    if (bed) {
      const ramp = new GainRamp(0);
      ramp.setTarget(1, CROSSFADE_MS);
      this.#active = { bed, position: 0, ramp };
    } else {
      this.#active = null;
    }
    this.#activeSlug = next;
    console.log(`[world-audio] bed → ${next ?? "silence"}`);

    if (this.#active || this.#retiring) {
      await this.#ensurePublished();
      this.#startPump();
    }
  }

  /** Fire-and-forget cache warm (scene load). */
  prefetch(slugs: Array<string | null | undefined>): void {
    for (const slug of slugs) {
      const s = slug?.trim();
      if (s) void this.#loadBed(s);
    }
  }

  /** Duck the world under the agent's voice. Fast attack, gentle release. */
  setDucked(ducked: boolean): void {
    this.#duck.setTarget(
      ducked ? this.#duckGainLinear : 1,
      ducked ? DUCK_ATTACK_MS : DUCK_RELEASE_MS,
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#wake?.();
    try {
      this.#source?.clearQueue();
      await this.#source?.close();
      const sid = this.#track?.sid;
      if (sid) await this.#room.localParticipant?.unpublishTrack(sid);
    } catch (err) {
      console.warn(`[world-audio] close: ${(err as Error).message}`);
    }
  }

  /* ── Internals ──────────────────────────────────────────────── */

  #loadBed(slug: string): Promise<BedSamples | null> {
    const cached = this.#cache.get(slug);
    if (cached) return cached;
    const loading = this.#fetchBed(slug);
    this.#cache.set(slug, loading);
    // Failed loads are evicted so a later decision can retry (e.g. the
    // asset finishes processing mid-session).
    void loading.then((bed) => {
      if (!bed) this.#cache.delete(slug);
    });
    return loading;
  }

  async #fetchBed(slug: string): Promise<BedSamples | null> {
    try {
      const asset = await getAudioAssetStore().getBySlug(slug);
      if (!asset || asset.status !== "ready" || !asset.processedPath) {
        console.warn(
          `[world-audio] bed "${slug}" unavailable (${asset ? `status=${asset.status}` : "not in library"}) — keeping current bed`,
        );
        return null;
      }
      const { data, error } = await getSupabaseStorageClient()
        .storage.from(SOUND_PROCESSED_BUCKET)
        .download(asset.processedPath);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      const parsed = parseWavPcm16Mono(Buffer.from(await data.arrayBuffer()));
      if (parsed.sampleRate !== SAMPLE_RATE) {
        // The ingest pipeline only writes 48 kHz; anything else would play
        // pitch-shifted. Refuse rather than warble.
        console.warn(
          `[world-audio] bed "${slug}" is ${parsed.sampleRate} Hz (want ${SAMPLE_RATE}) — skipping`,
        );
        return null;
      }
      const bed: BedSamples = { samples: parsed.samples, slug };
      console.log(
        `[world-audio] loaded "${slug}" (${(parsed.samples.length / SAMPLE_RATE).toFixed(1)}s)`,
      );
      return bed;
    } catch (err) {
      console.warn(`[world-audio] failed to load bed "${slug}": ${(err as Error).message}`);
      return null;
    }
  }

  async #ensurePublished(): Promise<void> {
    if (this.#publishPromise) return this.#publishPromise;
    this.#publishPromise = (async () => {
      this.#source = new AudioSource(SAMPLE_RATE, 1, QUEUE_MS);
      this.#track = LocalAudioTrack.createAudioTrack("world-audio", this.#source);
      // Not a second "microphone" — clients attach audio tracks by KIND
      // (see admin livekit-voice-session), so the source hint is metadata.
      await this.#room.localParticipant?.publishTrack(
        this.#track,
        new TrackPublishOptions({ source: TrackSource.SOURCE_UNKNOWN }),
      );
      console.log("[world-audio] track published");
    })();
    return this.#publishPromise;
  }

  #startPump(): void {
    if (this.#pumpRunning) {
      this.#wake?.();
      return;
    }
    this.#pumpRunning = true;
    void this.#pump().catch((err) => {
      console.error(`[world-audio] pump died: ${(err as Error).message}`);
      this.#pumpRunning = false;
    });
  }

  async #pump(): Promise<void> {
    const frameSamples = Math.round((FRAME_MS / 1000) * SAMPLE_RATE);
    while (!this.#closed) {
      if (!this.#active && !this.#retiring) {
        // Idle: nothing audible. Park until the next setBed.
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
        this.#wake = null;
        continue;
      }
      const frame = this.#renderFrame(frameSamples);
      // Backpressure paces us to real time.
      await this.#source!.captureFrame(frame);
    }
    this.#pumpRunning = false;
  }

  #renderFrame(frameSamples: number): AudioFrame {
    const out = new Int16Array(frameSamples);
    const active = this.#active;
    const retiring = this.#retiring;

    for (let i = 0; i < frameSamples; i += 1) {
      let mix = 0;
      if (active) {
        mix += active.bed.samples[active.position]! * active.ramp.next();
        active.position = (active.position + 1) % active.bed.samples.length;
      }
      if (retiring) {
        mix += retiring.bed.samples[retiring.position]! * retiring.ramp.next();
        retiring.position = (retiring.position + 1) % retiring.bed.samples.length;
      }
      mix *= this.#duck.next() * this.#masterGain;
      out[i] = Math.max(-0x8000, Math.min(0x7fff, Math.round(mix)));
    }

    // Drop the retiring deck once its fade-out lands.
    if (retiring && retiring.ramp.settled && retiring.ramp.value === 0) {
      this.#retiring = null;
    }
    // Fully faded to silence with nothing incoming → let the pump idle
    // after this frame (checked at the top of the loop).
    if (!this.#active && !this.#retiring) {
      // no-op: loop condition handles it
    }
    return new AudioFrame(out, SAMPLE_RATE, 1, frameSamples);
  }
}
