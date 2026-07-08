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
    constructor() {
        this.ctx = null;
        this.nextStart = 0;
        this.sources = [];
    }
    enqueue(pcmBase64, _samples, sampleRate) {
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
            }
            catch (_a) {
                /* already finished */
            }
        }
        this.sources = [];
        this.nextStart = 0;
    }
    ensureContext() {
        if (!this.ctx) {
            this.ctx =
                new (window.AudioContext ||
                    window
                        .webkitAudioContext)();
        }
        return this.ctx;
    }
}
export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
