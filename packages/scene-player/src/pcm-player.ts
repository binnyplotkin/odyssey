/**
 * Serial PCM playback for streamed voice audio.
 *
 * Each `enqueue()` decodes a base64 Float32 PCM frame into an AudioBuffer,
 * schedules it at the tail of the previous one, and tracks the running tail
 * offset so subsequent frames land back-to-back (gapless).
 *
 * Create one player per session; call `enqueue()` for each audio event and
 * `stop()` to abort playback (e.g. on session end / mic re-arm).
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];

  /**
   * Optionally share an existing AudioContext — e.g. one created and resumed
   * inside a user gesture — so entry cues and streamed voice use one output
   * path and the context is already unlocked when the first frame arrives.
   */
  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? null;
  }

  enqueue(pcmBase64: string, _samples: number, sampleRate: number) {
    const ctx = this.ensureContext();
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
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
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
    this.nextStart = 0;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = createAudioContext();
    }
    return this.ctx;
  }
}

export function createAudioContext(): AudioContext {
  return new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)();
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
