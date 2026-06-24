import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { auth } from "@/lib/auth";

// Mints a short-lived LiveKit room-join token — the WebRTC twin of
// /api/voice/host-token's SSE bearer. auth() has already verified the signed-in
// admin (middleware + auth()); this grants join + mic-publish on a per-character
// room. The registered voice-agent worker auto-dispatches into the room and
// voices the character. (Multi-character dispatch via room metadata is a
// follow-up; today the worker's VOICE_AGENT_CHARACTER_ID selects the character.)
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

  let payload: { characterId?: string; sessionId?: string };
  try {
    payload = (await req.json()) as { characterId?: string; sessionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const characterId = payload.characterId?.trim();
  if (!characterId) {
    return NextResponse.json({ error: "characterId is required" }, { status: 400 });
  }

  // One room per (character, session): the browser publishes its mic here; the
  // agent worker dispatches in and publishes the character's voice back.
  const room = `char-${characterId}-${payload.sessionId ?? crypto.randomUUID()}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: session.user.id,
    ttl: TOKEN_TTL_S,
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  return NextResponse.json({ url, token, room });
}
