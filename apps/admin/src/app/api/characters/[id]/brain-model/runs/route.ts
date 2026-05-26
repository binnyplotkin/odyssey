import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type CharacterBrainModel } from "@odyssey/db";
import { captureCharacterSnapshot } from "@odyssey/evals";
import { MODEL_REGISTRY } from "@/lib/model-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/brain-model/runs
 *
 * Backs the L04 RUNS tab. Aggregates `eval_runs` for this character,
 * grouped by `configHash`, into a per-config win/loss summary. The
 * grouping index `eval_runs_config_hash_idx` is already on the table —
 * this is its purpose-built query.
 *
 * The currently-saved brainModel is hashed via `captureCharacterSnapshot`
 * so the response can mark which group (if any) matches the live config.
 *
 * Returns:
 * {
 *   groups: Array<{
 *     configHash, modelLabel, modelId, provider,
 *     temperature, topP, maxTokens,
 *     runCount, totalPassed, totalProbes,
 *     meanPass, meanAvg, meanLatencyMs, meanCostUsd,
 *     firstSeenAt, lastSeenAt, isCurrent,
 *   }>
 * }
 */

type RunGroup = {
  configHash: string;
  modelLabel: string;
  modelId: string;
  provider: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  runCount: number;
  totalPassed: number;
  totalProbes: number;
  meanPass: number;
  meanAvg: number;
  meanLatencyMs: number;
  meanCostUsd: number;
  firstSeenAt: string;
  lastSeenAt: string;
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

  // Limit 200 keeps the response cheap for chatty test characters. Older
  // runs roll off naturally since this is an "interesting recent history"
  // surface, not an audit log.
  const runs = await getEvalStore().listRuns({ characterId: id, limit: 200 });

  // Group in-process — at 200 runs this is microseconds. The schema
  // already has an index on (characterId, configHash) for the SELECT;
  // grouping client-side keeps the query simple + avoids a SQL agg.
  const grouped = new Map<string, {
    configHash: string;
    runs: typeof runs;
    effectiveModelConfig: unknown;
  }>();

  for (const run of runs) {
    const existing = grouped.get(run.configHash);
    if (existing) {
      existing.runs.push(run);
    } else {
      grouped.set(run.configHash, {
        configHash: run.configHash,
        runs: [run],
        effectiveModelConfig: run.effectiveModelConfig,
      });
    }
  }

  // Hash the current character to mark the matching group, if any.
  const currentHash = captureCharacterSnapshot(character).configHash;

  const groups: RunGroup[] = Array.from(grouped.values()).map((g) => {
    const cfg = (g.effectiveModelConfig as Partial<CharacterBrainModel> & { model?: string }) ?? {};
    const meta = cfg.model ? MODEL_REGISTRY.find((m) => m.id === cfg.model) : null;
    const passed = g.runs.reduce((acc, r) => acc + r.summary.passed, 0);
    const total = g.runs.reduce((acc, r) => acc + r.summary.total, 0);
    const meanPass = g.runs.reduce((acc, r) => acc + r.summary.passed, 0) / g.runs.length;
    const meanAvg = g.runs.reduce((acc, r) => acc + r.summary.avgOverall, 0) / g.runs.length;
    const meanLat = g.runs.reduce((acc, r) => acc + r.summary.avgLatencyMs, 0) / g.runs.length;
    const meanCost = g.runs.reduce((acc, r) => acc + r.summary.estimatedCostUsd, 0) / g.runs.length;
    const startedAts = g.runs.map((r) => r.startedAt).sort();
    return {
      configHash: g.configHash,
      modelLabel: meta?.label ?? cfg.model ?? "(unknown model)",
      modelId: cfg.model ?? "—",
      provider: meta?.provider ?? cfg.provider ?? "—",
      temperature: typeof cfg.temperature === "number" ? cfg.temperature : null,
      topP: typeof cfg.topP === "number" ? cfg.topP : null,
      maxTokens: typeof cfg.maxTokens === "number" ? cfg.maxTokens : null,
      runCount: g.runs.length,
      totalPassed: passed,
      totalProbes: total,
      meanPass,
      meanAvg,
      meanLatencyMs: meanLat,
      meanCostUsd: meanCost,
      firstSeenAt: startedAts[0],
      lastSeenAt: startedAts[startedAts.length - 1],
      isCurrent: g.configHash === currentHash,
    };
  });

  // Sort by mean pass DESC so the strongest configs surface first.
  // Within a tie, fall back to most recent so freshly-run configs win.
  groups.sort((a, b) => {
    if (Math.abs(b.meanPass - a.meanPass) > 0.01) return b.meanPass - a.meanPass;
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });

  return NextResponse.json({ groups });
}
