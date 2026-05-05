/**
 * Single source of truth for voice-agent pipeline labels surfaced in the UI.
 *
 * The actual runtime is on the audio-rt service (Railway), but the labels
 * here are what users / debug overlays see. Keep these in sync with what
 * gateway.py is actually loading — change BOTH when swapping engines so
 * stale labels never make it to the panel.
 *
 * Re-exposed via /api/audio/config so any UI can fetch it dynamically
 * rather than importing this constant directly.
 */
export const VOICE_PIPELINE_CONFIG = {
  stt: {
    /** Short label for inline subtitles. */
    label: "Whisper streaming",
    /** Full description for tooltips / debug panels. */
    full: "Whisper base.en + Silero VAD (Railway audio-rt)",
    /** One-word brand for terse spots. */
    short: "Whisper",
  },
  tts: {
    label: "Pocket TTS",
    full: "Pocket TTS · english_2026-01 (Railway audio-rt)",
    short: "Pocket TTS",
  },
} as const;

export type VoicePipelineConfig = typeof VOICE_PIPELINE_CONFIG;
