import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type CharacterBrainModel } from "@odyssey/db";
import { launchEvalRunInBackground } from "@odyssey/evals";
import { loadLatestSuite } from "@/lib/eval-suites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/evals/runs
 *
 * Returns the most recent eval runs for a character plus the pass-rate
 * trend (for the sparkline on the Evals page header). Combining both
 * payloads in one request because the page renders them simultaneously
 * — two round-trips would just add latency for the same data shape.
 *
 * Query params:
 *   ?limit=20      (default 20, max 100)
 *   ?offset=0
 *   ?configHash=…  (optional: only runs with this exact effective config)
 *   ?sweepId=…     (optional: only runs from this parent sweep)
 *   ?trendLimit=14 (default 14, max 50) — points in the sparkline trend
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  // :id is the character UUID (consistent with peer routes in this folder
  // like brain-model). Validate existence so we 404 cleanly instead of
  // returning an empty list for a typoed id.
  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = parseIntParam(url.searchParams.get("limit"), 20);
  const offset = parseIntParam(url.searchParams.get("offset"), 0);
  const configHash = url.searchParams.get("configHash") ?? undefined;
  const sweepId = url.searchParams.get("sweepId") ?? undefined;
  const trendLimit = parseIntParam(url.searchParams.get("trendLimit"), 14);

  const store = getEvalStore();
  const [runs, trend] = await Promise.all([
    store.listRuns({ characterId: id, limit, offset, configHash, sweepId }),
    store.getPassRateTrend(id, trendLimit),
  ]);

  return NextResponse.json({ runs, trend });
}

/**
 * POST /api/characters/:id/evals/runs
 *
 * Body:
 *   {
 *     suiteSlug: string,            // which suite to run (e.g. "abraham")
 *     overrideConfig?: Partial<CharacterBrainModel>,  // optional brainModel override
 *     judgeModel?: string,          // default "claude-opus-4-5"
 *     probeIds?: string[],          // optional subset
 *   }
 *
 * Fire-and-forget: inserts a pending row, kicks off the runner in the
 * background, returns the new runId. The page polls the GET endpoint and
 * sees the run go pending → running → completed (or errored).
 *
 * Note on backgrounding: on Vercel-style serverless this needs `waitUntil`
 * to survive past the response. On self-hosted Node the unawaited Promise
 * keeps running. We don't wire `waitUntil` here because:
 *   1. The Anthropic SDK call inside the runner keeps the event loop alive
 *      on its own (open socket).
 *   2. If you deploy to Vercel later, add `waitUntil(result.promise)` here.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: {
    suiteSlug?: unknown;
    overrideConfig?: unknown;
    judgeModel?: unknown;
    probeIds?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const suiteSlug = typeof body.suiteSlug === "string" ? body.suiteSlug : null;
  if (!suiteSlug) {
    return NextResponse.json({ error: "suiteSlug is required" }, { status: 400 });
  }

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const suite = await loadLatestSuite(id, suiteSlug);
  if (!suite) {
    return NextResponse.json(
      {
        error: `no published suite "${suiteSlug}" for this character — run the seed script first`,
      },
      { status: 404 },
    );
  }

  try {
    const launchInput: Parameters<typeof launchEvalRunInBackground>[0] = {
      characterId: id,
      suite,
    };
    if (body.overrideConfig && typeof body.overrideConfig === "object") {
      launchInput.overrideConfig = body.overrideConfig as Partial<CharacterBrainModel>;
    }
    if (typeof body.judgeModel === "string") launchInput.judgeModel = body.judgeModel;
    if (Array.isArray(body.probeIds) && body.probeIds.every((p) => typeof p === "string")) {
      launchInput.probeIds = body.probeIds as string[];
    }

    const { runId, promise } = await launchEvalRunInBackground(launchInput);

    // Explicitly NOT awaited. `void` so TypeScript knows we're intentionally
    // dropping the Promise. The runner will continue in the Node process.
    void promise;

    return NextResponse.json({ runId, status: "pending" }, { status: 202 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
