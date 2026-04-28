import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getKyutaiBaseUrl() {
  return (process.env.KYUTAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

export async function GET() {
  const baseUrl = getKyutaiBaseUrl();

  if (!baseUrl) {
    return NextResponse.json(
      {
        configured: false,
        baseUrl: null,
        error: "KYUTAI_BASE_URL is not set.",
      },
      { status: 503 },
    );
  }

  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/healthz`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const bodyText = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }

    return NextResponse.json({
      configured: true,
      baseUrl,
      ok: response.ok,
      status: response.status,
      latencyMs,
      payload: parsed ?? bodyText,
    });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return NextResponse.json(
      {
        configured: true,
        baseUrl,
        ok: false,
        status: 0,
        latencyMs,
        error: error instanceof Error ? error.message : "Gateway probe failed.",
      },
      { status: 502 },
    );
  }
}

type WarmRequest = {
  silenceMs?: number;
};

export async function POST(request: Request) {
  const baseUrl = getKyutaiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      { error: "KYUTAI_BASE_URL is not set." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as WarmRequest;
  const silenceMs = Math.min(Math.max(body.silenceMs ?? 800, 200), 3000);

  const sampleRate = 16000;
  const sampleCount = Math.round((silenceMs / 1000) * sampleRate);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  const audioBase64 = buffer.toString("base64");
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioBase64, mimeType: "audio/wav" }),
      signal: AbortSignal.timeout(120000),
    });

    const latencyMs = Math.round(performance.now() - startedAt);
    const bodyText = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      latencyMs,
      payload: parsed ?? bodyText,
    });
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return NextResponse.json(
      {
        ok: false,
        status: 0,
        latencyMs,
        error: error instanceof Error ? error.message : "Gateway warm-up failed.",
      },
      { status: 502 },
    );
  }
}
