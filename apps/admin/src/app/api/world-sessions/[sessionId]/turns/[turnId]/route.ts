import { NextRequest, NextResponse } from "next/server";
import { getWorldSessionStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TurnBody = {
  turnIndex?: number | null;
  inputMode?: string;
  userText?: string | null;
  assistantText?: string | null;
  provider?: string | null;
  model?: string | null;
  status?: string;
  startedAt?: string;
  completedAt?: string | null;
  tokenUsage?: unknown;
  audioMetrics?: unknown;
  latencySummary?: unknown;
  trace?: unknown;
  metadata?: Record<string, unknown>;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ sessionId: string; turnId: string }> },
) {
  const { sessionId, turnId } = await ctx.params;

  let body: TurnBody;
  try {
    body = (await req.json()) as TurnBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    await getWorldSessionStore().upsertTurn({
      id: turnId,
      sessionId,
      turnIndex: body.turnIndex ?? null,
      inputMode: body.inputMode ?? "voice",
      userText: body.userText ?? null,
      assistantText: body.assistantText ?? null,
      provider: body.provider ?? null,
      model: body.model ?? null,
      status: body.status ?? "complete",
      startedAt: body.startedAt,
      completedAt: body.completedAt ?? new Date().toISOString(),
      tokenUsage: body.tokenUsage ?? {},
      audioMetrics: body.audioMetrics ?? {},
      latencySummary: body.latencySummary ?? {},
      trace: body.trace ?? {},
      metadata: body.metadata ?? {},
    });
    await getWorldSessionStore().appendEvent({
      sessionId,
      turnId,
      type: `turn.${body.status ?? "complete"}`,
      source: "system",
      payload: {
        inputMode: body.inputMode ?? "voice",
        provider: body.provider ?? null,
        model: body.model ?? null,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
