export const VOICE_STREAM_SSE_EVENT_NAMES = {
  trace: "trace",
  token: "token",
  firstAudio: "first-audio",
  audio: "audio",
  done: "done",
  error: "error",
} as const;

export const VOICE_STREAM_SSE_EVENTS = Object.values(VOICE_STREAM_SSE_EVENT_NAMES);

export type VoiceStreamSseEventName =
  (typeof VOICE_STREAM_SSE_EVENT_NAMES)[keyof typeof VOICE_STREAM_SSE_EVENT_NAMES];
