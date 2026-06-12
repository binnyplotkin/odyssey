import type { TimedSseFrame } from "./types";

/**
 * Consume an SSE response body, stamping each frame with its arrival time
 * relative to `t0` (the performance.now() taken when the POST was
 * dispatched). Arrival time — not the server's own elapsedMs — is what the
 * end-to-end spans are built from, so network and framing costs are
 * included honestly.
 */
export async function readTimedSseFrames(
  res: Response,
  t0: number,
  onFrame?: (frame: TimedSseFrame) => void,
): Promise<TimedSseFrame[]> {
  if (!res.body) throw new Error("SSE response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames: TimedSseFrame[] = [];
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const atMs = performance.now() - t0;
    buffer += decoder.decode(value, { stream: true });
    let frameEnd = buffer.indexOf("\n\n");
    while (frameEnd >= 0) {
      const raw = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const event = raw.match(/^event: (.+)$/m)?.[1];
      const dataRaw = raw.match(/^data: (.+)$/m)?.[1];
      if (event && dataRaw) {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataRaw) as Record<string, unknown>;
        } catch {
          data = { raw: dataRaw };
        }
        // All frames inside one network chunk share that chunk's arrival
        // time — we cannot observe finer granularity than the socket gives.
        const frame: TimedSseFrame = { event, data, atMs };
        frames.push(frame);
        onFrame?.(frame);
      }
      frameEnd = buffer.indexOf("\n\n");
    }
  }
  return frames;
}
