import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";
import { buildSystemPromptParts } from "@odyssey/engine";
import { buildJudgeUserPrompt, JUDGE_SYSTEM_PROMPT } from "@odyssey/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/evals/runs/:runId/probes/:probeId/trace
 *
 * Reconstructs the FULL request/response trace for one probe of a past run:
 *
 *   characterRequest:
 *     - system.cached:   the cached envelope (L01-L04 → identity/scope/voice XML)
 *     - system.perTurn:  per-turn curator chunk — null if not stored
 *     - userMessage:     the probe input
 *     - modelConfig:     { model, temperature, top_p, max_tokens, cacheControl }
 *
 *   characterResponse: the assistant text (already on the probe row)
 *
 *   judgeRequest:
 *     - systemPrompt:    JUDGE_SYSTEM_PROMPT constant
 *     - userPrompt:      probe-specific (rubric + character context + response)
 *     - judgeModel:      the model that scored
 *
 *   judgeResponse:       { scores, overall, pass, rationale } — already on probe row
 *
 * The cached system block is deterministic from the snapshot, so we
 * recompute it on the fly rather than storing 2-3KB per probe. The per-turn
 * curator chunk depends on wiki state at run time, which we don't snapshot;
 * the trace returns `null` for that field with a note that re-running the
 * probe will recompute it.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string; probeId: string }> },
) {
  const { id, runId, probeId } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const run = await getEvalStore().getRunWithProbes(runId);
  if (!run || run.characterId !== id) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const probe = run.probes.find((p) => p.probeId === probeId);
  if (!probe) {
    return NextResponse.json({ error: "probe not found in run" }, { status: 404 });
  }

  // ── Reconstruct the character request ────────────────────────────
  // The snapshot is jsonb so the field shapes are loose typing-wise.
  // We trust the snapshot's structure since it was captured by
  // captureCharacterSnapshot — no defensive parsing needed in practice.
  const snap = run.characterSnapshot as {
    characterTitle: string;
    identity: import("@odyssey/db").CharacterIdentity | null;
    voiceStyle: import("@odyssey/db").CharacterVoiceStyle | null;
    directive: import("@odyssey/db").CharacterDirective | null;
  };

  // perTurn is "" because we don't have the curator output stored. The
  // builder will produce a cached block that excludes the per-turn shape.
  const parts = buildSystemPromptParts(
    snap.characterTitle,
    "", // per-turn curator chunk — see comment above
    snap.directive,
    snap.identity,
    snap.voiceStyle,
  );

  const effective = run.effectiveModelConfig as {
    model: string;
    maxTokens: number;
    cacheControl: boolean;
    temperature?: number;
    topP?: number;
  };

  const characterRequest = {
    system: {
      cached: parts.cached,
      perTurn: null as string | null, // not stored for past runs
      perTurnNote:
        "The per-turn curator output isn't stored on past runs (wiki state changes over time). Re-run this probe to capture it live.",
    },
    userMessage: probe.input,
    modelConfig: {
      model: effective.model,
      maxTokens: effective.maxTokens,
      cacheControl: effective.cacheControl,
      temperature: effective.temperature ?? null,
      topP: effective.topP ?? null,
    },
  };

  // ── Reconstruct the judge request ────────────────────────────────
  // The Probe object on the snapshot was passed into the suite at run
  // time. Pull the full probe definition from the suite row so we have
  // the rubric / expectations (the probe_result table doesn't store them).
  const suite = await getEvalStore().getSuite(run.suiteId);
  const suiteProbes = (suite?.probes ?? []) as Array<{
    id: string;
    category: string;
    input: string;
    rubric: string;
    expectations?: Record<string, unknown>;
    passThreshold?: number;
  }>;
  const fullProbe = suiteProbes.find((p) => p.id === probeId);

  const judgeRequest = fullProbe
    ? {
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        userPrompt: buildJudgeUserPrompt({
          probe: fullProbe as Parameters<typeof buildJudgeUserPrompt>[0]["probe"],
          response: probe.response,
          characterTitle: snap.characterTitle,
          characterIdentityEssence: snap.identity?.essence ?? null,
        }),
        judgeModel: run.judgeModel,
      }
    : null;

  return NextResponse.json({
    runId,
    probeId,
    probeCategory: probe.probeCategory,
    characterRequest,
    characterResponse: probe.response,
    judgeRequest,
    judgeResponse: {
      scores: probe.scores,
      overall: probe.overall,
      pass: probe.pass,
      rationale: probe.rationale,
    },
    mechanicalFailures: probe.mechanicalFailures,
    errors: probe.errors,
    timing: {
      latencyMs: probe.latencyMs,
      tokens: probe.tokens,
    },
  });
}
