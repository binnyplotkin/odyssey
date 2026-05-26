import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type CharacterBrainModel } from "@odyssey/db";
import { captureCharacterSnapshot } from "@odyssey/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/brain-model/history
 *
 * Reconstructs the mind/model timeline from `eval_runs.characterSnapshot`.
 * Each distinct `configHash` becomes one entry; the `brainModel` field
 * surfaced in the response comes from the snapshot's brainModel block.
 *
 * Why not a dedicated character_versions table? In practice every config
 * change the author cares about reverting to has been validated against
 * an eval — they ran a sweep on it. Configs they made without running
 * an eval are unrecorded here, but those are typically experiments
 * abandoned before validation; not what you'd want to revert to anyway.
 * When the cost/benefit flips, this endpoint can swap to a dedicated
 * versions table without changing the client.
 *
 * "Revert" is implemented client-side via the existing
 * POST /api/characters/:id/brain-model — pick the snapshot's brainModel
 * out of this response and re-save it.
 *
 * Returns:
 * {
 *   entries: Array<{
 *     configHash,
 *     brainModel,
 *     firstSeenAt,
 *     lastSeenAt,
 *     runCount,
 *     isCurrent,
 *   }>
 * }
 * Sorted by lastSeenAt DESC.
 */

type HistoryEntry = {
  configHash: string;
  brainModel: CharacterBrainModel | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  isCurrent: boolean;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  // Same limit as the runs endpoint — 200 is well past the point where
  // a human author can usefully scrub.
  const runs = await getEvalStore().listRuns({ characterId: id, limit: 200 });

  const grouped = new Map<string, { entries: typeof runs; brainModel: CharacterBrainModel | null }>();
  for (const run of runs) {
    const existing = grouped.get(run.configHash);
    if (existing) {
      existing.entries.push(run);
    } else {
      // Pull brainModel out of the captured snapshot — `characterSnapshot`
      // is stored as JSONB and shaped like `CharacterSnapshot` from
      // @odyssey/evals. Defensive narrowing here so a malformed row
      // doesn't 500 the whole response.
      const snap = run.characterSnapshot as { brainModel?: CharacterBrainModel | null } | null;
      grouped.set(run.configHash, {
        entries: [run],
        brainModel: snap?.brainModel ?? null,
      });
    }
  }

  const currentHash = captureCharacterSnapshot(character).configHash;

  const entries: HistoryEntry[] = Array.from(grouped.values()).map((g) => {
    const starts = g.entries.map((r) => r.startedAt).sort();
    return {
      configHash: g.entries[0].configHash,
      brainModel: g.brainModel,
      firstSeenAt: starts[0],
      lastSeenAt: starts[starts.length - 1],
      runCount: g.entries.length,
      isCurrent: g.entries[0].configHash === currentHash,
    };
  });

  // Most recently used first — that's the timeline scrubbers want.
  entries.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return NextResponse.json({ entries });
}
