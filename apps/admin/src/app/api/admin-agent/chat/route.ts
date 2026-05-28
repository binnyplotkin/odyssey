import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runAdminAgentTurn } from "@/lib/admin-agent/service";
import type { AdminAgentRouteContext, AdminAgentStreamEvent } from "@/lib/admin-agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  conversationId?: string;
  message?: string;
  routeContext?: AdminAgentRouteContext;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AdminAgentStreamEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        await runAdminAgentTurn({
          conversationId: body.conversationId,
          message,
          routeContext: body.routeContext,
          adminUser: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            role: session.user.role,
          },
          onEvent: send,
        });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
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
