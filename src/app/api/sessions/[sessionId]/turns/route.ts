import { NextRequest, NextResponse } from "next/server";
import { processTurn } from "@/lib/simulation/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const accepts = request.headers.get("accept") ?? "";
  const streamRequested = accepts.includes("text/event-stream");

  try {
    const { sessionId } = await params;
    const body = await request.json();

    if (!streamRequested) {
      const result = await processTurn(sessionId, body);
      return NextResponse.json(result);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: "delta" | "done" | "error", payload: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        };

        const close = () => {
          controller.close();
        };

        void (async () => {
          try {
            const result = await processTurn(sessionId, body, {
              onTextDelta: (delta) => {
                if (!delta) {
                  return;
                }

                send("delta", { text: delta });
              },
            });

            send("done", result);
          } catch (error) {
            send("error", {
              error: error instanceof Error ? error.message : "Failed to process turn.",
            });
          } finally {
            close();
          }
        })();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process turn." },
      { status: 500 },
    );
  }
}
