import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not configured." },
      { status: 503 },
    );
  }

  let response: Response;
  try {
    response = await fetch(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `ElevenLabs token fetch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 },
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
    detail?: string;
  };

  if (!response.ok || !payload.token) {
    return NextResponse.json(
      {
        error:
          payload.error ??
          payload.detail ??
          `ElevenLabs token fetch failed: HTTP ${response.status}`,
      },
      { status: response.ok ? 502 : response.status },
    );
  }

  return NextResponse.json({ token: payload.token });
}
