import { NextRequest, NextResponse } from "next/server";
import { getWorldSessionStore } from "@odyssey/db";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  id?: string;
  worldId?: string | null;
  characterId?: string | null;
  mode?: string;
  initialMoment?: unknown;
  initialScene?: unknown;
  currentMoment?: unknown;
  currentScene?: unknown;
  metadata?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode = body.mode?.trim();
  if (!mode) {
    return NextResponse.json({ error: "mode is required." }, { status: 400 });
  }

  try {
    const session = await auth().catch(() => null);
    const record = await getWorldSessionStore().createSession({
      id: body.id,
      userId: session?.user?.id ?? null,
      worldId: body.worldId ?? null,
      characterId: body.characterId ?? null,
      mode,
      initialMoment: body.initialMoment,
      initialScene: body.initialScene,
      currentMoment: body.currentMoment,
      currentScene: body.currentScene,
      metadata: body.metadata ?? {},
    });
    await getWorldSessionStore().appendEvent({
      sessionId: record.id,
      type: "session.started",
      source: "system",
      payload: {
        mode,
        worldId: body.worldId ?? null,
        characterId: body.characterId ?? null,
      },
    });
    return NextResponse.json({ session: record }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sessions = await getWorldSessionStore().listSessions(50);
    return NextResponse.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
