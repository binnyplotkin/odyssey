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
import type { SceneAudioMetrics } from "./scene-audio-bus";

const RELEASE_TAIL_MS = 680;

type PcmPlayerCallbacks = {
  onPlaybackStateChange?: (playing: boolean) => void;
  onAudioMetrics?: (audio: SceneAudioMetrics) => void;
};

type MetricSnapshot = Omit<SceneAudioMetrics, "active">;

const EMPTY_METRICS: MetricSnapshot = {
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  peak: 0,
};

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private outputGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private nextStart = 0;
  private sources: AudioBufferSourceNode[] = [];
  private metricsRaf = 0;
  private releaseRaf = 0;
  private releaseStartedAt = 0;
  private frequencyBins: Uint8Array | null = null;
  private timeBins: Uint8Array | null = null;
  private callbacks: PcmPlayerCallbacks = {};
  private lastLiveMetrics: MetricSnapshot = { ...EMPTY_METRICS };
  private releaseAnchorMetrics: MetricSnapshot = { ...EMPTY_METRICS };

  /**
   * Optionally share an existing AudioContext — e.g. one created and resumed
   * inside a user gesture — so entry cues and streamed voice use one output
   * path and the context is already unlocked when the first frame arrives.
   */
  constructor(ctx?: AudioContext, callbacks: PcmPlayerCallbacks = {}) {
    this.ctx = ctx ?? null;
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: PcmPlayerCallbacks): void {
    this.callbacks = callbacks;
  }

  enqueue(pcmBase64: string, _samples: number, sampleRate: number) {
    const ctx = this.ensureContext();
    const outputGain = this.ensureOutputGain();
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
    if (this.sources.length === 0) {
      this.stopReleaseTail();
      this.callbacks.onPlaybackStateChange?.(true);
      this.startMetricsLoop();
    }
    source.onended = () => {
      this.sources = this.sources.filter((node) => node !== source);
      if (this.sources.length === 0) {
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
    this.nextStart = 0;
    this.stopMetricsLoop();
    this.stopReleaseTail();
    this.lastLiveMetrics = { ...EMPTY_METRICS };
    this.releaseAnchorMetrics = { ...EMPTY_METRICS };
    this.emitInactiveMetrics();
    this.callbacks.onPlaybackStateChange?.(false);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = createAudioContext();
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
    this.frequencyBins = new Uint8Array(analyser.frequencyBinCount);
    this.timeBins = new Uint8Array(analyser.fftSize);
    return gain;
  }

  private startMetricsLoop(): void {
    if (this.metricsRaf !== 0) return;
    const tick = () => {
      this.metricsRaf = 0;
      if (this.sources.length === 0) return;
      this.emitLiveMetrics();
      this.metricsRaf = window.requestAnimationFrame(tick);
    };
    this.metricsRaf = window.requestAnimationFrame(tick);
  }

  private stopMetricsLoop(): void {
    if (this.metricsRaf !== 0) {
      window.cancelAnimationFrame(this.metricsRaf);
      this.metricsRaf = 0;
    }
  }

  private startReleaseTail(): void {
    this.stopReleaseTail();
    const seed = {
      energy: Math.max(this.lastLiveMetrics.energy, this.releaseAnchorMetrics.energy),
      bass: Math.max(this.lastLiveMetrics.bass, this.releaseAnchorMetrics.bass),
      mid: Math.max(this.lastLiveMetrics.mid, this.releaseAnchorMetrics.mid),
      high: Math.max(this.lastLiveMetrics.high, this.releaseAnchorMetrics.high),
      peak: Math.max(this.lastLiveMetrics.peak, this.releaseAnchorMetrics.peak),
    };
    if (seed.energy <= 0.003 && seed.peak <= 0.003) {
      this.releaseAnchorMetrics = { ...EMPTY_METRICS };
      this.emitInactiveMetrics();
      this.callbacks.onPlaybackStateChange?.(false);
      return;
    }

    this.releaseStartedAt = performance.now();
    const tick = () => {
      this.releaseRaf = 0;
      if (this.sources.length > 0) return;
      const elapsed = performance.now() - this.releaseStartedAt;
      const progress = Math.max(0, Math.min(1, elapsed / RELEASE_TAIL_MS));
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
        this.releaseAnchorMetrics = { ...EMPTY_METRICS };
        this.emitInactiveMetrics();
        this.callbacks.onPlaybackStateChange?.(false);
        return;
      }
      this.releaseRaf = window.requestAnimationFrame(tick);
    };
    this.releaseRaf = window.requestAnimationFrame(tick);
  }

  private stopReleaseTail(): void {
    if (this.releaseRaf !== 0) {
      window.cancelAnimationFrame(this.releaseRaf);
      this.releaseRaf = 0;
    }
  }

  private emitInactiveMetrics(): void {
    this.callbacks.onAudioMetrics?.({
      ...EMPTY_METRICS,
      active: false,
    });
  }

  private emitLiveMetrics(): void {
    const analyser = this.analyser;
    const frequencyBins = this.frequencyBins;
    const timeBins = this.timeBins;
    if (!analyser || !frequencyBins || !timeBins) return;

    analyser.getByteFrequencyData(frequencyBins as Uint8Array<ArrayBuffer>);
    analyser.getByteTimeDomainData(timeBins as Uint8Array<ArrayBuffer>);

    let rms = 0;
    for (let i = 0; i < timeBins.length; i += 1) {
      const v = (timeBins[i] - 128) / 128;
      rms += v * v;
    }
    rms = Math.sqrt(rms / timeBins.length);

    const n = frequencyBins.length;
    const bEnd = Math.floor(n * 0.16);
    const mEnd = Math.floor(n * 0.56);
    let bass = 0;
    let mid = 0;
    let high = 0;
    for (let i = 0; i < n; i += 1) {
      const v = frequencyBins[i] / 255;
      if (i < bEnd) bass += v;
      else if (i < mEnd) mid += v;
      else high += v;
    }
    bass /= Math.max(1, bEnd);
    mid /= Math.max(1, mEnd - bEnd);
    high /= Math.max(1, n - mEnd);

    const spectral = (bass + mid + high) / 3;
    const energy = Math.max(0, Math.min(1, rms * 6.4 + spectral * 1.2));
    const peak = Math.max(0, Math.min(1, energy * 0.85 + high * 0.25));
    this.lastLiveMetrics = { energy, bass, mid, high, peak };

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
      peak,
      this.releaseAnchorMetrics.peak * anchorDecay,
    );

    this.callbacks.onAudioMetrics?.({
      energy,
      bass,
      mid,
      high,
      peak,
      active: true,
    });
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
