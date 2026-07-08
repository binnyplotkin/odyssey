import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { evalSuitesTable, evalRunsTable, evalProbeResultsTable, evalSweepsTable, } from "./schema";
/** Bump a semver MAJOR.MINOR.PATCH by one segment. Trims any pre-release
 * tail (e.g. "1.0.0-rc.1" → "1.0.0" first). */
function bumpSemver(version, kind = "minor") {
    var _a;
    const clean = (_a = version.split("-")[0]) !== null && _a !== void 0 ? _a : version;
    const parts = clean.split(".").map((p) => parseInt(p, 10));
    while (parts.length < 3)
        parts.push(0);
    const [maj, min, pat] = parts.map((n) => (Number.isFinite(n) ? n : 0));
    if (kind === "major")
        return `${maj + 1}.0.0`;
    if (kind === "patch")
        return `${maj}.${min}.${pat + 1}`;
    return `${maj}.${min + 1}.0`;
}
/* ── Shared helpers (mirror character-store.ts patterns) ──────── */
function requireDb() {
    const db = getDb();
    if (!db)
        throw new Error("DATABASE_URL is required for the eval store");
    return db;
}
function isMissingTableError(error) {
    var _a, _b;
    const code = (_a = error === null || error === void 0 ? void 0 : error.code) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.code;
    return code === "42P01";
}
function isRecoverableReadError(error) {
    var _a, _b, _c;
    if (isMissingTableError(error))
        return true;
    const message = (_c = (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.message) !== null && _c !== void 0 ? _c : "";
    return message.includes("Failed query:");
}
function toIso(d) {
    return d instanceof Date ? d.toISOString() : d;
}
/* ── Row → record normalizers ───────────────────────────────────── */
function normalizeSuite(row) {
    var _a, _b, _c, _d, _e;
    return {
        id: String(row.id),
        characterId: String(row.characterId),
        slug: String(row.slug),
        version: String(row.version),
        probes: (_a = row.probes) !== null && _a !== void 0 ? _a : [],
        notes: (_b = row.notes) !== null && _b !== void 0 ? _b : null,
        releaseNotes: (_c = row.releaseNotes) !== null && _c !== void 0 ? _c : null,
        publishedAt: row.publishedAt ? toIso(row.publishedAt) : null,
        forkedFromId: (_d = row.forkedFromId) !== null && _d !== void 0 ? _d : null,
        createdAt: toIso(row.createdAt),
        createdBy: (_e = row.createdBy) !== null && _e !== void 0 ? _e : null,
    };
}
function normalizeRun(row) {
    var _a, _b, _c, _d, _e, _f;
    return {
        id: String(row.id),
        characterId: String(row.characterId),
        suiteId: String(row.suiteId),
        characterSnapshot: row.characterSnapshot,
        configHash: String(row.configHash),
        overrideConfig: (_a = row.overrideConfig) !== null && _a !== void 0 ? _a : null,
        effectiveModelConfig: row.effectiveModelConfig,
        judgeModel: String(row.judgeModel),
        source: (_b = row.source) !== null && _b !== void 0 ? _b : "single",
        sweepId: (_c = row.sweepId) !== null && _c !== void 0 ? _c : null,
        status: (_d = row.status) !== null && _d !== void 0 ? _d : "completed",
        errorMessage: (_e = row.errorMessage) !== null && _e !== void 0 ? _e : null,
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
        startedAt: toIso(row.startedAt),
        completedAt: row.completedAt ? toIso(row.completedAt) : null,
        createdBy: (_f = row.createdBy) !== null && _f !== void 0 ? _f : null,
    };
}
function normalizeProbeResult(row) {
    var _a, _b;
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
        mechanicalFailures: (_a = row.mechanicalFailures) !== null && _a !== void 0 ? _a : [],
        errors: (_b = row.errors) !== null && _b !== void 0 ? _b : [],
        latencyMs: Number(row.latencyMs),
        tokens: row.tokens,
    };
}
function normalizeSweep(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return {
        id: String(row.id),
        characterId: String(row.characterId),
        suiteId: String(row.suiteId),
        judgeModel: String(row.judgeModel),
        spec: row.spec,
        probeIds: (_a = row.probeIds) !== null && _a !== void 0 ? _a : null,
        maxConcurrency: (_b = row.maxConcurrency) !== null && _b !== void 0 ? _b : null,
        configs: (_c = row.configs) !== null && _c !== void 0 ? _c : [],
        rankings: (_d = row.rankings) !== null && _d !== void 0 ? _d : [],
        pareto: (_e = row.pareto) !== null && _e !== void 0 ? _e : [],
        status: (_f = row.status) !== null && _f !== void 0 ? _f : "completed",
        errorMessage: (_g = row.errorMessage) !== null && _g !== void 0 ? _g : null,
        startedAt: toIso(row.startedAt),
        completedAt: row.completedAt ? toIso(row.completedAt) : null,
        createdBy: (_h = row.createdBy) !== null && _h !== void 0 ? _h : null,
    };
}
/* ── Implementation ─────────────────────────────────────────────── */
function neonStore() {
    return {
        async listSuites(characterId) {
            try {
                const rows = await retryRead(() => requireDb()
                    .select()
                    .from(evalSuitesTable)
                    .where(eq(evalSuitesTable.characterId, characterId))
                    .orderBy(desc(evalSuitesTable.createdAt)));
                return rows.map(normalizeSuite);
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async getSuite(id) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(evalSuitesTable)
                    .where(eq(evalSuitesTable.id, id))
                    .limit(1));
                return row ? normalizeSuite(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async getLatestSuiteBySlug(characterId, slug) {
            try {
                // V5: only consider PUBLISHED rows. A draft shouldn't shadow a
                // published version for the runner or the seed-script idempotency
                // check. Drafts are fetched via `getDraftBySlug`.
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(evalSuitesTable)
                    .where(and(eq(evalSuitesTable.characterId, characterId), eq(evalSuitesTable.slug, slug), sql `${evalSuitesTable.publishedAt} IS NOT NULL`))
                    // Most recently PUBLISHED — same effective behavior as before
                    // for the existing data (everything is published) but stable
                    // for the post-V5 world where drafts exist.
                    .orderBy(desc(evalSuitesTable.publishedAt))
                    .limit(1));
                return row ? normalizeSuite(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async createSuite(input) {
            var _a, _b;
            // `createSuite` is the seed-script entry point — it produces a fully
            // published row. Drafts go through `forkDraft` instead.
            const [row] = await requireDb()
                .insert(evalSuitesTable)
                .values({
                characterId: input.characterId,
                slug: input.slug,
                version: input.version,
                probes: input.probes,
                notes: (_a = input.notes) !== null && _a !== void 0 ? _a : null,
                publishedAt: new Date(),
                createdBy: (_b = input.createdBy) !== null && _b !== void 0 ? _b : null,
            })
                .returning();
            return normalizeSuite(row);
        },
        async getDraftBySlug(characterId, slug) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(evalSuitesTable)
                    .where(and(eq(evalSuitesTable.characterId, characterId), eq(evalSuitesTable.slug, slug), isNull(evalSuitesTable.publishedAt)))
                    .limit(1));
                return row ? normalizeSuite(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async forkDraft(input) {
            var _a, _b;
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
                throw new Error(`cannot fork from an unpublished draft (suite ${input.sourceId} is itself a draft)`);
            }
            const nextVersion = (_a = input.version) !== null && _a !== void 0 ? _a : bumpSemver(String(source.version), "minor");
            try {
                const [row] = await requireDb()
                    .insert(evalSuitesTable)
                    .values({
                    characterId: String(source.characterId),
                    slug: String(source.slug),
                    version: nextVersion,
                    // Copy probes by reference (jsonb is structurally copied by Drizzle).
                    probes: source.probes,
                    notes: source.notes,
                    releaseNotes: null,
                    publishedAt: null,
                    forkedFromId: source.id,
                    createdBy: (_b = input.createdBy) !== null && _b !== void 0 ? _b : null,
                })
                    .returning();
                return normalizeSuite(row);
            }
            catch (err) {
                // 23505 = unique_violation. Surface a friendly message — almost
                // certainly the partial unique index catching a double-draft.
                const code = err === null || err === void 0 ? void 0 : err.code;
                if (code === "23505") {
                    throw new Error(`a draft for ${source.slug} already exists — open the existing draft or discard it first`);
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
            if (!existing)
                throw new Error(`suite not found: ${suiteId}`);
            if (existing.publishedAt) {
                throw new Error(`suite ${suiteId} is published and immutable — fork it to make changes`);
            }
            const patch = {};
            if (input.probes !== undefined)
                patch.probes = input.probes;
            if (input.releaseNotes !== undefined)
                patch.releaseNotes = input.releaseNotes;
            // No fields to update → just return current state to keep callers simple.
            if (Object.keys(patch).length === 0)
                return normalizeSuite(existing);
            const [row] = await requireDb()
                .update(evalSuitesTable)
                .set(patch)
                .where(eq(evalSuitesTable.id, suiteId))
                .returning();
            return normalizeSuite(row);
        },
        async publishDraft(suiteId, input) {
            var _a;
            const [existing] = await requireDb()
                .select()
                .from(evalSuitesTable)
                .where(eq(evalSuitesTable.id, suiteId))
                .limit(1);
            if (!existing)
                throw new Error(`suite not found: ${suiteId}`);
            if (existing.publishedAt) {
                throw new Error(`suite ${suiteId} is already published (${existing.publishedAt})`);
            }
            const finalVersion = (_a = input === null || input === void 0 ? void 0 : input.version) !== null && _a !== void 0 ? _a : String(existing.version);
            // Check version uniqueness explicitly before the UPDATE — the
            // existing (character_id, slug, version) unique index will catch
            // this too, but we want the clearer error message.
            if (finalVersion !== existing.version) {
                const [conflict] = await requireDb()
                    .select()
                    .from(evalSuitesTable)
                    .where(and(eq(evalSuitesTable.characterId, String(existing.characterId)), eq(evalSuitesTable.slug, String(existing.slug)), eq(evalSuitesTable.version, finalVersion)))
                    .limit(1);
                if (conflict) {
                    throw new Error(`version ${finalVersion} already exists for ${String(existing.slug)} — pick a different version`);
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
            if (!existing)
                throw new Error(`suite not found: ${suiteId}`);
            if (existing.publishedAt) {
                throw new Error(`cannot delete a published suite — historical runs FK to it. Fork a new draft instead.`);
            }
            await requireDb()
                .delete(evalSuitesTable)
                .where(eq(evalSuitesTable.id, suiteId));
        },
        async listRuns(opts) {
            var _a, _b;
            const limit = Math.min((_a = opts.limit) !== null && _a !== void 0 ? _a : 20, 100);
            const offset = (_b = opts.offset) !== null && _b !== void 0 ? _b : 0;
            const conditions = [eq(evalRunsTable.characterId, opts.characterId)];
            if (opts.configHash)
                conditions.push(eq(evalRunsTable.configHash, opts.configHash));
            if (opts.sweepId)
                conditions.push(eq(evalRunsTable.sweepId, opts.sweepId));
            try {
                const rows = await retryRead(() => requireDb()
                    .select()
                    .from(evalRunsTable)
                    .where(and(...conditions))
                    .orderBy(desc(evalRunsTable.startedAt))
                    .limit(limit)
                    .offset(offset));
                return rows.map(normalizeRun);
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async getRun(id) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(evalRunsTable)
                    .where(eq(evalRunsTable.id, id))
                    .limit(1));
                return row ? normalizeRun(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async getRunWithProbes(id) {
            try {
                const [run] = await retryRead(() => requireDb()
                    .select()
                    .from(evalRunsTable)
                    .where(eq(evalRunsTable.id, id))
                    .limit(1));
                if (!run)
                    return null;
                const probes = await retryRead(() => requireDb()
                    .select()
                    .from(evalProbeResultsTable)
                    .where(eq(evalProbeResultsTable.runId, id))
                    .orderBy(evalProbeResultsTable.probeId));
                return Object.assign(Object.assign({}, normalizeRun(run)), { probes: probes.map(normalizeProbeResult) });
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async saveRun(input) {
            var _a, _b, _c, _d;
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
                overrideConfig: (_a = input.overrideConfig) !== null && _a !== void 0 ? _a : null,
                effectiveModelConfig: input.effectiveModelConfig,
                judgeModel: input.judgeModel,
                source: (_b = input.source) !== null && _b !== void 0 ? _b : "single",
                sweepId: (_c = input.sweepId) !== null && _c !== void 0 ? _c : null,
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
                createdBy: (_d = input.createdBy) !== null && _d !== void 0 ? _d : null,
            })
                .returning();
            if (input.probes.length > 0) {
                await db.insert(evalProbeResultsTable).values(input.probes.map((p) => ({
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
                })));
            }
            return normalizeRun(runRow);
        },
        async createPendingRun(input) {
            var _a, _b, _c, _d;
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
                overrideConfig: (_a = input.overrideConfig) !== null && _a !== void 0 ? _a : null,
                effectiveModelConfig: input.effectiveModelConfig,
                judgeModel: input.judgeModel,
                source: (_b = input.source) !== null && _b !== void 0 ? _b : "single",
                sweepId: (_c = input.sweepId) !== null && _c !== void 0 ? _c : null,
                status: "pending",
                startedAt: new Date(),
                completedAt: null,
                createdBy: (_d = input.createdBy) !== null && _d !== void 0 ? _d : null,
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
                await db.insert(evalProbeResultsTable).values(input.probes.map((p) => ({
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
                })));
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
                const rows = await retryRead(() => requireDb()
                    .select()
                    .from(evalSweepsTable)
                    .where(eq(evalSweepsTable.characterId, characterId))
                    .orderBy(desc(evalSweepsTable.startedAt)));
                return rows.map(normalizeSweep);
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async getSweep(id) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(evalSweepsTable)
                    .where(eq(evalSweepsTable.id, id))
                    .limit(1));
                return row ? normalizeSweep(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async getSweepRuns(sweepId) {
            try {
                const rows = await retryRead(() => requireDb()
                    .select()
                    .from(evalRunsTable)
                    .where(eq(evalRunsTable.sweepId, sweepId))
                    // Same sort the sweep ranker uses: passed desc, avg desc, latency asc.
                    .orderBy(desc(evalRunsTable.passed), desc(evalRunsTable.avgOverall), evalRunsTable.avgLatencyMs));
                return rows.map(normalizeRun);
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async saveSweep(input) {
            var _a, _b, _c, _d, _e;
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
                probeIds: (_a = input.probeIds) !== null && _a !== void 0 ? _a : null,
                maxConcurrency: (_b = input.maxConcurrency) !== null && _b !== void 0 ? _b : null,
                configs: input.configs,
                rankings: input.rankings,
                pareto: input.pareto,
                startedAt: new Date(input.startedAt),
                completedAt: new Date(input.completedAt),
                createdBy: (_c = input.createdBy) !== null && _c !== void 0 ? _c : null,
            })
                .returning();
            const runIds = [];
            for (const r of input.runs) {
                const [runRow] = await db
                    .insert(evalRunsTable)
                    .values({
                    characterId: input.characterId,
                    suiteId: input.suiteId,
                    characterSnapshot: r.characterSnapshot,
                    configHash: r.configHash,
                    overrideConfig: (_d = r.overrideConfig) !== null && _d !== void 0 ? _d : null,
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
                    createdBy: (_e = r.createdBy) !== null && _e !== void 0 ? _e : null,
                })
                    .returning();
                if (r.probes.length > 0) {
                    await db.insert(evalProbeResultsTable).values(r.probes.map((p) => ({
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
                    })));
                }
                runIds.push(runRow.id);
            }
            return { sweepId: sweepRow.id, runIds };
        },
        async createPendingSweep(input) {
            var _a, _b, _c;
            const [row] = await requireDb()
                .insert(evalSweepsTable)
                .values({
                characterId: input.characterId,
                suiteId: input.suiteId,
                judgeModel: input.judgeModel,
                spec: input.spec,
                probeIds: (_a = input.probeIds) !== null && _a !== void 0 ? _a : null,
                maxConcurrency: (_b = input.maxConcurrency) !== null && _b !== void 0 ? _b : null,
                configs: input.configs,
                rankings: [],
                pareto: [],
                status: "pending",
                startedAt: new Date(),
                completedAt: null,
                createdBy: (_c = input.createdBy) !== null && _c !== void 0 ? _c : null,
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
                const rows = await retryRead(() => requireDb()
                    .select({
                    startedAt: evalRunsTable.startedAt,
                    passed: evalRunsTable.passed,
                    total: evalRunsTable.total,
                })
                    .from(evalRunsTable)
                    .where(eq(evalRunsTable.characterId, characterId))
                    .orderBy(desc(evalRunsTable.startedAt))
                    .limit(Math.min(limit, 50)));
                return rows
                    .map((r) => ({
                    startedAt: toIso(r.startedAt),
                    passed: Number(r.passed),
                    total: Number(r.total),
                    passRate: r.total ? Number(r.passed) / Number(r.total) : 0,
                }))
                    // Return oldest→newest so the sparkline reads left-to-right.
                    .reverse();
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
    };
}
let cached = null;
export function getEvalStore() {
    if (!cached)
        cached = neonStore();
    return cached;
}
// Re-exported for tests / scripts that want to bypass the singleton.
export { neonStore as _neonEvalStore };
// sql import kept for completeness — used by future queries (e.g. percentile
// rollups) where we'd reach past Drizzle's typed helpers.
void sql;
