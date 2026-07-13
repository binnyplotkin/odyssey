import { describe, expect, it } from "vitest";
import { VOICE_STREAM_SSE_EVENTS } from "./voice-stream-events";

describe("voice-stream SSE event contract", () => {
  it("keeps the browser-facing event names stable", () => {
    expect(VOICE_STREAM_SSE_EVENTS).toEqual([
      "trace",
      "token",
      "first-audio",
      "audio",
      "done",
      "error",
      // Turn-debugging: complete brain input (retrieval hits, system blocks,
      // messages), emitted only when the request sets debug: true.
      "debug",
    ]);
  });
});
