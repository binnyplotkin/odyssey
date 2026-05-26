import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";
import { launchEvalSweepInBackground, type SweepSpec } from "@odyssey/evals";
import { loadLatestSuite } from "@/lib/eval-suites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/evals/sweeps
 *
 * Lists all sweeps for this character, newest first. Rankings + Pareto
 * are inlined on each sweep row (denormalized in `eval_sweeps`), so the
 * list view can show "best config from each sweep" without fetching
 * individual children.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const sweeps = await getEvalStore().listSweeps(id);
  return NextResponse.json({ sweeps });
}

/**
 * POST /api/characters/:id/evals/sweeps
 *
 * Body:
 *   {
 *     suiteSlug: string,
 *     spec: SweepSpec,           // { model?: string[], temperature?: number[], ... }
 *     judgeModel?: string,
 *     probeIds?: string[],
 *     maxConcurrency?: number,
 *   }
 *
 * Fire-and-forget. Returns 202 + the new sweepId; the sweep runs in the
 * background, page polls to see progress. Sweeps are 15+ minutes typically
 * — same backgrounding caveat as POST /runs.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: {
    suiteSlug?: unknown;
    spec?: unknown;
    judgeModel?: unknown;
    probeIds?: unknown;
    maxConcurrency?: unknown;
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

  // Lightweight spec validation — at least one dimension must be present and
  // be a non-empty array. Heavy validation lives in expandSweep, but giving
  // a clear 400 here saves the operator a confusing 500 from the background.
  if (!body.spec || typeof body.spec !== "object" || Array.isArray(body.spec)) {
    return NextResponse.json({ error: "spec must be an object of arrays" }, { status: 400 });
  }
  const specObj = body.spec as Record<string, unknown>;
  let totalConfigs = 1;
  for (const [k, v] of Object.entries(specObj)) {
    if (!Array.isArray(v) || v.length === 0) {
      return NextResponse.json(
        { error: `spec.${k} must be a non-empty array` },
        { status: 400 },
      );
    }
    totalConfigs *= v.length;
  }
  if (totalConfigs > 50) {
    // Soft cap. A 50-config sweep at 20 probes is ~1000 probes, ~5h wall
    // time on Anthropic. If you genuinely need bigger, raise this; meant
    // mostly as a guardrail against accidental {"temperature": Array(100)}.
    return NextResponse.json(
      { error: `spec expands to ${totalConfigs} configs (cap 50). Narrow it or run as multiple sweeps.` },
      { status: 400 },
    );
  }

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const suite = await loadLatestSuite(id, suiteSlug);
  if (!suite) {
    return NextResponse.json(
      { error: `no published suite "${suiteSlug}" for this character — run the seed script first` },
      { status: 404 },
    );
  }

  try {
    const launchInput: Parameters<typeof launchEvalSweepInBackground>[0] = {
      characterId: id,
      suite,
      sweep: specObj as SweepSpec,
    };
    if (typeof body.judgeModel === "string") launchInput.judgeModel = body.judgeModel;
    if (Array.isArray(body.probeIds) && body.probeIds.every((p) => typeof p === "string")) {
      launchInput.probeIds = body.probeIds as string[];
    }
    if (typeof body.maxConcurrency === "number") {
      launchInput.maxConcurrency = body.maxConcurrency;
    }

    const { sweepId, promise } = await launchEvalSweepInBackground(launchInput);
    void promise;

    return NextResponse.json({ sweepId, status: "pending" }, { status: 202 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
