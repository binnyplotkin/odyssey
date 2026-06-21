/**
 * Audio bus for multi-character scenes.
 *
 * Two output tracks (Phase 1):
 *   - voice: Web Audio scheduled Float32 PCM frames from voice-stream SSE.
 *     One frame queue, FIFO scheduling so chunks play in order without
 *     gaps. `stopVoice()` aborts the queue immediately for barge-in.
 *   - ambience: looping HTMLAudioElement at low fixed volume. Track ids
 *     resolve to `/ambience/<id>.mp3` — drop a file at that path to make
 *     a new ambience available.
 *
 * Phase 2 will add a third `sfx` track for one-shot effects layered on
 * top. The voice + ambience split is the minimum the orchestrator needs
 * to drive scene atmosphere.
 *
 * The bus is a class (not a hook) because it owns long-lived AudioContext
 * + HTMLAudioElement resources that shouldn't tear down on every render.
 * Wrap it in a useRef in the consumer.
 */

const AMBIENCE_VOLUME = 0.18;
const AMBIENCE_CROSSFADE_MS = 600;
const VOICE_RELEASE_TAIL_MS = 680;

export type SceneAudioMetrics = {
  energy: number;
  bass: number;
  mid: number;
  high: number;
  peak: number;
  active: boolean;
};

type SceneAudioBusCallbacks = {
  onVoiceAudio?: (audio: SceneAudioMetrics) => void;
};

type VoiceMetricSnapshot = Omit<SceneAudioMetrics, "active">;

const EMPTY_VOICE_METRICS: VoiceMetricSnapshot = {
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  peak: 0,
};

export class SceneAudioBus {
  private audioContext: AudioContext | null = null;
  private voiceGain: GainNode | null = null;
  private voiceAnalyser: AnalyserNode | null = null;
  private nextVoiceStartTime = 0;
  private scheduledVoiceSources: Set<AudioBufferSourceNode> = new Set();
  private currentAmbienceId: string | null = null;
  private ambienceEl: HTMLAudioElement | null = null;
  private callbacks: SceneAudioBusCallbacks = {};
  private metricsRaf = 0;
  private releaseRaf = 0;
  private releaseStartedAt = 0;
  private frequencyBins: Uint8Array | null = null;
  private timeBins: Uint8Array | null = null;
  private lastLiveMetrics: VoiceMetricSnapshot = { ...EMPTY_VOICE_METRICS };
  private releaseAnchorMetrics: VoiceMetricSnapshot = { ...EMPTY_VOICE_METRICS };

  constructor(callbacks: SceneAudioBusCallbacks = {}) {
    this.callbacks = callbacks;
  }

  setCallbacks(callbacks: SceneAudioBusCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Must be called from a user gesture (click, keypress) — browsers
   * disallow AudioContext creation otherwise. Idempotent.
   */
  start(): void {
    if (this.audioContext) return;
    this.audioContext = new AudioContext();
    this.voiceGain = this.audioContext.createGain();
    this.voiceAnalyser = this.audioContext.createAnalyser();
    this.voiceAnalyser.fftSize = 512;
    this.voiceAnalyser.smoothingTimeConstant = 0.24;
    this.frequencyBins = new Uint8Array(this.voiceAnalyser.frequencyBinCount);
    this.timeBins = new Uint8Array(this.voiceAnalyser.fftSize);
    this.voiceGain.gain.value = 1.0;
    this.voiceGain.connect(this.voiceAnalyser);
    this.voiceAnalyser.connect(this.audioContext.destination);
    this.nextVoiceStartTime = this.audioContext.currentTime;
  }

  /**
   * Schedule a Float32 PCM frame on the voice track. Frames play in the
   * order they're submitted; back-to-back frames are seamless because we
   * track `nextVoiceStartTime` rather than starting at `currentTime`.
   */
  enqueueVoiceFrame(samples: Float32Array, sampleRate: number): void {
    if (!this.audioContext || !this.voiceGain) return;
    if (samples.length === 0) return;

    const buffer = this.audioContext.createBuffer(1, samples.length, sampleRate);
    // The Web Audio typings ask for Float32Array<ArrayBuffer> (narrower than
    // generic Float32Array). Our samples come from base64-decode which is
    // always ArrayBuffer-backed, so the cast is purely TS-satisfying.
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceGain);

    const now = this.audioContext.currentTime;
    const startAt = Math.max(now, this.nextVoiceStartTime);
    source.start(startAt);
    this.nextVoiceStartTime = startAt + samples.length / sampleRate;

    if (this.scheduledVoiceSources.size === 0) {
      this.stopReleaseTail();
      this.startMetricsLoop();
    }
    this.scheduledVoiceSources.add(source);
    source.onended = () => {
      this.scheduledVoiceSources.delete(source);
      if (this.scheduledVoiceSources.size === 0) {
        this.stopMetricsLoop();
        this.startReleaseTail();
      }
    };
  }

  /**
   * Hard stop of the voice track. Used for barge-in: the user is
   * speaking, so we kill in-flight playback immediately. Drops a 60ms
   * gain ramp so the cut isn't a click.
   */
  stopVoice(): void {
    if (!this.audioContext || !this.voiceGain) return;
    const ctx = this.audioContext;
    const gain = this.voiceGain;
    try {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.06);
    } catch {
      /* ignore */
    }
    for (const source of this.scheduledVoiceSources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.scheduledVoiceSources.clear();
    this.stopMetricsLoop();
    this.stopReleaseTail();
    this.lastLiveMetrics = { ...EMPTY_VOICE_METRICS };
    this.releaseAnchorMetrics = { ...EMPTY_VOICE_METRICS };
    this.emitInactiveMetrics();
    // Restore gain after the ramp completes so future frames are audible.
    window.setTimeout(() => {
      try {
        gain.gain.setValueAtTime(1.0, ctx.currentTime);
      } catch {
        /* ignore */
      }
    }, 80);
    this.nextVoiceStartTime = ctx.currentTime;
  }

  /**
   * Returns a promise that resolves once every currently-scheduled voice
   * frame has finished playing. Used by the scene runner to know when a
   * speaker's turn is fully drained before advancing the loop.
   */
  voiceDrained(): Promise<void> {
    if (!this.audioContext) return Promise.resolve();
    const ctx = this.audioContext;
    const drainAt = this.nextVoiceStartTime;
    const waitMs = Math.max(0, (drainAt - ctx.currentTime) * 1000);
    return new Promise((resolve) => window.setTimeout(resolve, waitMs));
  }

  /**
   * Switch the ambience track. `null` = silence. Same id as current = no-op
   * (avoids restarting the loop on every orchestrator decision).
   */
  setAmbience(trackId: string | null): void {
    if (trackId === this.currentAmbienceId) return;
    this.currentAmbienceId = trackId;
    this.fadeOutCurrentAmbience();
    if (trackId) this.fadeInNewAmbience(trackId);
  }

  private fadeOutCurrentAmbience(): void {
    const el = this.ambienceEl;
    if (!el) return;
    const startVolume = el.volume;
    const steps = 20;
    const stepMs = AMBIENCE_CROSSFADE_MS / steps;
    let step = 0;
    const interval = window.setInterval(() => {
      step += 1;
      el.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        window.clearInterval(interval);
        el.pause();
        el.src = "";
        if (this.ambienceEl === el) this.ambienceEl = null;
      }
    }, stepMs);
  }

  private fadeInNewAmbience(trackId: string): void {
    const el = new Audio(`/ambience/${trackId}.mp3`);
    el.loop = true;
    el.volume = 0;
    this.ambienceEl = el;
    el.play().catch((err) => {
      // Autoplay may be blocked if start() wasn't called from a user
      // gesture. Surface but don't throw — the rest of the bus still works.
      console.warn("[scene-audio-bus] ambience play blocked", err);
    });
    const steps = 20;
    const stepMs = AMBIENCE_CROSSFADE_MS / steps;
    let step = 0;
    const interval = window.setInterval(() => {
      step += 1;
      el.volume = Math.min(AMBIENCE_VOLUME, AMBIENCE_VOLUME * (step / steps));
      if (step >= steps) window.clearInterval(interval);
    }, stepMs);
  }

  private startMetricsLoop(): void {
    if (this.metricsRaf !== 0) return;
    const tick = () => {
      this.metricsRaf = 0;
      if (this.scheduledVoiceSources.size === 0) return;
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
      this.releaseAnchorMetrics = { ...EMPTY_VOICE_METRICS };
      this.emitInactiveMetrics();
      return;
    }

    this.releaseStartedAt = performance.now();
    const tick = () => {
      this.releaseRaf = 0;
      if (this.scheduledVoiceSources.size > 0) return;

      const elapsed = performance.now() - this.releaseStartedAt;
      const progress = Math.max(0, Math.min(1, elapsed / VOICE_RELEASE_TAIL_MS));
      const fade = Math.pow(1 - progress, 1.65);
      this.callbacks.onVoiceAudio?.({
        energy: seed.energy * fade,
        bass: seed.bass * fade,
        mid: seed.mid * fade,
        high: seed.high * fade,
        peak: seed.peak * fade,
        active: true,
      });

      if (progress >= 1) {
        this.releaseAnchorMetrics = { ...EMPTY_VOICE_METRICS };
        this.emitInactiveMetrics();
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
    this.callbacks.onVoiceAudio?.({
      ...EMPTY_VOICE_METRICS,
      active: false,
    });
  }

  private emitLiveMetrics(): void {
    const analyser = this.voiceAnalyser;
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

    this.callbacks.onVoiceAudio?.({
      energy,
      bass,
      mid,
      high,
      peak,
      active: true,
    });
  }

  /**
   * Decode the base64<Float32> wire format used by voice-stream and
   * /api/audio/speak into a Float32Array. Returns an empty array if the
   * input is malformed — caller decides whether to log or ignore.
   */
  static decodeFloat32Base64(base64: string): Float32Array {
    try {
      const binary = atob(base64);
      const buffer = new ArrayBuffer(binary.length);
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Float32Array(buffer);
    } catch {
      return new Float32Array(0);
    }
  }
}
