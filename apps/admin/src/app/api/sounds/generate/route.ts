import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// SFX generation takes ~5–20 s at ElevenLabs; give the route headroom.
export const maxDuration = 60;

const ELEVENLABS_SFX_URL = "https://api.elevenlabs.io/v1/sound-generation";

const bodySchema = z.object({
  prompt: z.string().trim().min(3).max(450),
  // ElevenLabs accepts 0.5–30 s; omit to let the model pick.
  durationSeconds: z.number().min(0.5).max(30).optional(),
  // Ask the model for a seamless loop (ambience beds).
  loop: z.boolean().optional(),
});

/**
 * POST /api/sounds/generate
 * Relays a text prompt to the ElevenLabs sound-generation API and returns
 * the mp3 bytes (base64) for client-side preview → ingest → save. Nothing
 * is persisted here — the client decides whether to keep the take and
 * saves it through POST /api/sounds like any upload.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not configured" },
      { status: 501 },
    );
  }

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first.path.join(".") || "body"}: ${first.message}` },
      { status: 400 },
    );
  }
  const { prompt, durationSeconds, loop } = parsed.data;

  const resp = await fetch(ELEVENLABS_SFX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: prompt,
      ...(durationSeconds !== undefined
        ? { duration_seconds: durationSeconds }
        : {}),
      ...(loop !== undefined ? { loop } : {}),
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return NextResponse.json(
      {
        error: `ElevenLabs sound-generation failed (${resp.status})${
          detail ? `: ${detail.slice(0, 300)}` : ""
        }`,
      },
      { status: 502 },
    );
  }

  const bytes = Buffer.from(await resp.arrayBuffer());
  return NextResponse.json({
    audioBase64: bytes.toString("base64"),
    contentType: resp.headers.get("content-type") ?? "audio/mpeg",
    prompt,
  });
}
