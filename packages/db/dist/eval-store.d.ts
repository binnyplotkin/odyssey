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
export interface EvalStore {
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
    listSweeps(characterId: string): Promise<EvalSweepRecord[]>;
    getSweep(id: string): Promise<EvalSweepRecord | null>;
    getSweepRuns(sweepId: string): Promise<EvalRunRecord[]>;
    saveSweep(input: SaveEvalSweepInput): Promise<{
        sweepId: string;
        runIds: string[];
    }>;
    /** Same two-step pattern as runs. createPendingSweep returns the sweep id;
     * each child config is created via createPendingRun(..., sweepId) so the
     * parent's "configs" list and the actual child rows stay in sync. */
    createPendingSweep(input: CreatePendingSweepInput): Promise<EvalSweepRecord>;
    completeSweep(sweepId: string, input: CompleteSweepInput): Promise<EvalSweepRecord>;
    markSweepErrored(sweepId: string, errorMessage: string): Promise<void>;
    getPassRateTrend(characterId: string, limit?: number): Promise<PassRatePoint[]>;
}
declare function neonStore(): EvalStore;
export declare function getEvalStore(): EvalStore;
export { neonStore as _neonEvalStore };
//# sourceMappingURL=eval-store.d.ts.map