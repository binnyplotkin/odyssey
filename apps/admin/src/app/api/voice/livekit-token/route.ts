import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { auth } from "@/lib/auth";

// Mints a short-lived LiveKit room-join token — the WebRTC twin of
// /api/voice/host-token's SSE bearer. auth() has already verified the signed-in
// admin (middleware + auth()); this grants join + mic-publish on a room. The
// registered voice-agent worker auto-dispatches in and voices whoever the room
// names: a `sceneId` → the multi-character SceneDriver (`scene-…` room); a
// `characterId` → a single character (`char-…` room). The worker parses the
// subject out of the room name — no per-worker env selects it.
//
// Requires LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET on the admin server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_TTL_S = 60 * 30; // a room session

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured" },
      { status: 500 },
    );
  }

  let payload: { characterId?: string; sceneId?: string; sessionId?: string };
  try {
    payload = (await req.json()) as {
      characterId?: string;
      sceneId?: string;
      sessionId?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const characterId = payload.characterId?.trim();
  const sceneId = payload.sceneId?.trim();
  if (!characterId && !sceneId) {
    return NextResponse.json({ error: "characterId or sceneId is required" }, { status: 400 });
  }

  // One room per (subject, session): the browser publishes its mic here; the agent
  // worker dispatches in and publishes voice back. A sceneId routes to the
  // multi-character SceneDriver (`scene-…`); a characterId to a single character
  // (`char-…`). The sessionId is just a uniqueness token in the room name — the
  // worker creates its own scene_session for the brain.
  const sessionToken = payload.sessionId ?? crypto.randomUUID();
  const room = sceneId
    ? `scene-${sceneId}-${sessionToken}`
    : `char-${characterId}-${sessionToken}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: session.user.id,
    ttl: TOKEN_TTL_S,
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  return NextResponse.json({ url, token, room });
}
