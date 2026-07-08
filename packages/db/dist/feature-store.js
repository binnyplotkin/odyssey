var _a;
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { featuresTable } from "./schema";
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
const globalFeatures = (_a = globalThis.__odysseyFeatures) !== null && _a !== void 0 ? _a : (globalThis.__odysseyFeatures = new Map());
function memoryStore() {
    return {
        async list(versionId) {
            let items = Array.from(globalFeatures.values());
            if (versionId)
                items = items.filter((f) => f.versionId === versionId);
            return items.sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        },
        async getById(id) {
            var _a;
            return (_a = globalFeatures.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f;
            const now = toIso(new Date());
            const record = {
                id: crypto.randomUUID(),
                versionId: input.versionId,
                title: input.title,
                description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
                color: (_b = input.color) !== null && _b !== void 0 ? _b : null,
                status: input.status,
                assignee: (_c = input.assignee) !== null && _c !== void 0 ? _c : null,
                startDate: (_d = input.startDate) !== null && _d !== void 0 ? _d : null,
                endDate: (_e = input.endDate) !== null && _e !== void 0 ? _e : null,
                sortOrder: (_f = input.sortOrder) !== null && _f !== void 0 ? _f : 0,
                createdAt: now,
                updatedAt: now,
            };
            globalFeatures.set(record.id, record);
            return record;
        },
        async update(id, input) {
            const existing = globalFeatures.get(id);
            if (!existing)
                return null;
            const updated = Object.assign(Object.assign(Object.assign({}, existing), input), { updatedAt: toIso(new Date()) });
            globalFeatures.set(id, updated);
            return updated;
        },
        async remove(id) {
            return globalFeatures.delete(id);
        },
    };
}
/* ── Neon (Postgres) implementation ──────────────────────────── */
function neonStore() {
    function normalize(row) {
        return {
            id: row.id,
            versionId: row.versionId,
            title: row.title,
            description: row.description,
            color: row.color,
            status: row.status,
            assignee: row.assignee,
            startDate: row.startDate,
            endDate: row.endDate,
            sortOrder: row.sortOrder,
            createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
            updatedAt: row.updatedAt instanceof Date ? toIso(row.updatedAt) : String(row.updatedAt),
        };
    }
    return {
        async list(versionId) {
            const db = getDb();
            if (!db)
                return memoryStore().list(versionId);
            try {
                const rows = await retryRead(() => versionId
                    ? db.select().from(featuresTable).where(eq(featuresTable.versionId, versionId))
                    : db.select().from(featuresTable));
                return rows.map(normalize).sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
                const [row] = await retryRead(() => db.select().from(featuresTable).where(eq(featuresTable.id, id)).limit(1));
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getById(id);
                throw e;
            }
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f;
            const db = getDb();
            if (!db)
                return memoryStore().create(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(featuresTable)
                    .values({
                    versionId: input.versionId,
                    title: input.title,
                    description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
                    color: (_b = input.color) !== null && _b !== void 0 ? _b : null,
                    status: input.status,
                    assignee: (_c = input.assignee) !== null && _c !== void 0 ? _c : null,
                    startDate: (_d = input.startDate) !== null && _d !== void 0 ? _d : null,
                    endDate: (_e = input.endDate) !== null && _e !== void 0 ? _e : null,
                    sortOrder: (_f = input.sortOrder) !== null && _f !== void 0 ? _f : 0,
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
                    .update(featuresTable)
                    .set(values)
                    .where(eq(featuresTable.id, id))
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
                const result = await db.delete(featuresTable).where(eq(featuresTable.id, id)).returning();
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
export function getFeatureStore() {
    if (!_store) {
        _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
    }
    return _store;
}
