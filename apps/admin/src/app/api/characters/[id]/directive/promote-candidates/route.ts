import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/directive/promote-candidates
 *
 * Surfaces high-scoring eval exchanges as candidates for promotion to
 * canonical L02 exemplars. The pitch: every probe captured a USER line +
 * character response that the judge already scored. The 5-out-of-5
 * responses ARE the exemplars you want — they passed the rubric this
 * character is being held to. Editor just needs a one-click path to
 * promote them.
 *
 * Why this beats a "promote from chat history" affordance:
 *   - Already scored. Only good exchanges surface, no manual sifting.
 *   - Already persisted. No new schema, no chat-history table.
 *   - Cross-run. See what worked across configs, not just one session.
 *   - Categorized. Probe categories (identity / deflect / edge / etc.)
 *     are metadata the author can use to balance their exemplar set.
 *
 * Algorithm:
 *   1. Walk recent eval runs for this character (limit 50 — enough for
 *      a few thousand probe results).
 *   2. For each, load the probes (getRunWithProbes).
 *   3. Filter to probes that passed AND scored >= 4.0 (high-quality —
 *      the rubric's "in voice and on point" floor).
 *   4. Deduplicate by probe input — same user line tested across many
 *      runs is one candidate; keep the highest-scoring response.
 *   5. Sort by overall DESC.
 *   6. Return up to 30 candidates.
 *
 * Why limit 50 runs?  Each `getRunWithProbes` pulls 20 probe rows, so
 * 50 runs is ~1000 probe reads — well under any DB ceiling and fast
 * enough for a UI fetch. Authors caring about deeper history can ask
 * for limit bumping later.
 *
 * Returns:
 *   { candidates: Array<{
 *       probeId, probeCategory, input, response,
 *       overall, rationale, modelLabel, runId,
 *       startedAt, runCount,
 *     }> }
 */

type Candidate = {
  probeId: string;
  probeCategory: string;
  input: string;
  response: string;
  overall: number;
  rationale: string;
  modelId: string | null;
  modelLabel: string | null;
  runId: string;
  startedAt: string;
  /** How many runs this exact USER input appeared in (across all configs). */
  runCount: number;
};

const PASS_FLOOR = 4.0;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const store = getEvalStore();
  const runs = await store.listRuns({ characterId: id, limit: 50 });

  // Walk runs in parallel — getRunWithProbes is cached at the read-retry
  // layer in eval-store. Promise.all bounds the wait at the slowest
  // single read, not the sum.
  const probesByRun = await Promise.all(
    runs.map(async (run) => {
      const withProbes = await store.getRunWithProbes(run.id);
      if (!withProbes) return { run, probes: [] };
      return { run, probes: withProbes.probes };
    }),
  );

  // Bucket by input. Per bucket: pick the highest-scoring response.
  type Bucket = {
    best: Candidate;
    runIds: Set<string>;
  };
  const buckets = new Map<string, Bucket>();

  for (const { run, probes } of probesByRun) {
    const cfg = run.effectiveModelConfig as { model?: string } | null;
    const modelId = cfg?.model ?? null;
    for (const p of probes) {
      if (!p.pass || p.overall < PASS_FLOOR) continue;
      if (!p.input?.trim() || !p.response?.trim()) continue;

      const candidate: Candidate = {
        probeId: p.probeId,
        probeCategory: p.probeCategory,
        input: p.input.trim(),
        response: p.response.trim(),
        overall: p.overall,
        rationale: p.rationale,
        modelId,
        // Label resolution stays client-side via the model registry — the
        // server doesn't need to import the registry just for a string.
        modelLabel: null,
        runId: run.id,
        startedAt: run.startedAt,
        runCount: 1,
      };

      const existing = buckets.get(p.input.trim());
      if (existing) {
        existing.runIds.add(run.id);
        if (candidate.overall > existing.best.overall) {
          existing.best = candidate;
        }
      } else {
        buckets.set(p.input.trim(), {
          best: candidate,
          runIds: new Set([run.id]),
        });
      }
    }
  }

  const candidates = Array.from(buckets.values())
    .map(({ best, runIds }) => ({ ...best, runCount: runIds.size }))
    .sort((a, b) => {
      // Primary: overall DESC. Tie-break: more runs (more reproducible)
      // wins. Then most recent.
      if (Math.abs(b.overall - a.overall) > 0.01) return b.overall - a.overall;
      if (b.runCount !== a.runCount) return b.runCount - a.runCount;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    })
    .slice(0, 30);

  return NextResponse.json({ candidates });
}
