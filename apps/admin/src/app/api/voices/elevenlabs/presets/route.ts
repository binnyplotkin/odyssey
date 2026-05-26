import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/elevenlabs/presets
 *
 * Lists ElevenLabs voices the configured API key has access to (premade
 * presets + the workspace's cloned voices). Powers the "+ new voice"
 * picker for ElevenLabs in the admin UI — the user picks one of these,
 * we POST the chosen voice_id back to /api/voices with provider='elevenlabs'.
 *
 * Cached in-process for 5 minutes since ElevenLabs's `/v1/voices` is
 * rate-limited (10 req/min on most plans) and the list rarely changes.
 * `?refresh=1` busts the cache for forced re-syncs.
 *
 * Response shape:
 *   {
 *     presets: ElevenLabsPreset[],
 *     cached: boolean,           // true if served from in-memory cache
 *     fetchedAt: string,          // ISO timestamp of underlying fetch
 *   }
 *
 * Errors:
 *   503 — ELEVENLABS_API_KEY not configured
 *   502 — ElevenLabs returned an error
 */

export interface ElevenLabsPreset {
  voiceId: string;
  name: string;
  category: string;         // "premade" | "cloned" | "professional" | "generated"
  description: string | null;
  previewUrl: string | null; // public mp3 audition URL from ElevenLabs
  language: string | null;   // BCP-47ish — derived from labels.accent + locale heuristics
  gender: string | null;     // labels.gender if present
  accent: string | null;
  age: string | null;
  useCase: string | null;
  labels: Record<string, string>;
}

const CACHE_TTL_MS = 5 * 60_000;

let cache:
  | { presets: ElevenLabsPreset[]; fetchedAt: number }
  | null = null;

interface ElevenLabsRawVoice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string> | null;
}

function normalize(raw: ElevenLabsRawVoice): ElevenLabsPreset {
  const labels = raw.labels ?? {};
  return {
    voiceId: raw.voice_id,
    name: raw.name,
    category: raw.category ?? "premade",
    description: raw.description ?? null,
    previewUrl: raw.preview_url ?? null,
    // ElevenLabs doesn't return a BCP-47 code directly. The picker UI
    // shows whatever's here; the user can override `language` when
    // saving the voice.
    language: labels.language ?? labels.accent ?? null,
    gender: labels.gender ?? null,
    accent: labels.accent ?? null,
    age: labels.age ?? null,
    useCase: labels["use case"] ?? labels.use_case ?? null,
    labels,
  };
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not configured." },
      { status: 503 },
    );
  }

  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const now = Date.now();
  if (!refresh && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      presets: cache.presets,
      cached: true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
    });
  }

  let resp: Response;
  try {
    resp = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      // ElevenLabs typically responds in <1s; cap to keep the UI snappy.
      signal: AbortSignal.timeout(8_000),
    });
  } catch (fetchErr) {
    return NextResponse.json(
      {
        error: `ElevenLabs fetch failed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      },
      { status: 502 },
    );
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return NextResponse.json(
      {
        error: `ElevenLabs returned ${resp.status}: ${detail.slice(0, 300) || "no body"}`,
      },
      { status: 502 },
    );
  }

  const payload = (await resp.json()) as { voices?: ElevenLabsRawVoice[] };
  const presets = (payload.voices ?? []).map(normalize);

  cache = { presets, fetchedAt: now };

  return NextResponse.json({
    presets,
    cached: false,
    fetchedAt: new Date(now).toISOString(),
  });
}
