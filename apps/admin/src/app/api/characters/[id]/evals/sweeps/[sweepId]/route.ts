import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/evals/sweeps/:sweepId
 *
 * Sweep detail: header + every child run (one per config in the grid).
 * Each run includes summary stats but NOT per-probe results — those
 * load lazily via the runs/[runId] endpoint when a config is expanded.
 *
 * The sweep itself carries `rankings`, `pareto`, and `configs` jsonb,
 * so the Pareto chart + ranking table render from this one response
 * without any additional queries.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; sweepId: string }> },
) {
  const { id, sweepId } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const store = getEvalStore();
  const sweep = await store.getSweep(sweepId);
  if (!sweep) {
    return NextResponse.json({ error: "sweep not found" }, { status: 404 });
  }
  if (sweep.characterId !== id) {
    // Same character-mismatch defense as runs/[runId].
    return NextResponse.json({ error: "sweep not found" }, { status: 404 });
  }

  const runs = await store.getSweepRuns(sweepId);
  return NextResponse.json({ sweep, runs });
}
