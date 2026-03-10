import { NextResponse } from "next/server";
import { getVisibleWorlds } from "@/data/worlds";
import { createIntroResult, getSessionTurns, resumeSession } from "@/lib/simulation/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const session = await resumeSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const world = getVisibleWorlds().find((candidate) => candidate.id === session.worldId);

    if (!world) {
      return NextResponse.json({ error: "World not found." }, { status: 404 });
    }

    const turns = await getSessionTurns(sessionId);

    return NextResponse.json({
      ...createIntroResult(session, world),
      turns,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load session." },
      { status: 500 },
    );
  }
}
