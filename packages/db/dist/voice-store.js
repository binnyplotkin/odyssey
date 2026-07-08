import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, voicesTable, voicePreviewsTable, voiceExtractionAttemptsTable, } from "./schema";
function requireDb() {
    const db = getDb();
    if (!db)
        throw new Error("DATABASE_URL is required for the voice store");
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
    return d instanceof Date ? d.toISOString() : String(d);
}
function toIsoNullable(d) {
    if (d == null)
        return null;
    return toIso(d);
}
function normalize(row) {
    var _a, _b, _c;
    return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        provider: (_a = row.provider) !== null && _a !== void 0 ? _a : "pocket_tts",
        providerConfig: (_b = row.providerConfig) !== null && _b !== void 0 ? _b : {},
        status: row.status,
        statusError: row.statusError,
        sourcePath: row.sourcePath,
        embeddingPath: row.embeddingPath,
        previewPath: row.previewPath,
        durationS: row.durationS,
        sampleRate: row.sampleRate,
        tags: (_c = row.tags) !== null && _c !== void 0 ? _c : [],
        language: row.language,
        gender: row.gender,
        license: row.license,
        attribution: row.attribution,
        archivedAt: toIsoNullable(row.archivedAt),
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}
function normalizePreview(row) {
    return {
        id: row.id,
        voiceId: row.voiceId,
        label: row.label,
        path: row.path,
        prompt: row.prompt,
        durationS: row.durationS,
        sampleRate: row.sampleRate,
        createdAt: toIso(row.createdAt),
    };
}
function normalizeAttempt(row) {
    return {
        id: row.id,
        voiceId: row.voiceId,
        attemptNumber: row.attemptNumber,
        status: row.status,
        error: row.error,
        startedAt: toIso(row.startedAt),
        finishedAt: toIsoNullable(row.finishedAt),
    };
}
function neonStore() {
    return {
        async list({ includeArchived = false } = {}) {
            try {
                const rows = await retryRead(() => {
                    const q = requireDb()
                        .select({
                        voice: voicesTable,
                        boundCount: sql `count(${charactersTable.id})::int`,
                        // First 4 bound characters as a json[] for the library card.
                        // The FILTER keeps the LEFT JOIN's NULL row out of the agg;
                        // the [1:4] slice caps payload size for voices with many
                        // bindings (think shared narrators); COALESCE handles voices
                        // with zero bindings (FILTER returns NULL not empty array).
                        boundCharacters: sql `
                COALESCE(
                  (array_agg(
                    json_build_object(
                      'id', ${charactersTable.id},
                      'title', ${charactersTable.title},
                      'thumbnailColor', ${charactersTable.thumbnailColor}
                    ) ORDER BY ${charactersTable.createdAt} ASC
                  ) FILTER (WHERE ${charactersTable.id} IS NOT NULL))[1:4],
                  ARRAY[]::json[]
                )
              `,
                    })
                        .from(voicesTable)
                        .leftJoin(charactersTable, eq(charactersTable.voiceId, voicesTable.id))
                        .groupBy(voicesTable.id)
                        .orderBy(desc(voicesTable.createdAt));
                    return includeArchived
                        ? q
                        : q.where(isNull(voicesTable.archivedAt));
                });
                return rows.map((r) => {
                    var _a;
                    return (Object.assign(Object.assign({}, normalize(r.voice)), { boundCharacterCount: r.boundCount, boundCharacters: (_a = r.boundCharacters) !== null && _a !== void 0 ? _a : [] }));
                });
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async getById(id) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(voicesTable)
                    .where(eq(voicesTable.id, id))
                    .limit(1));
                return row ? normalize(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async getBySlug(slug) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(voicesTable)
                    .where(eq(voicesTable.slug, slug))
                    .limit(1));
                return row ? normalize(row) : null;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return null;
                throw error;
            }
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            const db = requireDb();
            const now = new Date();
            const provider = (_a = input.provider) !== null && _a !== void 0 ? _a : "pocket_tts";
            const [row] = await db
                .insert(voicesTable)
                .values({
                slug: input.slug,
                name: input.name,
                description: (_b = input.description) !== null && _b !== void 0 ? _b : null,
                provider,
                providerConfig: (_c = input.providerConfig) !== null && _c !== void 0 ? _c : {},
                // Pocket goes through extraction → default to "uploaded".
                // Hosted providers skip extraction; default them to "ready" unless
                // the caller asks for something else.
                status: (_d = input.status) !== null && _d !== void 0 ? _d : (provider === "pocket_tts" ? "uploaded" : "ready"),
                sourcePath: (_e = input.sourcePath) !== null && _e !== void 0 ? _e : null,
                durationS: (_f = input.durationS) !== null && _f !== void 0 ? _f : null,
                sampleRate: (_g = input.sampleRate) !== null && _g !== void 0 ? _g : null,
                tags: (_h = input.tags) !== null && _h !== void 0 ? _h : [],
                language: (_j = input.language) !== null && _j !== void 0 ? _j : null,
                gender: (_k = input.gender) !== null && _k !== void 0 ? _k : null,
                license: (_l = input.license) !== null && _l !== void 0 ? _l : null,
                attribution: (_m = input.attribution) !== null && _m !== void 0 ? _m : null,
                createdBy: (_o = input.createdBy) !== null && _o !== void 0 ? _o : null,
                updatedBy: (_p = input.createdBy) !== null && _p !== void 0 ? _p : null,
                createdAt: now,
                updatedAt: now,
            })
                .returning();
            return normalize(row);
        },
        async update(id, input) {
            const db = requireDb();
            const values = { updatedAt: new Date() };
            for (const [k, v] of Object.entries(input)) {
                if (v !== undefined)
                    values[k] = v;
            }
            const [row] = await db
                .update(voicesTable)
                .set(values)
                .where(eq(voicesTable.id, id))
                .returning();
            return row ? normalize(row) : null;
        },
        async archive(id, archivedBy = null) {
            return this.update(id, { archivedAt: new Date(), updatedBy: archivedBy });
        },
        async unarchive(id, unarchivedBy = null) {
            return this.update(id, { archivedAt: null, updatedBy: unarchivedBy });
        },
        async remove(id) {
            const db = requireDb();
            const result = await db
                .delete(voicesTable)
                .where(eq(voicesTable.id, id))
                .returning();
            return result.length > 0;
        },
        async countCharactersUsing(voiceId) {
            var _a;
            try {
                const [row] = await retryRead(() => requireDb()
                    .select({ n: sql `count(*)::int` })
                    .from(charactersTable)
                    .where(eq(charactersTable.voiceId, voiceId)));
                return (_a = row === null || row === void 0 ? void 0 : row.n) !== null && _a !== void 0 ? _a : 0;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return 0;
                throw error;
            }
        },
        async listBoundCharacters(voiceId) {
            try {
                const rows = await retryRead(() => requireDb()
                    .select({
                    id: charactersTable.id,
                    slug: charactersTable.slug,
                    title: charactersTable.title,
                    summary: charactersTable.summary,
                    image: charactersTable.image,
                    thumbnailColor: charactersTable.thumbnailColor,
                })
                    .from(charactersTable)
                    .where(eq(charactersTable.voiceId, voiceId)));
                return rows;
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async listPreviews(voiceId) {
            try {
                const rows = await retryRead(() => requireDb()
                    .select()
                    .from(voicePreviewsTable)
                    .where(eq(voicePreviewsTable.voiceId, voiceId))
                    .orderBy(asc(voicePreviewsTable.createdAt)));
                return rows.map(normalizePreview);
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async addPreview(voiceId, input) {
            var _a, _b, _c;
            const db = requireDb();
            const [row] = await db
                .insert(voicePreviewsTable)
                .values({
                voiceId,
                label: input.label,
                path: input.path,
                prompt: (_a = input.prompt) !== null && _a !== void 0 ? _a : null,
                durationS: (_b = input.durationS) !== null && _b !== void 0 ? _b : null,
                sampleRate: (_c = input.sampleRate) !== null && _c !== void 0 ? _c : null,
            })
                .returning();
            return normalizePreview(row);
        },
        async removePreview(previewId) {
            const db = requireDb();
            const result = await db
                .delete(voicePreviewsTable)
                .where(eq(voicePreviewsTable.id, previewId))
                .returning();
            return result.length > 0;
        },
        async listAttempts(voiceId) {
            try {
                const rows = await retryRead(() => requireDb()
                    .select()
                    .from(voiceExtractionAttemptsTable)
                    .where(eq(voiceExtractionAttemptsTable.voiceId, voiceId))
                    .orderBy(desc(voiceExtractionAttemptsTable.attemptNumber)));
                return rows.map(normalizeAttempt);
            }
            catch (error) {
                if (isRecoverableReadError(error))
                    return [];
                throw error;
            }
        },
        async startAttempt(voiceId) {
            var _a, _b;
            const db = requireDb();
            // Compute next attempt number as MAX + 1. Cheap with the unique
            // index; a race that picks the same number falls back to the
            // unique-violation retry below.
            const next = await nextAttemptNumber(voiceId);
            try {
                const [row] = await db
                    .insert(voiceExtractionAttemptsTable)
                    .values({
                    voiceId,
                    attemptNumber: next,
                    status: "processing",
                    startedAt: new Date(),
                })
                    .returning();
                return normalizeAttempt(row);
            }
            catch (error) {
                // Unique-violation under concurrent extraction kicks — recompute
                // once and retry. If it fails again, surface the error.
                const code = (_a = error === null || error === void 0 ? void 0 : error.code) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.code;
                if (code !== "23505")
                    throw error;
                const retry = await nextAttemptNumber(voiceId);
                const [row] = await db
                    .insert(voiceExtractionAttemptsTable)
                    .values({
                    voiceId,
                    attemptNumber: retry,
                    status: "processing",
                    startedAt: new Date(),
                })
                    .returning();
                return normalizeAttempt(row);
            }
        },
        async finishAttempt(attemptId, { status, error = null }) {
            const db = requireDb();
            const [row] = await db
                .update(voiceExtractionAttemptsTable)
                .set({ status, error, finishedAt: new Date() })
                .where(eq(voiceExtractionAttemptsTable.id, attemptId))
                .returning();
            return row ? normalizeAttempt(row) : null;
        },
    };
}
async function nextAttemptNumber(voiceId) {
    var _a;
    const [row] = await retryRead(() => requireDb()
        .select({
        max: sql `max(${voiceExtractionAttemptsTable.attemptNumber})`,
    })
        .from(voiceExtractionAttemptsTable)
        .where(eq(voiceExtractionAttemptsTable.voiceId, voiceId)));
    return ((_a = row === null || row === void 0 ? void 0 : row.max) !== null && _a !== void 0 ? _a : 0) + 1;
}
let _store = null;
export function getVoiceStore() {
    if (!_store)
        _store = neonStore();
    return _store;
}
// Helper exports for callers that need to mirror attempt status onto
// `voices.status` in a single transaction-equivalent flow.
export const VOICE_STATUS_FROM_ATTEMPT = {
    processing: "processing",
    succeeded: "ready",
    failed: "failed",
};
