var _a;
import { eq, desc } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { platformVersionsTable } from "./schema";
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
const globalPlatformVersions = (_a = globalThis.__odysseyPlatformVersions) !== null && _a !== void 0 ? _a : (globalThis.__odysseyPlatformVersions = new Map());
function memoryStore() {
    return {
        async list() {
            return Array.from(globalPlatformVersions.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        async getById(id) {
            var _a;
            return (_a = globalPlatformVersions.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async getByVersion(version) {
            for (const r of globalPlatformVersions.values()) {
                if (r.version === version)
                    return r;
            }
            return null;
        },
        async create(input) {
            var _a, _b;
            const now = toIso(new Date());
            const record = {
                id: crypto.randomUUID(),
                version: input.version,
                title: input.title,
                summary: (_a = input.summary) !== null && _a !== void 0 ? _a : null,
                status: (_b = input.status) !== null && _b !== void 0 ? _b : "draft",
                releasedAt: null,
                createdAt: now,
                updatedAt: now,
            };
            globalPlatformVersions.set(record.id, record);
            return record;
        },
        async update(id, input) {
            const existing = globalPlatformVersions.get(id);
            if (!existing)
                return null;
            const updated = Object.assign(Object.assign(Object.assign({}, existing), input), { updatedAt: toIso(new Date()) });
            globalPlatformVersions.set(id, updated);
            return updated;
        },
        async remove(id) {
            return globalPlatformVersions.delete(id);
        },
    };
}
/* ── Neon implementation ──────────────────────────────────────── */
function neonStore() {
    function normalize(row) {
        return {
            id: row.id,
            version: row.version,
            title: row.title,
            summary: row.summary,
            status: row.status,
            releasedAt: row.releasedAt instanceof Date ? toIso(row.releasedAt) : row.releasedAt ? String(row.releasedAt) : null,
            createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
            updatedAt: row.updatedAt instanceof Date ? toIso(row.updatedAt) : String(row.updatedAt),
        };
    }
    return {
        async list() {
            const db = getDb();
            if (!db)
                return memoryStore().list();
            try {
                const rows = await retryRead(() => db.select().from(platformVersionsTable).orderBy(desc(platformVersionsTable.createdAt)));
                return rows.map(normalize);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().list();
                throw e;
            }
        },
        async getById(id) {
            const db = getDb();
            if (!db)
                return memoryStore().getById(id);
            try {
                const [row] = await retryRead(() => db.select().from(platformVersionsTable).where(eq(platformVersionsTable.id, id)).limit(1));
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getById(id);
                throw e;
            }
        },
        async getByVersion(version) {
            const db = getDb();
            if (!db)
                return memoryStore().getByVersion(version);
            try {
                const [row] = await retryRead(() => db.select().from(platformVersionsTable).where(eq(platformVersionsTable.version, version)).limit(1));
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getByVersion(version);
                throw e;
            }
        },
        async create(input) {
            var _a, _b;
            const db = getDb();
            if (!db)
                return memoryStore().create(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(platformVersionsTable)
                    .values({
                    version: input.version,
                    title: input.title,
                    summary: (_a = input.summary) !== null && _a !== void 0 ? _a : null,
                    status: (_b = input.status) !== null && _b !== void 0 ? _b : "draft",
                    createdAt: now,
                    updatedAt: now,
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
                const values = { updatedAt: new Date() };
                for (const [k, v] of Object.entries(input)) {
                    if (k !== "updatedAt" && v !== undefined)
                        values[k] = v;
                }
                const [row] = await db
                    .update(platformVersionsTable)
                    .set(values)
                    .where(eq(platformVersionsTable.id, id))
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
                const result = await db.delete(platformVersionsTable).where(eq(platformVersionsTable.id, id)).returning();
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
export function getPlatformVersionStore() {
    if (!_store) {
        _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
    }
    return _store;
}
