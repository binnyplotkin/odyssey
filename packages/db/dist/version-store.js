var _a;
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { versionsTable } from "./schema";
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
const globalVersions = (_a = globalThis.__odysseyVersions) !== null && _a !== void 0 ? _a : (globalThis.__odysseyVersions = new Map());
function memoryStore() {
    return {
        async list() {
            return Array.from(globalVersions.values()).sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        },
        async getById(id) {
            var _a;
            return (_a = globalVersions.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async create(input) {
            var _a, _b, _c, _d;
            const now = toIso(new Date());
            const record = {
                id: crypto.randomUUID(),
                tag: input.tag,
                title: input.title,
                description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
                color: input.color,
                status: input.status,
                startDate: (_b = input.startDate) !== null && _b !== void 0 ? _b : null,
                endDate: (_c = input.endDate) !== null && _c !== void 0 ? _c : null,
                sortOrder: (_d = input.sortOrder) !== null && _d !== void 0 ? _d : 0,
                createdAt: now,
                updatedAt: now,
            };
            globalVersions.set(record.id, record);
            return record;
        },
        async update(id, input) {
            const existing = globalVersions.get(id);
            if (!existing)
                return null;
            const updated = Object.assign(Object.assign(Object.assign({}, existing), input), { updatedAt: toIso(new Date()) });
            globalVersions.set(id, updated);
            return updated;
        },
        async remove(id) {
            return globalVersions.delete(id);
        },
    };
}
/* ── Neon (Postgres) implementation ──────────────────────────── */
function neonStore() {
    function normalize(row) {
        return {
            id: row.id,
            tag: row.tag,
            title: row.title,
            description: row.description,
            color: row.color,
            status: row.status,
            startDate: row.startDate,
            endDate: row.endDate,
            sortOrder: row.sortOrder,
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
                const rows = await retryRead(() => db.select().from(versionsTable));
                return rows.map(normalize).sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
                const [row] = await retryRead(() => db.select().from(versionsTable).where(eq(versionsTable.id, id)).limit(1));
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getById(id);
                throw e;
            }
        },
        async create(input) {
            var _a, _b, _c, _d;
            const db = getDb();
            if (!db)
                return memoryStore().create(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(versionsTable)
                    .values({
                    tag: input.tag,
                    title: input.title,
                    description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
                    color: input.color,
                    status: input.status,
                    startDate: (_b = input.startDate) !== null && _b !== void 0 ? _b : null,
                    endDate: (_c = input.endDate) !== null && _c !== void 0 ? _c : null,
                    sortOrder: (_d = input.sortOrder) !== null && _d !== void 0 ? _d : 0,
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
                    .update(versionsTable)
                    .set(values)
                    .where(eq(versionsTable.id, id))
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
                const result = await db.delete(versionsTable).where(eq(versionsTable.id, id)).returning();
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
export function getVersionStore() {
    if (!_store) {
        _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
    }
    return _store;
}
