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
export declare class SceneAudioBus {
    private audioContext;
    private voiceGain;
    private nextVoiceStartTime;
    private scheduledVoiceSources;
    private currentAmbienceId;
    private ambienceEl;
    /**
     * Must be called from a user gesture (click, keypress) — browsers
     * disallow AudioContext creation otherwise. Idempotent.
     */
    start(): void;
    /**
     * Schedule a Float32 PCM frame on the voice track. Frames play in the
     * order they're submitted; back-to-back frames are seamless because we
     * track `nextVoiceStartTime` rather than starting at `currentTime`.
     */
    enqueueVoiceFrame(samples: Float32Array, sampleRate: number): void;
    /**
     * Hard stop of the voice track. Used for barge-in: the user is
     * speaking, so we kill in-flight playback immediately. Drops a 60ms
     * gain ramp so the cut isn't a click.
     */
    stopVoice(): void;
    /**
     * Returns a promise that resolves once every currently-scheduled voice
     * frame has finished playing. Used by the scene runner to know when a
     * speaker's turn is fully drained before advancing the loop.
     */
    voiceDrained(): Promise<void>;
    /**
     * Switch the ambience track. `null` = silence. Same id as current = no-op
     * (avoids restarting the loop on every orchestrator decision).
     */
    setAmbience(trackId: string | null): void;
    private fadeOutCurrentAmbience;
    private fadeInNewAmbience;
    /**
     * Decode the base64<Float32> wire format used by voice-stream and
     * /api/audio/speak into a Float32Array. Returns an empty array if the
     * input is malformed — caller decides whether to log or ignore.
     */
    static decodeFloat32Base64(base64: string): Float32Array;
}
//# sourceMappingURL=scene-audio-bus.d.ts.map