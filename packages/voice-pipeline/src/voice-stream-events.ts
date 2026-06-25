export const VOICE_STREAM_SSE_EVENT_NAMES = {
  trace: "trace",
  token: "token",
  firstAudio: "first-audio",
  audio: "audio",
  done: "done",
  error: "error",
  // Opt-in (input.debug): the complete turn input the brain received — raw
  // retrieval hits with similarity scores + the exact system blocks + messages
  // array. Off the hot path; normal turns never emit it. Consumers that don't
  // know it simply ignore the event.
  debug: "debug",
} as const;

export const VOICE_STREAM_SSE_EVENTS = Object.values(VOICE_STREAM_SSE_EVENT_NAMES);

export type VoiceStreamSseEventName =
  (typeof VOICE_STREAM_SSE_EVENT_NAMES)[keyof typeof VOICE_STREAM_SSE_EVENT_NAMES];
