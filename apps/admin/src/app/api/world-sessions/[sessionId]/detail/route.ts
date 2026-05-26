import { NextResponse } from "next/server";
import { getWorldSessionStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;
  try {
    const detail = await getWorldSessionStore().getSessionDetail(sessionId);
    if (!detail) {
      return NextResponse.json({ error: "World session not found." }, { status: 404 });
    }
    return NextResponse.json({ detail });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
