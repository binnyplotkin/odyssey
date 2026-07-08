import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, worldNodesTable } from "./schema";
/* ── Shared helpers ─────────────────────────────────────────────── */
function toIso(d) {
    return d.toISOString();
}
function requireDb() {
    const db = getDb();
    if (!db)
        throw new Error("DATABASE_URL is required for the character store");
    return db;
}
function isMissingCharactersTableError(error) {
    var _a, _b;
    const code = (_a = error === null || error === void 0 ? void 0 : error.code) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.code;
    return code === "42P01";
}
/**
 * Wider catch-and-return-null guard for "expected" read failures: missing
 * table (fresh DB) plus the Neon driver's generic "Failed query:" wrapper
 * — used at the read-method boundary so the UI gets `null` / `[]` instead
 * of a 500 in those cases.
 */
function isRecoverableCharacterReadError(error) {
    var _a, _b, _c;
    if (isMissingCharactersTableError(error))
        return true;
    const message = (_c = (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.message) !== null && _c !== void 0 ? _c : "";
    return message.includes("Failed query:");
}
function normalize(row) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        image: row.image,
        thumbnailColor: row.thumbnailColor,
        eras: (_a = row.eras) !== null && _a !== void 0 ? _a : [],
        ingestionPrompt: row.ingestionPrompt,
        identity: (_b = row.identity) !== null && _b !== void 0 ? _b : null,
        voiceStyle: (_c = row.voiceStyle) !== null && _c !== void 0 ? _c : null,
        brainModel: (_d = row.brainModel) !== null && _d !== void 0 ? _d : null,
        directive: (_e = row.directive) !== null && _e !== void 0 ? _e : null,
        voiceId: (_f = row.voiceId) !== null && _f !== void 0 ? _f : null,
        voiceSettings: (_g = row.voiceSettings) !== null && _g !== void 0 ? _g : null,
        createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
        updatedAt: row.updatedAt instanceof Date ? toIso(row.updatedAt) : String(row.updatedAt),
    };
}
/* ── Implementation ─────────────────────────────────────────────── */
function neonStore() {
    return {
        async list() {
            try {
                const rows = await retryRead(() => requireDb().select().from(charactersTable));
                return rows
                    .map(normalize)
                    .sort((a, b) => a.title.localeCompare(b.title));
            }
            catch (error) {
                if (isRecoverableCharacterReadError(error))
                    return [];
                throw error;
            }
        },
        async getById(id) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(charactersTable)
                    .where(eq(charactersTable.id, id))
                    .limit(1));
                return row ? normalize(row) : null;
            }
            catch (error) {
                if (isRecoverableCharacterReadError(error))
                    return null;
                throw error;
            }
        },
        async getBySlug(slug) {
            try {
                const [row] = await retryRead(() => requireDb()
                    .select()
                    .from(charactersTable)
                    .where(eq(charactersTable.slug, slug))
                    .limit(1));
                return row ? normalize(row) : null;
            }
            catch (error) {
                if (isRecoverableCharacterReadError(error))
                    return null;
                throw error;
            }
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j;
            const db = requireDb();
            const now = new Date();
            const [row] = await db
                .insert(charactersTable)
                .values({
                slug: input.slug,
                title: input.title,
                summary: (_a = input.summary) !== null && _a !== void 0 ? _a : null,
                image: (_b = input.image) !== null && _b !== void 0 ? _b : null,
                thumbnailColor: (_c = input.thumbnailColor) !== null && _c !== void 0 ? _c : null,
                eras: (_d = input.eras) !== null && _d !== void 0 ? _d : [],
                ingestionPrompt: (_e = input.ingestionPrompt) !== null && _e !== void 0 ? _e : null,
                identity: (_f = input.identity) !== null && _f !== void 0 ? _f : null,
                voiceStyle: (_g = input.voiceStyle) !== null && _g !== void 0 ? _g : null,
                brainModel: (_h = input.brainModel) !== null && _h !== void 0 ? _h : null,
                directive: (_j = input.directive) !== null && _j !== void 0 ? _j : null,
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
                if (k !== "updatedAt" && v !== undefined)
                    values[k] = v;
            }
            const [row] = await db
                .update(charactersTable)
                .set(values)
                .where(eq(charactersTable.id, id))
                .returning();
            return row ? normalize(row) : null;
        },
        async remove(id) {
            const db = requireDb();
            const result = await db
                .delete(charactersTable)
                .where(eq(charactersTable.id, id))
                .returning();
            return result.length > 0;
        },
        async countWorldsFor(characterId) {
            var _a;
            try {
                const [row] = await retryRead(() => requireDb()
                    .select({ n: sql `count(distinct ${worldNodesTable.worldId})::int` })
                    .from(worldNodesTable)
                    .where(and(eq(worldNodesTable.kind, "character"), eq(worldNodesTable.refId, characterId))));
                return (_a = row === null || row === void 0 ? void 0 : row.n) !== null && _a !== void 0 ? _a : 0;
            }
            catch (error) {
                if (isRecoverableCharacterReadError(error))
                    return 0;
                throw error;
            }
        },
    };
}
/* ── Factory ───────────────────────────────────────────────────── */
let _store = null;
export function getCharacterStore() {
    if (!_store)
        _store = neonStore();
    return _store;
}
