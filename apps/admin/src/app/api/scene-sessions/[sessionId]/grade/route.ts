import { NextResponse } from "next/server";
import { getSceneSessionStore } from "@odyssey/db";
import { gradeTurn } from "@odyssey/voice-pipeline";
import { auth } from "@/lib/auth";

// Grade a PERSISTED turn in place — no replay. Reads the response + the exact
// systemPrompt/promptChunk the turn actually used from the session record, then runs
// the faithfulness + in-character judges. Powers the /sessions workbench "Evaluate"
// action so any past turn (sandbox or LiveKit) can be scored after the fact.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // two judge calls; each takes a few seconds

export async function POST(
  req: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await ctx.params;
  let body: { turnId?: string; axes?: { grounding?: boolean; quality?: boolean } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const turnId = body.turnId?.trim();
  if (!turnId) {
    return NextResponse.json({ error: "turnId is required" }, { status: 400 });
  }

  const detail = await getSceneSessionStore().getSessionDetail(sessionId);
  if (!detail) {
    return NextResponse.json({ error: "Scene session not found." }, { status: 404 });
  }
  const turn = detail.turns.find((t) => t.id === turnId);
  const build = detail.contextBuilds.find((b) => b.turnId === turnId);
  if (!turn?.assistantText) {
    return NextResponse.json({ error: "Turn has no response to grade." }, { status: 400 });
  }
  if (!build?.systemPrompt) {
    return NextResponse.json(
      { error: "Turn has no captured prompt — not gradeable (older turn or missing turnId)." },
      { status: 422 },
    );
  }

  try {
    const grade = await gradeTurn({
      message: turn.userText ?? build.query ?? "",
      response: turn.assistantText,
      systemPrompt: build.systemPrompt,
      promptChunk: build.promptChunk ?? "",
      axes: body.axes ?? { grounding: true, quality: true },
    });
    return NextResponse.json({ grade });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `grading failed: ${message}` }, { status: 500 });
  }
}
