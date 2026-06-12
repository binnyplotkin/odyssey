import { NextRequest, NextResponse } from "next/server";
import { getSceneSessionStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EventInput = {
  id?: string;
  turnId?: string | null;
  type?: string;
  source?: string;
  payload?: unknown;
  createdAt?: string;
};

type Body = EventInput | { events?: EventInput[] };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const events = Array.isArray((body as { events?: EventInput[] }).events)
    ? (body as { events: EventInput[] }).events
    : [body as EventInput];

  if (events.length === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }
  if (events.length > 250) {
    return NextResponse.json(
      { error: "At most 250 events can be appended in one request." },
      { status: 400 },
    );
  }

  try {
    const store = getSceneSessionStore();
    let count = 0;
    for (const event of events) {
      const type = event.type?.trim();
      const source = event.source?.trim();
      if (!type || !source) continue;
      await store.appendEvent({
        id: event.id,
        sessionId,
        turnId: event.turnId ?? null,
        type,
        source,
        payload: event.payload ?? {},
        createdAt: event.createdAt,
      });
      count += 1;
    }
    return NextResponse.json({ success: true, count });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
