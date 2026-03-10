import { NextRequest, NextResponse } from "next/server";
import { getVisibleWorlds } from "@/data/worlds";
import {
  createIntroResult,
  listRecentSessions,
  startSession,
} from "@/lib/simulation/service";

export async function GET() {
  const sessions = await listRecentSessions();
  return NextResponse.json({ sessions });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { worldId?: string; roleId?: string };

    if (!body.worldId || !body.roleId) {
      return NextResponse.json(
        { error: "worldId and roleId are required." },
        { status: 400 },
      );
    }

    const session = await startSession(body.worldId, body.roleId);
    const world = getVisibleWorlds().find((candidate) => candidate.id === body.worldId);

    if (!world) {
      return NextResponse.json({ error: "Unknown world." }, { status: 404 });
    }

    return NextResponse.json(createIntroResult(session, world));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start session." },
      { status: 500 },
    );
  }
}
