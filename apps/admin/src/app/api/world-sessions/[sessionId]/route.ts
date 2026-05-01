import { NextRequest, NextResponse } from "next/server";
import { getWorldSessionStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PatchBody = {
  status?: string;
  metadata?: Record<string, unknown>;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  const session = await getWorldSessionStore().getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "World session not found." }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    body = {};
  }

  try {
    await getWorldSessionStore().endSession(
      sessionId,
      body.status?.trim() || "ended",
      body.metadata ?? {},
    );
    await getWorldSessionStore().appendEvent({
      sessionId,
      type: "session.ended",
      source: "system",
      payload: { status: body.status?.trim() || "ended" },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
