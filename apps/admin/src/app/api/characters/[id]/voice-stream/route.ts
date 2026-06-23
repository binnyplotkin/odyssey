import { NextRequest } from "next/server";
import {
  runVoiceStream,
  VoiceStreamHttpError,
  type VoiceStreamBody,
  type VoiceStreamEvent,
} from "@odyssey/voice-pipeline";

// The voice-turn pipeline (retrieval → curator → LLM → TTS) now lives in
// @odyssey/voice-pipeline as the transport-agnostic `runVoiceStream` generator
// so the warm voice-host can run byte-identical logic. This route is just the
// Vercel/SSE transport adapter over it. Flip to the host by pointing the client
// at NEXT_PUBLIC_VOICE_HOST_URL — this route stays as the instant fallback.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: VoiceStreamBody;
  try {
    body = (await req.json()) as VoiceStreamBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const encoder = new TextEncoder();
  const iterator = runVoiceStream(
    { ...body, characterId: id },
    { signal: req.signal },
  )[Symbol.asyncIterator]();

  // Pull the first frame eagerly. A pre-stream validation failure throws a
  // VoiceStreamHttpError before any frame is produced — surface it as a clean
  // 4xx/5xx JSON response (the route's historical contract) instead of a
  // half-open event-stream. Once we hold a frame we commit to SSE; mid-stream
  // failures are emitted by the pipeline itself as `error` frames (200).
  let first: IteratorResult<VoiceStreamEvent>;
  try {
    first = await iterator.next();
  } catch (err) {
    if (err instanceof VoiceStreamHttpError) {
      return jsonError(err.status, err.message);
    }
    return jsonError(500, err instanceof Error ? err.message : String(err));
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (ev: VoiceStreamEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`),
          );
        } catch {
          // controller may already be closed (client aborted) — swallow.
        }
      };
      try {
        if (!first.done) enqueue(first.value);
        for (let r = await iterator.next(); !r.done; r = await iterator.next()) {
          enqueue(r.value);
        }
      } catch (err) {
        // Defensive only: runVoiceStream catches its own mid-stream failures and
        // emits an `error` frame, so it should never throw past the first frame.
        enqueue({
          event: "error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
