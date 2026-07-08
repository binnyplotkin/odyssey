var _a;
import { eq, desc } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { changelogEntriesTable } from "./schema";
/* ── Helpers ──────────────────────────────────────────────────── */
function toIso(d) {
    return d.toISOString();
}
function isMissingTable(e) {
    var _a, _b;
    const code = (_a = e === null || e === void 0 ? void 0 : e.code) !== null && _a !== void 0 ? _a : (_b = e === null || e === void 0 ? void 0 : e.cause) === null || _b === void 0 ? void 0 : _b.code;
    if (code === "42P01")
        return true;
    return e instanceof Error && e.message.includes("42P01");
}
/* ── Memory implementation ────────────────────────────────────── */
const globalChangelog = (_a = globalThis.__odysseyChangelog) !== null && _a !== void 0 ? _a : (globalThis.__odysseyChangelog = new Map());
function memoryStore() {
    return {
        async list(versionId) {
            let entries = Array.from(globalChangelog.values());
            if (versionId)
                entries = entries.filter((e) => e.versionId === versionId);
            return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        async getById(id) {
            var _a;
            return (_a = globalChangelog.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const now = toIso(new Date());
            const record = {
                id: crypto.randomUUID(),
                versionId: (_a = input.versionId) !== null && _a !== void 0 ? _a : null,
                title: input.title,
                body: (_b = input.body) !== null && _b !== void 0 ? _b : null,
                category: input.category,
                commitSha: (_c = input.commitSha) !== null && _c !== void 0 ? _c : null,
                prNumber: (_d = input.prNumber) !== null && _d !== void 0 ? _d : null,
                prTitle: (_e = input.prTitle) !== null && _e !== void 0 ? _e : null,
                branch: (_f = input.branch) !== null && _f !== void 0 ? _f : null,
                author: (_g = input.author) !== null && _g !== void 0 ? _g : null,
                diffSummary: (_h = input.diffSummary) !== null && _h !== void 0 ? _h : null,
                createdAt: now,
            };
            globalChangelog.set(record.id, record);
            return record;
        },
        async update(id, input) {
            const existing = globalChangelog.get(id);
            if (!existing)
                return null;
            const updated = Object.assign(Object.assign({}, existing), input);
            globalChangelog.set(id, updated);
            return updated;
        },
        async remove(id) {
            return globalChangelog.delete(id);
        },
    };
}
/* ── Neon implementation ──────────────────────────────────────── */
function neonStore() {
    function normalize(row) {
        return {
            id: row.id,
            versionId: row.versionId,
            title: row.title,
            body: row.body,
            category: row.category,
            commitSha: row.commitSha,
            prNumber: row.prNumber,
            prTitle: row.prTitle,
            branch: row.branch,
            author: row.author,
            diffSummary: row.diffSummary,
            createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
        };
    }
    return {
        async list(versionId) {
            const db = getDb();
            if (!db)
                return memoryStore().list(versionId);
            try {
                const rows = await retryRead(() => {
                    let query = db.select().from(changelogEntriesTable);
                    if (versionId) {
                        query = query.where(eq(changelogEntriesTable.versionId, versionId));
                    }
                    return query.orderBy(desc(changelogEntriesTable.createdAt));
                });
                return rows.map(normalize);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().list(versionId);
                throw e;
            }
        },
        async getById(id) {
            const db = getDb();
            if (!db)
                return memoryStore().getById(id);
            try {
                const [row] = await retryRead(() => db.select().from(changelogEntriesTable).where(eq(changelogEntriesTable.id, id)).limit(1));
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getById(id);
                throw e;
            }
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const db = getDb();
            if (!db)
                return memoryStore().create(input);
            try {
                const [row] = await db
                    .insert(changelogEntriesTable)
                    .values({
                    versionId: (_a = input.versionId) !== null && _a !== void 0 ? _a : null,
                    title: input.title,
                    body: (_b = input.body) !== null && _b !== void 0 ? _b : null,
                    category: input.category,
                    commitSha: (_c = input.commitSha) !== null && _c !== void 0 ? _c : null,
                    prNumber: (_d = input.prNumber) !== null && _d !== void 0 ? _d : null,
                    prTitle: (_e = input.prTitle) !== null && _e !== void 0 ? _e : null,
                    branch: (_f = input.branch) !== null && _f !== void 0 ? _f : null,
                    author: (_g = input.author) !== null && _g !== void 0 ? _g : null,
                    diffSummary: (_h = input.diffSummary) !== null && _h !== void 0 ? _h : null,
                })
                    .returning();
                return normalize(row);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().create(input);
                throw e;
            }
        },
        async update(id, input) {
            const db = getDb();
            if (!db)
                return memoryStore().update(id, input);
            try {
                const values = {};
                for (const [k, v] of Object.entries(input)) {
                    if (v !== undefined)
                        values[k] = v;
                }
                const [row] = await db
                    .update(changelogEntriesTable)
                    .set(values)
                    .where(eq(changelogEntriesTable.id, id))
                    .returning();
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().update(id, input);
                throw e;
            }
        },
        async remove(id) {
            const db = getDb();
            if (!db)
                return memoryStore().remove(id);
            try {
                const result = await db.delete(changelogEntriesTable).where(eq(changelogEntriesTable.id, id)).returning();
                return result.length > 0;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().remove(id);
                throw e;
            }
        },
    };
}
/* ── Factory ─────────────────────────────────────────────────── */
let _store = null;
export function getChangelogStore() {
    if (!_store) {
        _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
    }
    return _store;
}
