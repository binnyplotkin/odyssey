/**
 * Session-entry cue — the "breath" earcon that confirms a session has
 * started while voice heatup (context cache warm, STT handshake) runs
 * behind it.
 *
 * Browser autoplay rules shape the API: `prefetchSessionEntryCue()` touches
 * no audio APIs (it only caches the encoded bytes), so it can run on
 * pre-session mount. `play()` resumes the supplied AudioContext, so it must
 * be called synchronously inside the start-button gesture — Safari only
 * honors `AudioContext.resume()` from a user gesture.
 */

const ENTRY_CUE_URL = "/session-entry-audio/odyssey_breath_full.m4a";
const FADE_IN_SECONDS = 0.18;
const FADE_OUT_SECONDS = 0.9;

let cueBytes: Promise<ArrayBuffer | null> | null = null;

function getCueBytes(): Promise<ArrayBuffer | null> {
  if (!cueBytes) {
    cueBytes = fetch(ENTRY_CUE_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`entry cue fetch: ${res.status}`);
        return res.arrayBuffer();
      })
      .catch((err) => {
        console.warn("[sandbox] entry cue prefetch failed", err);
        cueBytes = null;
        return null;
      });
  }
  return cueBytes;
}

/** Warm the byte cache so `play()` at session start decodes immediately. */
export function prefetchSessionEntryCue(): void {
  void getCueBytes();
}

/**
 * One cue per session start: `play()` once inside the start gesture, then
 * `fadeOut()` when the character's first audio arrives mid-cue, or `stop()`
 * on session teardown. Playback failures degrade silently — the cue must
 * never block a session from starting.
 */
export class SessionEntryCue {
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private bufferPromise: Promise<AudioBuffer | null> | null = null;
  private stopped = false;

  constructor(private readonly ctx: AudioContext) {}

  prepare(): Promise<AudioBuffer | null> {
    if (this.buffer) return Promise.resolve(this.buffer);
    if (!this.bufferPromise) {
      this.bufferPromise = getCueBytes()
        .then((bytes) =>
          // Decode a copy: decodeAudioData detaches its input buffer, and the
          // cached bytes are reused on the next session start.
          bytes ? this.ctx.decodeAudioData(bytes.slice(0)) : null,
        )
        .then((buffer) => {
          this.buffer = buffer;
          return buffer;
        });
    }
    return this.bufferPromise;
  }

  play(): void {
    if (this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
    void this.prepare()
      .then((buffer) => {
        if (!buffer || this.stopped || this.ctx.state === "closed") return;
        const gain = this.ctx.createGain();
        const now = this.ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + FADE_IN_SECONDS);
        gain.connect(this.ctx.destination);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.onended = () => {
          this.source = null;
          this.gain = null;
        };
        source.start(now);
        this.gain = gain;
        this.source = source;
      })
      .catch((err) => {
        console.warn("[sandbox] entry cue playback failed", err);
      });
  }

  /** Quick ramp-down for when the character starts speaking mid-cue. */
  fadeOut(): void {
    if (this.stopped) return;
    this.stopped = true;
    const { gain, source } = this;
    if (!gain || !source) return;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_SECONDS);
    try {
      source.stop(now + FADE_OUT_SECONDS);
    } catch {
      /* already stopped */
    }
  }

  stop(): void {
    this.stopped = true;
    try {
      this.source?.stop();
    } catch {
      /* already stopped */
    }
    this.source = null;
    this.gain = null;
  }
}
