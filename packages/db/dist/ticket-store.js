var _a;
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { ticketsTable } from "./schema";
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
const globalTickets = (_a = globalThis.__odysseyTickets) !== null && _a !== void 0 ? _a : (globalThis.__odysseyTickets = new Map());
function memoryStore() {
    return {
        async list() {
            return Array.from(globalTickets.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        },
        async getById(id) {
            var _a;
            return (_a = globalTickets.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const now = toIso(new Date());
            const record = {
                id: crypto.randomUUID(),
                title: input.title,
                description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
                status: input.status,
                domain: (_b = input.domain) !== null && _b !== void 0 ? _b : null,
                priority: (_c = input.priority) !== null && _c !== void 0 ? _c : null,
                assignee: (_d = input.assignee) !== null && _d !== void 0 ? _d : null,
                phase: (_e = input.phase) !== null && _e !== void 0 ? _e : null,
                featureId: (_f = input.featureId) !== null && _f !== void 0 ? _f : null,
                sortOrder: (_g = input.sortOrder) !== null && _g !== void 0 ? _g : 0,
                startDate: (_h = input.startDate) !== null && _h !== void 0 ? _h : null,
                endDate: (_j = input.endDate) !== null && _j !== void 0 ? _j : null,
                subtasks: (_k = input.subtasks) !== null && _k !== void 0 ? _k : null,
                activity: (_l = input.activity) !== null && _l !== void 0 ? _l : null,
                createdAt: now,
                updatedAt: now,
            };
            globalTickets.set(record.id, record);
            return record;
        },
        async update(id, input) {
            const existing = globalTickets.get(id);
            if (!existing)
                return null;
            const updated = Object.assign(Object.assign(Object.assign({}, existing), input), { updatedAt: toIso(new Date()) });
            globalTickets.set(id, updated);
            return updated;
        },
        async remove(id) {
            return globalTickets.delete(id);
        },
        async listByFeature(featureId) {
            return Array.from(globalTickets.values())
                .filter((t) => t.featureId === featureId)
                .sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        },
    };
}
/* ── Neon (Postgres) implementation ──────────────────────────── */
function neonStore() {
    function normalize(row) {
        return {
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status,
            domain: row.domain,
            priority: row.priority,
            assignee: row.assignee,
            phase: row.phase,
            featureId: row.featureId,
            sortOrder: row.sortOrder,
            startDate: row.startDate,
            endDate: row.endDate,
            subtasks: row.subtasks,
            activity: row.activity,
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
                const rows = await retryRead(() => db.select().from(ticketsTable));
                return rows.map(normalize).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
                const [row] = await retryRead(() => db.select().from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1));
                return row ? normalize(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getById(id);
                throw e;
            }
        },
        async create(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
            const db = getDb();
            if (!db)
                return memoryStore().create(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(ticketsTable)
                    .values({
                    title: input.title,
                    description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
                    status: input.status,
                    domain: (_b = input.domain) !== null && _b !== void 0 ? _b : null,
                    priority: (_c = input.priority) !== null && _c !== void 0 ? _c : null,
                    assignee: (_d = input.assignee) !== null && _d !== void 0 ? _d : null,
                    phase: (_e = input.phase) !== null && _e !== void 0 ? _e : null,
                    featureId: (_f = input.featureId) !== null && _f !== void 0 ? _f : null,
                    sortOrder: (_g = input.sortOrder) !== null && _g !== void 0 ? _g : 0,
                    startDate: (_h = input.startDate) !== null && _h !== void 0 ? _h : null,
                    endDate: (_j = input.endDate) !== null && _j !== void 0 ? _j : null,
                    subtasks: (_k = input.subtasks) !== null && _k !== void 0 ? _k : null,
                    activity: (_l = input.activity) !== null && _l !== void 0 ? _l : null,
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
                    .update(ticketsTable)
                    .set(values)
                    .where(eq(ticketsTable.id, id))
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
                const result = await db.delete(ticketsTable).where(eq(ticketsTable.id, id)).returning();
                return result.length > 0;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().remove(id);
                throw e;
            }
        },
        async listByFeature(featureId) {
            const db = getDb();
            if (!db)
                return memoryStore().listByFeature(featureId);
            try {
                const rows = await retryRead(() => db.select().from(ticketsTable).where(eq(ticketsTable.featureId, featureId)));
                return rows.map(normalize).sort((a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().listByFeature(featureId);
                throw e;
            }
        },
    };
}
/* ── Factory ─────────────────────────────────────────────────── */
let _store = null;
export function getTicketStore() {
    if (!_store) {
        _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
    }
    return _store;
}
