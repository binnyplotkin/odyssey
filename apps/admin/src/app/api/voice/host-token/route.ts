import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/lib/auth";

// Mints a short-lived token the browser presents to the warm voice-host
// (services/voice-host) so the host never has to understand NextAuth. The admin
// app has already authenticated the user (middleware + auth()); this route just
// attests "this signed-in admin may stream THIS character for ~60s", signed with
// a secret shared only with the host. Least coupling, tight blast radius — and
// the same mint point grows to issue LiveKit grants in Phase 2.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Short — the client mints per session and refreshes lazily, off the hot path.
const TOKEN_TTL_S = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.VOICE_HOST_TOKEN_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "VOICE_HOST_TOKEN_SECRET is not configured" },
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

  const token = await new SignJWT({
    characterId,
    sessionId: payload.sessionId ?? null,
    role: session.user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.user.id)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_S}s`)
    .sign(new TextEncoder().encode(secret));

  return NextResponse.json({ token, expiresIn: TOKEN_TTL_S });
}
