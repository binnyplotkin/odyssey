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
export declare class PcmPlayer {
    private ctx;
    private nextStart;
    private sources;
    enqueue(pcmBase64: string, _samples: number, sampleRate: number): void;
    stop(): void;
    private ensureContext;
}
export declare function base64ToBytes(b64: string): Uint8Array;
//# sourceMappingURL=pcm-player.d.ts.map