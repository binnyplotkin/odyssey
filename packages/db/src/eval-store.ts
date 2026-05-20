import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  evalSuitesTable,
  evalRunsTable,
  evalProbeResultsTable,
  evalSweepsTable,
} from "./schema";

/** Bump a semver MAJOR.MINOR.PATCH by one segment. Trims any pre-release
 * tail (e.g. "1.0.0-rc.1" → "1.0.0" first). */
function bumpSemver(version: string, kind: "major" | "minor" | "patch" = "minor"): string {
  const clean = version.split("-")[0] ?? version;
  const parts = clean.split(".").map((p) => parseInt(p, 10));
  while (parts.length < 3) parts.push(0);
  const [maj, min, pat] = parts.map((n) => (Number.isFinite(n) ? n : 0));
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  return `${maj}.${min + 1}.0`;
}

/**
 * Persistence layer for @odyssey/evals. See docs/eval-schema.mdx for the
 * design write-up; the gist:
 *
 *   eval_suites          versioned probe definitions, scoped to a character
 *   eval_runs            one per single-config execution; summary denormalized
 *   eval_probe_results   per-probe drill-down (response, scores, judge rationale)
 *   eval_sweeps          one per parameter grid; rankings + pareto denormalized
 *
 * eval_runs.sweep_id links a run back to its parent sweep when source = "sweep".
 *
 * Read methods follow the same graceful-fallback pattern as character-store:
 * a missing table (fresh DB before the migration ran) or a transient Neon
 * hiccup returns null/[] instead of a 500, so the UI degrades cleanly.
 */

/* ── Public record shapes ───────────────────────────────────────── */

export type EvalSuiteRecord = {
  id: string;
  characterId: string;
  slug: string;
  version: string;
  probes: unknown[];
  notes: string | null;
  releaseNotes: string | null;
  /** Null = editable draft. Set = immutable published version. */
  publishedAt: string | null;
  /** Provenance: the suite id this row was forked from (null on first version). */
  forkedFromId: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type EvalRunSummary = {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  avgOverall: number;
  avgLatencyMs: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

export type EvalRunStatus = "pending" | "running" | "completed" | "errored";

export type EvalRunRecord = {
  id: string;
  characterId: string;
  suiteId: string;
  characterSnapshot: unknown;
  configHash: string;
  overrideConfig: unknown | null;
  effectiveModelConfig: unknown;
  judgeModel: string;
  source: "single" | "sweep";
  sweepId: string | null;
  /** Lifecycle. See schema.ts for transitions. */
  status: EvalRunStatus;
  errorMessage: string | null;
  summary: EvalRunSummary;
  startedAt: string;
  /** Null while pending/running. */
  completedAt: string | null;
  createdBy: string | null;
};

export type EvalProbeResultRecord = {
  id: string;
  runId: string;
  probeId: string;
  probeCategory: string;
  input: string;
  response: string;
  scores: unknown;
  overall: number;
  pass: boolean;
  rationale: string;
  mechanicalFailures: string[];
  errors: string[];
  latencyMs: number;
  tokens: unknown;
};

export type EvalRunWithProbes = EvalRunRecord & {
  probes: EvalProbeResultRecord[];
};

export type EvalSweepRecord = {
  id: string;
  characterId: string;
  suiteId: string;
  judgeModel: string;
  spec: unknown;
  probeIds: string[] | null;
  maxConcurrency: number | null;
  configs: unknown[];
  rankings: unknown[];
  pareto: unknown[];
  status: EvalRunStatus;
  errorMessage: string | null;
  startedAt: string;
  /** Null while pending/running. */
  completedAt: string | null;
  createdBy: string | null;
};

export type PassRatePoint = {
  startedAt: string;
  passed: number;
  total: number;
  passRate: number;
};

/* ── Input shapes ───────────────────────────────────────────────── */

export type CreateEvalSuiteInput = {
  characterId: string;
  slug: string;
  version: string;
  probes: unknown[];
  notes?: string | null;
  createdBy?: string | null;
};

export type ForkDraftInput = {
  sourceId: string;
  /** Override the auto-computed next version (default = source.version + 0.1.0). */
  version?: string;
  createdBy?: string | null;
};

export type UpdateDraftInput = {
  /** Partial — only fields present are updated. */
  probes?: unknown[];
  releaseNotes?: string | null;
};

export type PublishDraftInput = {
  /** Final version string. Validated to match draft.version unless caller
   * explicitly bumps via UI. */
  version?: string;
};

export type SaveEvalRunInput = {
  characterId: string;
  suiteId: string;
  characterSnapshot: unknown;
  configHash: string;
  overrideConfig?: unknown | null;
  effectiveModelConfig: unknown;
  judgeModel: string;
  source?: "single" | "sweep";
  sweepId?: string | null;
  summary: EvalRunSummary;
  probes: Array<Omit<EvalProbeResultRecord, "id" | "runId">>;
  startedAt: string;
  completedAt: string;
  createdBy?: string | null;
};

export type SaveEvalSweepInput = {
  characterId: string;
  suiteId: string;
  judgeModel: string;
  spec: unknown;
  probeIds?: string[] | null;
  maxConcurrency?: number | null;
  configs: unknown[];
  rankings: unknown[];
  pareto: unknown[];
  /** The child runs — one per config. Inserted with sweep_id pointing here. */
  runs: Array<Omit<SaveEvalRunInput, "characterId" | "suiteId" | "judgeModel" | "sweepId" | "source"> & {
    /** Stable config id from the sweep grid, e.g. "sonnet-4-5__t0.7". */
    configId: string;
  }>;
  startedAt: string;
  completedAt: string;
  createdBy?: string | null;
};

export type ListRunsOptions = {
  characterId: string;
  /** Default 20, max 100. */
  limit?: number;
  offset?: number;
  /** When set, only runs with this config hash (= same effective config). */
  configHash?: string;
  /** When set, only runs from this parent sweep. */
  sweepId?: string;
};

/**
 * Insert a placeholder run row so the UI can show "pending" immediately
 * after the launch button is clicked. The fields here are what we know
 * before the runner actually runs — everything else (summary, probes,
 * completedAt) is filled in via `completeRun`.
 */
export type CreatePendingRunInput = {
  characterId: string;
  suiteId: string;
  characterSnapshot: unknown;
  configHash: string;
  overrideConfig?: unknown | null;
  effectiveModelConfig: unknown;
  judgeModel: string;
  source?: "single" | "sweep";
  sweepId?: string | null;
  createdBy?: string | null;
};

export type CompleteRunInput = {
  summary: EvalRunSummary;
  probes: Array<Omit<EvalProbeResultRecord, "id" | "runId">>;
  completedAt: string;
};

export type CreatePendingSweepInput = {
  characterId: string;
  suiteId: string;
  judgeModel: string;
  spec: unknown;
  probeIds?: string[] | null;
  maxConcurrency?: number | null;
  configs: unknown[];
  createdBy?: string | null;
};

export type CompleteSweepInput = {
  rankings: unknown[];
  pareto: unknown[];
  completedAt: string;
};

/* ── Shared helpers (mirror character-store.ts patterns) ──────── */

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the eval store");
  return db;
}

function isMissingTableError(error: unknown) {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

function isRecoverableReadError(error: unknown) {
  if (isMissingTableError(error)) return true;
  const message =
    (error as { message?: string })?.message ??
    (error as { cause?: { message?: string } })?.cause?.message ??
    "";
  return message.includes("Failed query:");
}


function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : d;
}

/* ── Row → record normalizers ───────────────────────────────────── */

function normalizeSuite(row: Record<string, unknown>): EvalSuiteRecord {
  return {
    id: String(row.id),
    characterId: String(row.characterId),
    slug: String(row.slug),
    version: String(row.version),
    probes: (row.probes as unknown[]) ?? [],
    notes: (row.notes as string | null) ?? null,
    releaseNotes: (row.releaseNotes as string | null) ?? null,
    publishedAt: row.publishedAt ? toIso(row.publishedAt as Date | string) : null,
    forkedFromId: (row.forkedFromId as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string),
    createdBy: (row.createdBy as string | null) ?? null,
  };
}

function normalizeRun(row: Record<string, unknown>): EvalRunRecord {
  return {
    id: String(row.id),
    characterId: String(row.characterId),
    suiteId: String(row.suiteId),
    characterSnapshot: row.characterSnapshot,
    configHash: String(row.configHash),
    overrideConfig: row.overrideConfig ?? null,
    effectiveModelConfig: row.effectiveModelConfig,
    judgeModel: String(row.judgeModel),
    source: (row.source as "single" | "sweep") ?? "single",
    sweepId: (row.sweepId as string | null) ?? null,
    status: (row.status as EvalRunStatus) ?? "completed",
    errorMessage: (row.errorMessage as string | null) ?? null,
    summary: {
      total: Number(row.total),
      passed: Number(row.passed),
      failed: Number(row.failed),
      errored: Number(row.errored),
      avgOverall: Number(row.avgOverall),
      avgLatencyMs: Number(row.avgLatencyMs),
      totalTokens: Number(row.totalTokens),
      estimatedCostUsd: Number(row.estimatedCostUsd),
    },
    startedAt: toIso(row.startedAt as Date | string),
    completedAt: row.completedAt ? toIso(row.completedAt as Date | string) : null,
    createdBy: (row.createdBy as string | null) ?? null,
  };
}

function normalizeProbeResult(row: Record<string, unknown>): EvalProbeResultRecord {
  return {
    id: String(row.id),
    runId: String(row.runId),
    probeId: String(row.probeId),
    probeCategory: String(row.probeCategory),
    input: String(row.input),
    response: String(row.response),
    scores: row.scores,
    overall: Number(row.overall),
    pass: Boolean(row.pass),
    rationale: String(row.rationale),
    mechanicalFailures: (row.mechanicalFailures as string[]) ?? [],
    errors: (row.errors as string[]) ?? [],
    latencyMs: Number(row.latencyMs),
    tokens: row.tokens,
  };
}

function normalizeSweep(row: Record<string, unknown>): EvalSweepRecord {
  return {
    id: String(row.id),
    characterId: String(row.characterId),
    suiteId: String(row.suiteId),
    judgeModel: String(row.judgeModel),
    spec: row.spec,
    probeIds: (row.probeIds as string[] | null) ?? null,
    maxConcurrency: (row.maxConcurrency as number | null) ?? null,
    configs: (row.configs as unknown[]) ?? [],
    rankings: (row.rankings as unknown[]) ?? [],
    pareto: (row.pareto as unknown[]) ?? [],
    status: (row.status as EvalRunStatus) ?? "completed",
    errorMessage: (row.errorMessage as string | null) ?? null,
    startedAt: toIso(row.startedAt as Date | string),
    completedAt: row.completedAt ? toIso(row.completedAt as Date | string) : null,
    createdBy: (row.createdBy as string | null) ?? null,
  };
}

/* ── Public interface ───────────────────────────────────────────── */

export interface EvalStore {
  // Suites
  listSuites(characterId: string): Promise<EvalSuiteRecord[]>;
  getSuite(id: string): Promise<EvalSuiteRecord | null>;
  getLatestSuiteBySlug(characterId: string, slug: string): Promise<EvalSuiteRecord | null>;
  /** Returns the (at most one) editable draft for this slug, or null. */
  getDraftBySlug(characterId: string, slug: string): Promise<EvalSuiteRecord | null>;
  createSuite(input: CreateEvalSuiteInput): Promise<EvalSuiteRecord>;
  /** Forks a published suite into a new draft row. Throws if a draft for
   * the same (character, slug) already exists — the partial unique index
   * enforces this at DB level too. */
  forkDraft(input: ForkDraftInput): Promise<EvalSuiteRecord>;
  /** Mutates a draft's probes / release notes. Throws if the suite has
   * been published (published_at IS NOT NULL). */
  updateDraft(suiteId: string, input: UpdateDraftInput): Promise<EvalSuiteRecord>;
  /** Flips published_at = now(), making the row immutable. Throws on
   * version conflicts (another publish of the same version exists). */
  publishDraft(suiteId: string, input?: PublishDraftInput): Promise<EvalSuiteRecord>;
  /** Throws if the suite has been published. Use only for un-published drafts. */
  deleteDraft(suiteId: string): Promise<void>;

  // Runs
  listRuns(opts: ListRunsOptions): Promise<EvalRunRecord[]>;
  getRun(id: string): Promise<EvalRunRecord | null>;
  getRunWithProbes(id: string): Promise<EvalRunWithProbes | null>;
  saveRun(input: SaveEvalRunInput): Promise<EvalRunRecord>;
  /** Two-step: createPendingRun returns immediately, then completeRun /
   * markRunErrored finishes the lifecycle. Used by the UI-driven launcher
   * so the activity feed can show a spinning row while the eval runs. */
  createPendingRun(input: CreatePendingRunInput): Promise<EvalRunRecord>;
  markRunRunning(runId: string, total: number): Promise<void>;
  completeRun(runId: string, input: CompleteRunInput): Promise<EvalRunRecord>;
  markRunErrored(runId: string, errorMessage: string): Promise<void>;

  // Sweeps
  listSweeps(characterId: string): Promise<EvalSweepRecord[]>;
  getSweep(id: string): Promise<EvalSweepRecord | null>;
  getSweepRuns(sweepId: string): Promise<EvalRunRecord[]>;
  saveSweep(input: SaveEvalSweepInput): Promise<{ sweepId: string; runIds: string[] }>;
  /** Same two-step pattern as runs. createPendingSweep returns the sweep id;
   * each child config is created via createPendingRun(..., sweepId) so the
   * parent's "configs" list and the actual child rows stay in sync. */
  createPendingSweep(input: CreatePendingSweepInput): Promise<EvalSweepRecord>;
  completeSweep(sweepId: string, input: CompleteSweepInput): Promise<EvalSweepRecord>;
  markSweepErrored(sweepId: string, errorMessage: string): Promise<void>;

  // Trend (used by the runs-list sparkline on the Evals page)
  getPassRateTrend(characterId: string, limit?: number): Promise<PassRatePoint[]>;
}

/* ── Implementation ─────────────────────────────────────────────── */

function neonStore(): EvalStore {
  return {
    async listSuites(characterId) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select()
            .from(evalSuitesTable)
            .where(eq(evalSuitesTable.characterId, characterId))
            .orderBy(desc(evalSuitesTable.createdAt)),
        );
        return rows.map(normalizeSuite);
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async getSuite(id) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(evalSuitesTable)
            .where(eq(evalSuitesTable.id, id))
            .limit(1),
        );
        return row ? normalizeSuite(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async getLatestSuiteBySlug(characterId, slug) {
      try {
        // V5: only consider PUBLISHED rows. A draft shouldn't shadow a
        // published version for the runner or the seed-script idempotency
        // check. Drafts are fetched via `getDraftBySlug`.
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(evalSuitesTable)
            .where(
              and(
                eq(evalSuitesTable.characterId, characterId),
                eq(evalSuitesTable.slug, slug),
                sql`${evalSuitesTable.publishedAt} IS NOT NULL`,
              ),
            )
            // Most recently PUBLISHED — same effective behavior as before
            // for the existing data (everything is published) but stable
            // for the post-V5 world where drafts exist.
            .orderBy(desc(evalSuitesTable.publishedAt))
            .limit(1),
        );
        return row ? normalizeSuite(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async createSuite(input) {
      // `createSuite` is the seed-script entry point — it produces a fully
      // published row. Drafts go through `forkDraft` instead.
      const [row] = await requireDb()
        .insert(evalSuitesTable)
        .values({
          characterId: input.characterId,
          slug: input.slug,
          version: input.version,
          probes: input.probes,
          notes: input.notes ?? null,
          publishedAt: new Date(),
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return normalizeSuite(row);
    },

    async getDraftBySlug(characterId, slug) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(evalSuitesTable)
            .where(
              and(
                eq(evalSuitesTable.characterId, characterId),
                eq(evalSuitesTable.slug, slug),
                isNull(evalSuitesTable.publishedAt),
              ),
            )
            .limit(1),
        );
        return row ? normalizeSuite(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async forkDraft(input) {
      // Look up the source suite to copy its probes and compute the next
      // version. Source must be published — forking from a draft would
      // create two drafts (the partial unique index catches this anyway).
      const [source] = await requireDb()
        .select()
        .from(evalSuitesTable)
        .where(eq(evalSuitesTable.id, input.sourceId))
        .limit(1);
      if (!source) {
        throw new Error(`source suite not found: ${input.sourceId}`);
      }
      if (!source.publishedAt) {
        throw new Error(
          `cannot fork from an unpublished draft (suite ${input.sourceId} is itself a draft)`,
        );
      }

      const nextVersion = input.version ?? bumpSemver(String(source.version), "minor");

      try {
        const [row] = await requireDb()
          .insert(evalSuitesTable)
          .values({
            characterId: String(source.characterId),
            slug: String(source.slug),
            version: nextVersion,
            // Copy probes by reference (jsonb is structurally copied by Drizzle).
            probes: source.probes as unknown,
            notes: source.notes,
            releaseNotes: null,
            publishedAt: null,
            forkedFromId: source.id,
            createdBy: input.createdBy ?? null,
          })
          .returning();
        return normalizeSuite(row);
      } catch (err) {
        // 23505 = unique_violation. Surface a friendly message — almost
        // certainly the partial unique index catching a double-draft.
        const code = (err as { code?: string })?.code;
        if (code === "23505") {
          throw new Error(
            `a draft for ${source.slug} already exists — open the existing draft or discard it first`,
          );
        }
        throw err;
      }
    },

    async updateDraft(suiteId, input) {
      // Verify draft status before mutating — the SQL UPDATE itself can't
      // distinguish "row not found" from "row is published" without a
      // second read, so we do the read explicitly for the clearer error.
      const [existing] = await requireDb()
        .select()
        .from(evalSuitesTable)
        .where(eq(evalSuitesTable.id, suiteId))
        .limit(1);
      if (!existing) throw new Error(`suite not found: ${suiteId}`);
      if (existing.publishedAt) {
        throw new Error(
          `suite ${suiteId} is published and immutable — fork it to make changes`,
        );
      }

      const patch: Record<string, unknown> = {};
      if (input.probes !== undefined) patch.probes = input.probes;
      if (input.releaseNotes !== undefined) patch.releaseNotes = input.releaseNotes;
      // No fields to update → just return current state to keep callers simple.
      if (Object.keys(patch).length === 0) return normalizeSuite(existing);

      const [row] = await requireDb()
        .update(evalSuitesTable)
        .set(patch)
        .where(eq(evalSuitesTable.id, suiteId))
        .returning();
      return normalizeSuite(row);
    },

    async publishDraft(suiteId, input) {
      const [existing] = await requireDb()
        .select()
        .from(evalSuitesTable)
        .where(eq(evalSuitesTable.id, suiteId))
        .limit(1);
      if (!existing) throw new Error(`suite not found: ${suiteId}`);
      if (existing.publishedAt) {
        throw new Error(`suite ${suiteId} is already published (${existing.publishedAt})`);
      }

      const finalVersion = input?.version ?? String(existing.version);

      // Check version uniqueness explicitly before the UPDATE — the
      // existing (character_id, slug, version) unique index will catch
      // this too, but we want the clearer error message.
      if (finalVersion !== existing.version) {
        const [conflict] = await requireDb()
          .select()
          .from(evalSuitesTable)
          .where(
            and(
              eq(evalSuitesTable.characterId, String(existing.characterId)),
              eq(evalSuitesTable.slug, String(existing.slug)),
              eq(evalSuitesTable.version, finalVersion),
            ),
          )
          .limit(1);
        if (conflict) {
          throw new Error(
            `version ${finalVersion} already exists for ${String(existing.slug)} — pick a different version`,
          );
        }
      }

      const [row] = await requireDb()
        .update(evalSuitesTable)
        .set({
          publishedAt: new Date(),
          version: finalVersion,
        })
        .where(eq(evalSuitesTable.id, suiteId))
        .returning();
      return normalizeSuite(row);
    },

    async deleteDraft(suiteId) {
      const [existing] = await requireDb()
        .select()
        .from(evalSuitesTable)
        .where(eq(evalSuitesTable.id, suiteId))
        .limit(1);
      if (!existing) throw new Error(`suite not found: ${suiteId}`);
      if (existing.publishedAt) {
        throw new Error(
          `cannot delete a published suite — historical runs FK to it. Fork a new draft instead.`,
        );
      }
      await requireDb()
        .delete(evalSuitesTable)
        .where(eq(evalSuitesTable.id, suiteId));
    },

    async listRuns(opts) {
      const limit = Math.min(opts.limit ?? 20, 100);
      const offset = opts.offset ?? 0;

      const conditions = [eq(evalRunsTable.characterId, opts.characterId)];
      if (opts.configHash) conditions.push(eq(evalRunsTable.configHash, opts.configHash));
      if (opts.sweepId) conditions.push(eq(evalRunsTable.sweepId, opts.sweepId));

      try {
        const rows = await retryRead(() =>
          requireDb()
            .select()
            .from(evalRunsTable)
            .where(and(...conditions))
            .orderBy(desc(evalRunsTable.startedAt))
            .limit(limit)
            .offset(offset),
        );
        return rows.map(normalizeRun);
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async getRun(id) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(evalRunsTable)
            .where(eq(evalRunsTable.id, id))
            .limit(1),
        );
        return row ? normalizeRun(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async getRunWithProbes(id) {
      try {
        const [run] = await retryRead(() =>
          requireDb()
            .select()
            .from(evalRunsTable)
            .where(eq(evalRunsTable.id, id))
            .limit(1),
        );
        if (!run) return null;

        const probes = await retryRead(() =>
          requireDb()
            .select()
            .from(evalProbeResultsTable)
            .where(eq(evalProbeResultsTable.runId, id))
            .orderBy(evalProbeResultsTable.probeId),
        );

        return {
          ...normalizeRun(run),
          probes: probes.map(normalizeProbeResult),
        };
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async saveRun(input) {
      const db = requireDb();

      // Sequential writes — the Neon HTTP driver doesn't support transactions
      // (only the WebSocket driver does, and adopting WS just for this would
      // be heavy). Worst case: run row inserts but probe inserts fail, leaving
      // a run with empty probes. The UI handles this gracefully (shows the
      // run summary, "0 probe results" in the detail pane); the user can
      // re-run via the "Re-run" button.
      const [runRow] = await db
        .insert(evalRunsTable)
        .values({
          characterId: input.characterId,
          suiteId: input.suiteId,
          characterSnapshot: input.characterSnapshot,
          configHash: input.configHash,
          overrideConfig: input.overrideConfig ?? null,
          effectiveModelConfig: input.effectiveModelConfig,
          judgeModel: input.judgeModel,
          source: input.source ?? "single",
          sweepId: input.sweepId ?? null,
          total: input.summary.total,
          passed: input.summary.passed,
          failed: input.summary.failed,
          errored: input.summary.errored,
          avgOverall: input.summary.avgOverall,
          avgLatencyMs: input.summary.avgLatencyMs,
          totalTokens: input.summary.totalTokens,
          estimatedCostUsd: input.summary.estimatedCostUsd,
          startedAt: new Date(input.startedAt),
          completedAt: new Date(input.completedAt),
          createdBy: input.createdBy ?? null,
        })
        .returning();

      if (input.probes.length > 0) {
        await db.insert(evalProbeResultsTable).values(
          input.probes.map((p) => ({
            runId: runRow.id,
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
        );
      }

      return normalizeRun(runRow);
    },

    async createPendingRun(input) {
      // Inserts the run row with status="pending" and zeroed summary so the
      // UI can render the row immediately. The actual eval runs in the
      // background and calls completeRun / markRunErrored later.
      const [row] = await requireDb()
        .insert(evalRunsTable)
        .values({
          characterId: input.characterId,
          suiteId: input.suiteId,
          characterSnapshot: input.characterSnapshot,
          configHash: input.configHash,
          overrideConfig: input.overrideConfig ?? null,
          effectiveModelConfig: input.effectiveModelConfig,
          judgeModel: input.judgeModel,
          source: input.source ?? "single",
          sweepId: input.sweepId ?? null,
          status: "pending",
          startedAt: new Date(),
          completedAt: null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return normalizeRun(row);
    },

    async markRunRunning(runId, total) {
      // Captures the probe count as soon as the runner knows it — lets the
      // UI show "0 of 20" while the run is mid-flight rather than just "0".
      await requireDb()
        .update(evalRunsTable)
        .set({ status: "running", total })
        .where(eq(evalRunsTable.id, runId));
    },

    async completeRun(runId, input) {
      const db = requireDb();
      const [row] = await db
        .update(evalRunsTable)
        .set({
          status: "completed",
          total: input.summary.total,
          passed: input.summary.passed,
          failed: input.summary.failed,
          errored: input.summary.errored,
          avgOverall: input.summary.avgOverall,
          avgLatencyMs: input.summary.avgLatencyMs,
          totalTokens: input.summary.totalTokens,
          estimatedCostUsd: input.summary.estimatedCostUsd,
          completedAt: new Date(input.completedAt),
        })
        .where(eq(evalRunsTable.id, runId))
        .returning();

      if (input.probes.length > 0) {
        await db.insert(evalProbeResultsTable).values(
          input.probes.map((p) => ({
            runId,
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
        );
      }

      return normalizeRun(row);
    },

    async markRunErrored(runId, errorMessage) {
      await requireDb()
        .update(evalRunsTable)
        .set({
          status: "errored",
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(evalRunsTable.id, runId));
    },

    async listSweeps(characterId) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select()
            .from(evalSweepsTable)
            .where(eq(evalSweepsTable.characterId, characterId))
            .orderBy(desc(evalSweepsTable.startedAt)),
        );
        return rows.map(normalizeSweep);
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async getSweep(id) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(evalSweepsTable)
            .where(eq(evalSweepsTable.id, id))
            .limit(1),
        );
        return row ? normalizeSweep(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async getSweepRuns(sweepId) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select()
            .from(evalRunsTable)
            .where(eq(evalRunsTable.sweepId, sweepId))
            // Same sort the sweep ranker uses: passed desc, avg desc, latency asc.
            .orderBy(desc(evalRunsTable.passed), desc(evalRunsTable.avgOverall), evalRunsTable.avgLatencyMs),
        );
        return rows.map(normalizeRun);
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async saveSweep(input) {
      const db = requireDb();
      // Sequential writes — Neon HTTP driver doesn't support transactions.
      // If a child run insert fails partway, the sweep row exists with fewer
      // runs than configs.length. The sweep detail UI reads from configs (the
      // intended grid) and joins to runs (what actually completed), so it
      // degrades to "9 of 9 planned · 6 ran" rather than a hard failure.
      const [sweepRow] = await db
        .insert(evalSweepsTable)
        .values({
          characterId: input.characterId,
          suiteId: input.suiteId,
          judgeModel: input.judgeModel,
          spec: input.spec,
          probeIds: input.probeIds ?? null,
          maxConcurrency: input.maxConcurrency ?? null,
          configs: input.configs,
          rankings: input.rankings,
          pareto: input.pareto,
          startedAt: new Date(input.startedAt),
          completedAt: new Date(input.completedAt),
          createdBy: input.createdBy ?? null,
        })
        .returning();

      const runIds: string[] = [];
      for (const r of input.runs) {
        const [runRow] = await db
          .insert(evalRunsTable)
          .values({
            characterId: input.characterId,
            suiteId: input.suiteId,
            characterSnapshot: r.characterSnapshot,
            configHash: r.configHash,
            overrideConfig: r.overrideConfig ?? null,
            effectiveModelConfig: r.effectiveModelConfig,
            judgeModel: input.judgeModel,
            source: "sweep",
            sweepId: sweepRow.id,
            total: r.summary.total,
            passed: r.summary.passed,
            failed: r.summary.failed,
            errored: r.summary.errored,
            avgOverall: r.summary.avgOverall,
            avgLatencyMs: r.summary.avgLatencyMs,
            totalTokens: r.summary.totalTokens,
            estimatedCostUsd: r.summary.estimatedCostUsd,
            startedAt: new Date(r.startedAt),
            completedAt: new Date(r.completedAt),
            createdBy: r.createdBy ?? null,
          })
          .returning();

        if (r.probes.length > 0) {
          await db.insert(evalProbeResultsTable).values(
            r.probes.map((p) => ({
              runId: runRow.id,
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
          );
        }
        runIds.push(runRow.id);
      }

      return { sweepId: sweepRow.id, runIds };
    },

    async createPendingSweep(input) {
      const [row] = await requireDb()
        .insert(evalSweepsTable)
        .values({
          characterId: input.characterId,
          suiteId: input.suiteId,
          judgeModel: input.judgeModel,
          spec: input.spec,
          probeIds: input.probeIds ?? null,
          maxConcurrency: input.maxConcurrency ?? null,
          configs: input.configs,
          rankings: [],
          pareto: [],
          status: "pending",
          startedAt: new Date(),
          completedAt: null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return normalizeSweep(row);
    },

    async completeSweep(sweepId, input) {
      const [row] = await requireDb()
        .update(evalSweepsTable)
        .set({
          status: "completed",
          rankings: input.rankings,
          pareto: input.pareto,
          completedAt: new Date(input.completedAt),
        })
        .where(eq(evalSweepsTable.id, sweepId))
        .returning();
      return normalizeSweep(row);
    },

    async markSweepErrored(sweepId, errorMessage) {
      await requireDb()
        .update(evalSweepsTable)
        .set({
          status: "errored",
          errorMessage,
          completedAt: new Date(),
        })
        .where(eq(evalSweepsTable.id, sweepId));
    },

    async getPassRateTrend(characterId, limit = 14) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select({
              startedAt: evalRunsTable.startedAt,
              passed: evalRunsTable.passed,
              total: evalRunsTable.total,
            })
            .from(evalRunsTable)
            .where(eq(evalRunsTable.characterId, characterId))
            .orderBy(desc(evalRunsTable.startedAt))
            .limit(Math.min(limit, 50)),
        );
        return rows
          .map((r) => ({
            startedAt: toIso(r.startedAt as Date | string),
            passed: Number(r.passed),
            total: Number(r.total),
            passRate: r.total ? Number(r.passed) / Number(r.total) : 0,
          }))
          // Return oldest→newest so the sparkline reads left-to-right.
          .reverse();
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },
  };
}

let cached: EvalStore | null = null;

export function getEvalStore(): EvalStore {
  if (!cached) cached = neonStore();
  return cached;
}

// Re-exported for tests / scripts that want to bypass the singleton.
export { neonStore as _neonEvalStore };

// sql import kept for completeness — used by future queries (e.g. percentile
// rollups) where we'd reach past Drizzle's typed helpers.
void sql;
