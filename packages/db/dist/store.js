var _a;
import { desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { sessionsTable, turnsTable } from "./schema";
import { sessionRecordSchema, turnRecordSchema, } from "@odyssey/types";
/**
 * Normalize simulation state from pre-rename DB records
 * (politicalStability→stability, factionInfluence→groupInfluence, etc.)
 */
function normalizeState(raw) {
    var _a, _b, _c, _d, _e, _f;
    if (!raw || typeof raw !== "object")
        return raw;
    const s = raw;
    const stability = ((_a = s.stability) !== null && _a !== void 0 ? _a : s.politicalStability);
    const morale = ((_b = s.morale) !== null && _b !== void 0 ? _b : s.publicSentiment);
    const resources = ((_c = s.resources) !== null && _c !== void 0 ? _c : s.treasury);
    const pressure = ((_e = (_d = s.pressure) !== null && _d !== void 0 ? _d : s.militaryPressure) !== null && _e !== void 0 ? _e : s.warPressure);
    // Synthesize metricValues from legacy flat fields if absent
    let metricValues = s.metricValues;
    if (!metricValues || Object.keys(metricValues).length === 0) {
        metricValues = {};
        if (stability !== undefined)
            metricValues.stability = stability;
        if (morale !== undefined)
            metricValues.morale = morale;
        if (resources !== undefined)
            metricValues.resources = resources;
        if (pressure !== undefined)
            metricValues.pressure = pressure;
    }
    return Object.assign(Object.assign({}, s), { stability,
        morale,
        resources,
        pressure,
        metricValues, groupInfluence: (_f = s.groupInfluence) !== null && _f !== void 0 ? _f : s.factionInfluence });
}
const globalStore = globalThis;
const memoryStore = (_a = globalStore.__odysseyStore) !== null && _a !== void 0 ? _a : (globalStore.__odysseyStore = {
    sessions: new Map(),
    turns: new Map(),
});
class MemoryPersistenceStore {
    async createSession(session) {
        memoryStore.sessions.set(session.id, session);
    }
    async getSession(sessionId) {
        var _a;
        return (_a = memoryStore.sessions.get(sessionId)) !== null && _a !== void 0 ? _a : null;
    }
    async updateSession(session) {
        memoryStore.sessions.set(session.id, session);
    }
    async listSessions() {
        return Array.from(memoryStore.sessions.values()).sort((left, right) => right.lastActiveAt.localeCompare(left.lastActiveAt));
    }
    async appendTurn(turn) {
        var _a;
        const turns = (_a = memoryStore.turns.get(turn.sessionId)) !== null && _a !== void 0 ? _a : [];
        turns.push(turn);
        memoryStore.turns.set(turn.sessionId, turns);
    }
    async getTurns(sessionId) {
        var _a;
        return (_a = memoryStore.turns.get(sessionId)) !== null && _a !== void 0 ? _a : [];
    }
}
class NeonPersistenceStore {
    constructor() {
        this.db = getDb();
    }
    async createSession(session) {
        if (!this.db) {
            throw new Error("Neon database unavailable.");
        }
        await this.db.insert(sessionsTable).values({
            id: session.id,
            worldId: session.worldId,
            roleId: session.roleId,
            status: session.status,
            currentStateVersion: session.currentStateVersion,
            state: session.state,
            createdAt: new Date(session.createdAt),
            lastActiveAt: new Date(session.lastActiveAt),
        });
    }
    async getSession(sessionId) {
        if (!this.db) {
            return null;
        }
        const db = this.db;
        const rows = await retryRead(() => db
            .select()
            .from(sessionsTable)
            .where(eq(sessionsTable.id, sessionId))
            .limit(1));
        const row = rows[0];
        if (!row) {
            return null;
        }
        return sessionRecordSchema.parse({
            id: row.id,
            worldId: row.worldId,
            roleId: row.roleId,
            status: row.status,
            currentStateVersion: row.currentStateVersion,
            state: normalizeState(row.state),
            createdAt: row.createdAt.toISOString(),
            lastActiveAt: row.lastActiveAt.toISOString(),
        });
    }
    async updateSession(session) {
        if (!this.db) {
            throw new Error("Neon database unavailable.");
        }
        await this.db
            .update(sessionsTable)
            .set({
            status: session.status,
            currentStateVersion: session.currentStateVersion,
            state: session.state,
            lastActiveAt: new Date(session.lastActiveAt),
        })
            .where(eq(sessionsTable.id, session.id));
    }
    async listSessions() {
        if (!this.db) {
            return [];
        }
        const db = this.db;
        const rows = await retryRead(() => db
            .select()
            .from(sessionsTable)
            .orderBy(desc(sessionsTable.lastActiveAt))
            .limit(12));
        return rows.map((row) => sessionRecordSchema.parse({
            id: row.id,
            worldId: row.worldId,
            roleId: row.roleId,
            status: row.status,
            currentStateVersion: row.currentStateVersion,
            state: normalizeState(row.state),
            createdAt: row.createdAt.toISOString(),
            lastActiveAt: row.lastActiveAt.toISOString(),
        }));
    }
    async appendTurn(turn) {
        if (!this.db) {
            throw new Error("Neon database unavailable.");
        }
        await this.db.insert(turnsTable).values({
            id: turn.id,
            sessionId: turn.sessionId,
            stateVersion: turn.stateVersion,
            input: turn.input,
            result: turn.result,
            stateDeltaSummary: turn.stateDeltaSummary,
            createdAt: new Date(turn.createdAt),
        });
    }
    async getTurns(sessionId) {
        if (!this.db) {
            return [];
        }
        const db = this.db;
        const rows = await retryRead(() => db
            .select()
            .from(turnsTable)
            .where(eq(turnsTable.sessionId, sessionId))
            .orderBy(desc(turnsTable.stateVersion)));
        return rows
            .map((row) => turnRecordSchema.parse({
            id: row.id,
            sessionId: row.sessionId,
            stateVersion: row.stateVersion,
            input: row.input,
            result: row.result,
            stateDeltaSummary: row.stateDeltaSummary,
            createdAt: row.createdAt.toISOString(),
        }))
            .reverse();
    }
}
export function getPersistenceStore() {
    return process.env.DATABASE_URL
        ? new NeonPersistenceStore()
        : new MemoryPersistenceStore();
}
