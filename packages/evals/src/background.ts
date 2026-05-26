/**
 * Background launchers — wrap the eval runner/sweeper with the DB lifecycle
 * (pending → running → completed/errored) so the harness UI can fire-and-
 * forget an eval and watch it progress via polling.
 *
 * Call from an API route like:
 *
 *   const { runId } = await launchEvalRunInBackground({ characterId, ... });
 *   return NextResponse.json({ runId });   // returns immediately
 *
 * The runner keeps executing in the Node process after the response is
 * sent. On Vercel serverless this needs `waitUntil(promise)` from
 * `@vercel/functions`; on self-hosted Node the unawaited Promise just keeps
 * running. The functions below return a `{ runId, promise }` tuple so the
 * caller can wire `waitUntil(promise)` if they need to.
 */

import { getCharacterStore, getEvalStore, type CharacterBrainModel } from "@odyssey/db";
import { runEvalSuite } from "./runner";
import { runEvalSweep } from "./sweep";
import { captureCharacterSnapshot } from "./snapshot";
import { writeEvalRun, writeEvalRunToDb, writeSweepResult, writeSweepResultToDb } from "./reporter";
import type { ProbeSuite } from "./types";
import type { SweepSpec } from "./sweep";

export type LaunchRunInput = {
  characterId: string;
  suite: ProbeSuite;
  overrideConfig?: Partial<CharacterBrainModel>;
  judgeModel?: string;
  probeIds?: string[];
  maxConcurrency?: number;
  /** If true, also write to file (for parity with CLI). Default true. */
  writeFiles?: boolean;
};

export type LaunchSweepInput = Omit<LaunchRunInput, "overrideConfig"> & {
  sweep: SweepSpec;
};

export type LaunchedRun = {
  runId: string;
  /** Resolves when the run finishes (success OR error). Always resolves —
   * the launcher catches everything and writes terminal state to the DB. */
  promise: Promise<void>;
};

export type LaunchedSweep = {
  sweepId: string;
  promise: Promise<void>;
};

/**
 * Launch a single-config eval run. Returns the new runId immediately;
 * the eval continues in the background and updates DB row status as it
 * progresses.
 *
 * Sequence:
 *   1. Look up character + suite, validate
 *   2. Capture snapshot, compute effective config
 *   3. Insert pending row → return runId
 *   4. Run the eval (in the returned promise)
 *   5. Update DB row: running → completed (or errored)
 *   6. Mirror to file if requested (parity with CLI)
 */
export async function launchEvalRunInBackground(input: LaunchRunInput): Promise<LaunchedRun> {
  const character = await getCharacterStore().getById(input.characterId);
  if (!character) throw new Error(`character not found: ${input.characterId}`);

  const store = getEvalStore();
  const suiteRow = await store.getLatestSuiteBySlug(input.characterId, input.suite.id);
  if (!suiteRow) {
    throw new Error(`no published suite for "${input.suite.id}" — run the seed script first`);
  }
  if (suiteRow.version !== input.suite.version) {
    throw new Error(
      `suite version mismatch: requested v${input.suite.version}, latest published is v${suiteRow.version}`,
    );
  }

  // Snapshot + effective config — pre-computed here so the pending row
  // carries everything the UI needs to render the "in progress" state.
  const snapshot = captureCharacterSnapshot(character);
  const effective = mergeModelConfig(character.brainModel, input.overrideConfig);

  const pending = await store.createPendingRun({
    characterId: character.id,
    suiteId: suiteRow.id,
    characterSnapshot: snapshot,
    configHash: snapshot.configHash,
    overrideConfig: input.overrideConfig ?? null,
    effectiveModelConfig: effective,
    judgeModel: input.judgeModel ?? "claude-opus-4-5",
  });

  const promise = (async () => {
    try {
      const opts: Parameters<typeof runEvalSuite>[0] = {
        characterSlug: character.slug,
        character,
        suite: input.suite,
        onProgress: (e) => {
          if (e.kind === "snapshot") {
            // Total probe count is fixed — flip the pending row to running
            // as soon as we know it (before any probe completes).
            void store.markRunRunning(pending.id, input.suite.probes.length);
          }
        },
      };
      if (input.overrideConfig) opts.overrideConfig = input.overrideConfig;
      if (input.judgeModel) opts.judgeModel = input.judgeModel;
      if (input.probeIds) opts.probeIds = input.probeIds;
      if (typeof input.maxConcurrency === "number") opts.maxConcurrency = input.maxConcurrency;

      const run = await runEvalSuite(opts);

      // The runner returns a self-contained EvalRun with its own id —
      // we ignore that and write the results into our pending row instead,
      // so the runId returned at launch time stays valid.
      await store.completeRun(pending.id, {
        summary: run.summary,
        probes: run.probes.map((p) => ({
          probeId: p.probeId,
          probeCategory: p.probeCategory,
          input: p.input,
          response: p.response,
          scores: p.scores,
          overall: p.overall,
          pass: p.pass,
          rationale: p.rationale,
          mechanicalFailures: p.mechanicalFailures,
          errors: p.errors,
          latencyMs: p.latencyMs,
          tokens: p.tokens,
        })),
        completedAt: run.completedAt,
      });

      if (input.writeFiles !== false) {
        // Parity with the CLI: also write the JSON + Markdown artifacts.
        try {
          writeEvalRun(run);
        } catch (err) {
          // File write failures don't matter for correctness — DB is source
          // of truth. Log to stderr so operators can see disk issues.
          console.warn(`[evals] file write failed for run ${pending.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[evals] background run ${pending.id} failed: ${msg}`);
      await store.markRunErrored(pending.id, msg).catch(() => {
        // If the DB itself is unreachable when we try to record the error,
        // there's nothing left to do. The pending row will show as stale
        // and an operator can clean it up.
      });
    }
  })();

  return { runId: pending.id, promise };
}

/**
 * Launch a parameter sweep. Same fire-and-forget pattern; rankings + Pareto
 * are computed at the end and written via `completeSweep`. While the sweep
 * is running, child config runs are NOT yet inserted (they all land at the
 * end with the parent sweep_id) — the UI sees the sweep row in "running"
 * state and child runs appear as a batch when it completes.
 *
 * Future enhancement: insert child runs incrementally so the page can show
 * "5 of 9 configs done" granularity. For v3 the sweep is atomic from the
 * UI's perspective.
 */
export async function launchEvalSweepInBackground(input: LaunchSweepInput): Promise<LaunchedSweep> {
  const character = await getCharacterStore().getById(input.characterId);
  if (!character) throw new Error(`character not found: ${input.characterId}`);

  const store = getEvalStore();
  const suiteRow = await store.getLatestSuiteBySlug(input.characterId, input.suite.id);
  if (!suiteRow) {
    throw new Error(`no published suite for "${input.suite.id}" — run the seed script first`);
  }
  if (suiteRow.version !== input.suite.version) {
    throw new Error(
      `suite version mismatch: requested v${input.suite.version}, latest published is v${suiteRow.version}`,
    );
  }

  // Expand the grid up-front so the pending row's `configs` field is final.
  // Importing `expandSweep` from "./sweep" would create a cycle (sweep
  // imports background → background imports sweep); cleaner to call the
  // public re-export from index.ts at call sites, but here we inline.
  const { expandSweep } = await import("./sweep");
  const configs = expandSweep(input.sweep);

  const pending = await store.createPendingSweep({
    characterId: character.id,
    suiteId: suiteRow.id,
    judgeModel: input.judgeModel ?? "claude-opus-4-5",
    spec: input.sweep,
    probeIds: input.probeIds ?? null,
    maxConcurrency: input.maxConcurrency ?? null,
    configs,
  });

  const promise = (async () => {
    try {
      const opts: Parameters<typeof runEvalSweep>[0] = {
        characterSlug: character.slug,
        suite: input.suite,
        sweep: input.sweep,
      };
      if (input.judgeModel) opts.judgeModel = input.judgeModel;
      if (input.probeIds) opts.probeIds = input.probeIds;
      if (typeof input.maxConcurrency === "number") opts.maxConcurrency = input.maxConcurrency;

      const result = await runEvalSweep(opts);

      // Persist the full sweep — this writes the sweep row + all child runs.
      // The sweep row we created above with status="pending" is REPLACED by
      // the saveSweep insert; we need to delete it first OR change saveSweep
      // to update-or-insert. Simpler path: complete + persist child runs.
      await store.completeSweep(pending.id, {
        rankings: result.rankings,
        pareto: result.pareto,
        completedAt: result.completedAt,
      });

      // Write each child run with sweepId pointing to our pending sweep.
      // Use saveRun (single insert) so we don't create a duplicate sweep row.
      for (const run of result.runs) {
        await store.saveRun({
          characterId: character.id,
          suiteId: suiteRow.id,
          characterSnapshot: run.characterSnapshot,
          configHash: run.characterSnapshot.configHash,
          overrideConfig: run.overrideConfig,
          effectiveModelConfig: run.effectiveModelConfig,
          judgeModel: result.judgeModel,
          source: "sweep",
          sweepId: pending.id,
          summary: run.summary,
          probes: run.probes.map((p) => ({
            probeId: p.probeId,
            probeCategory: p.probeCategory,
            input: p.input,
            response: p.response,
            scores: p.scores,
            overall: p.overall,
            pass: p.pass,
            rationale: p.rationale,
            mechanicalFailures: p.mechanicalFailures,
            errors: p.errors,
            latencyMs: p.latencyMs,
            tokens: p.tokens,
          })),
          startedAt: run.startedAt,
          completedAt: run.completedAt,
        });
      }

      if (input.writeFiles !== false) {
        try {
          writeSweepResult(result);
          for (const r of result.runs) writeEvalRun(r);
        } catch (err) {
          console.warn(`[evals] file write failed for sweep ${pending.id}: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Suppress unused: writeEvalRunToDb / writeSweepResultToDb intentionally
      // not called — we used the lower-level store methods directly for the
      // create-then-complete dance.
      void writeEvalRunToDb;
      void writeSweepResultToDb;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[evals] background sweep ${pending.id} failed: ${msg}`);
      await store.markSweepErrored(pending.id, msg).catch(() => undefined);
    }
  })();

  return { sweepId: pending.id, promise };
}

/* ── Internal: mirror the runner's merge logic ──────────────────── */

function mergeModelConfig(
  base: CharacterBrainModel | null,
  override: Partial<CharacterBrainModel> | undefined,
): {
  model: string;
  maxTokens: number;
  cacheControl: boolean;
  temperature?: number;
  topP?: number;
} {
  const m = override ?? {};
  const result: { model: string; maxTokens: number; cacheControl: boolean; temperature?: number; topP?: number } = {
    model: m.model ?? base?.model ?? "claude-sonnet-4-5",
    maxTokens: m.maxTokens ?? base?.maxTokens ?? 1024,
    cacheControl: m.cacheControl ?? base?.cacheControl ?? true,
  };
  const t = m.temperature ?? base?.temperature;
  if (typeof t === "number") result.temperature = t;
  const p = m.topP ?? base?.topP;
  if (typeof p === "number") result.topP = p;
  return result;
}
