var _a;
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { usersTable, worldSessionAudioArtifactsTable, worldSessionContextBuildsTable, worldSessionEventsTable, worldSessionsTable, worldSessionTurnsTable, } from "./schema";
const globalStore = globalThis;
const memory = (_a = globalStore.__odysseyWorldSessionStore) !== null && _a !== void 0 ? _a : (globalStore.__odysseyWorldSessionStore = {
    sessions: new Map(),
    contexts: [],
    turns: new Map(),
    events: [],
    audioArtifacts: [],
});
function toIso(value) {
    if (!value)
        return null;
    return value instanceof Date ? value.toISOString() : value;
}
function isMissingTableError(error) {
    var _a, _b, _c, _d, _e;
    const code = (_a = error === null || error === void 0 ? void 0 : error.code) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.code;
    if (code === "42P01")
        return true;
    const message = (_e = (_c = error === null || error === void 0 ? void 0 : error.message) !== null && _c !== void 0 ? _c : (_d = error === null || error === void 0 ? void 0 : error.cause) === null || _d === void 0 ? void 0 : _d.message) !== null && _e !== void 0 ? _e : "";
    return message.includes("world_sessions") && message.includes("does not exist");
}
function normalizeSession(row) {
    var _a;
    return {
        id: row.id,
        userId: row.userId,
        worldId: row.worldId,
        characterId: row.characterId,
        mode: row.mode,
        status: row.status,
        initialMoment: row.initialMoment,
        initialScene: row.initialScene,
        currentMoment: row.currentMoment,
        currentScene: row.currentScene,
        metadata: (_a = row.metadata) !== null && _a !== void 0 ? _a : {},
        startedAt: toIso(row.startedAt),
        endedAt: toIso(row.endedAt),
        lastActiveAt: toIso(row.lastActiveAt),
    };
}
function normalizeContextBuild(row) {
    var _a;
    return {
        id: row.id,
        sessionId: row.sessionId,
        turnId: row.turnId,
        mode: row.mode,
        promptKind: row.promptKind,
        query: row.query,
        moment: row.moment,
        scene: row.scene,
        tokenBudget: row.tokenBudget,
        tokensUsed: row.tokensUsed,
        tokensBudget: row.tokensBudget,
        selectedPages: row.selectedPages,
        curatorTrace: row.curatorTrace,
        timingTrace: row.timingTrace,
        promptChunk: row.promptChunk,
        systemPrompt: row.systemPrompt,
        metadata: (_a = row.metadata) !== null && _a !== void 0 ? _a : {},
        createdAt: toIso(row.createdAt),
    };
}
function normalizeTurn(row) {
    var _a;
    return {
        id: row.id,
        sessionId: row.sessionId,
        turnIndex: row.turnIndex,
        inputMode: row.inputMode,
        userText: row.userText,
        assistantText: row.assistantText,
        provider: row.provider,
        model: row.model,
        status: row.status,
        startedAt: toIso(row.startedAt),
        completedAt: toIso(row.completedAt),
        tokenUsage: row.tokenUsage,
        audioMetrics: row.audioMetrics,
        latencySummary: row.latencySummary,
        trace: row.trace,
        metadata: (_a = row.metadata) !== null && _a !== void 0 ? _a : {},
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}
function normalizeEvent(row) {
    return {
        id: row.id,
        sessionId: row.sessionId,
        turnId: row.turnId,
        type: row.type,
        source: row.source,
        payload: row.payload,
        createdAt: toIso(row.createdAt),
    };
}
function normalizeAudioArtifact(row) {
    var _a;
    return {
        id: row.id,
        sessionId: row.sessionId,
        turnId: row.turnId,
        direction: row.direction,
        mimeType: row.mimeType,
        durationMs: row.durationMs,
        sampleRate: row.sampleRate,
        byteSize: row.byteSize,
        storageKey: row.storageKey,
        waveformSummary: row.waveformSummary,
        metadata: (_a = row.metadata) !== null && _a !== void 0 ? _a : {},
        createdAt: toIso(row.createdAt),
    };
}
function normalizeUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
    };
}
function memoryStore() {
    return {
        async createSession(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const now = new Date().toISOString();
            const record = {
                id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                userId: (_b = input.userId) !== null && _b !== void 0 ? _b : null,
                worldId: (_c = input.worldId) !== null && _c !== void 0 ? _c : null,
                characterId: (_d = input.characterId) !== null && _d !== void 0 ? _d : null,
                mode: input.mode,
                status: (_e = input.status) !== null && _e !== void 0 ? _e : "active",
                initialMoment: input.initialMoment,
                initialScene: input.initialScene,
                currentMoment: (_f = input.currentMoment) !== null && _f !== void 0 ? _f : input.initialMoment,
                currentScene: (_g = input.currentScene) !== null && _g !== void 0 ? _g : input.initialScene,
                metadata: (_h = input.metadata) !== null && _h !== void 0 ? _h : {},
                startedAt: now,
                endedAt: null,
                lastActiveAt: now,
            };
            memory.sessions.set(record.id, record);
            return record;
        },
        async endSession(id, status = "ended", metadata) {
            var _a;
            const current = memory.sessions.get(id);
            if (!current)
                return;
            const now = new Date().toISOString();
            memory.sessions.set(id, Object.assign(Object.assign({}, current), { status, endedAt: now, lastActiveAt: now, metadata: Object.assign(Object.assign({}, ((_a = current.metadata) !== null && _a !== void 0 ? _a : {})), (metadata !== null && metadata !== void 0 ? metadata : {})) }));
        },
        async getSession(id) {
            var _a;
            return (_a = memory.sessions.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async listSessions(limit = 50) {
            return Array.from(memory.sessions.values())
                .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
                .slice(0, limit);
        },
        async listSessionSummaries(limit = 50) {
            const sessions = await this.listSessions(limit);
            const turns = Array.from(memory.turns.values());
            return sessions.map((session) => (Object.assign(Object.assign({}, session), { user: null, contextBuildCount: memory.contexts.filter((row) => row.sessionId === session.id).length, turnCount: turns.filter((row) => row.sessionId === session.id).length, eventCount: memory.events.filter((row) => row.sessionId === session.id).length })));
        },
        async getSessionDetail(id) {
            const session = memory.sessions.get(id);
            if (!session)
                return null;
            const now = new Date().toISOString();
            return {
                session,
                user: null,
                contextBuilds: memory.contexts
                    .filter((row) => row.sessionId === id)
                    .map((row) => {
                    var _a, _b, _c, _d, _e;
                    return ({
                        id: (_a = row.id) !== null && _a !== void 0 ? _a : "",
                        sessionId: row.sessionId,
                        turnId: row.turnId,
                        mode: row.mode,
                        promptKind: row.promptKind,
                        query: row.query,
                        moment: row.moment,
                        scene: row.scene,
                        tokenBudget: row.tokenBudget,
                        tokensUsed: row.tokensUsed,
                        tokensBudget: row.tokensBudget,
                        selectedPages: (_b = row.selectedPages) !== null && _b !== void 0 ? _b : [],
                        curatorTrace: (_c = row.curatorTrace) !== null && _c !== void 0 ? _c : {},
                        timingTrace: (_d = row.timingTrace) !== null && _d !== void 0 ? _d : {},
                        promptChunk: row.promptChunk,
                        systemPrompt: row.systemPrompt,
                        metadata: (_e = row.metadata) !== null && _e !== void 0 ? _e : {},
                        createdAt: now,
                    });
                }),
                turns: Array.from(memory.turns.values())
                    .filter((row) => row.sessionId === id)
                    .map((row) => {
                    var _a, _b, _c, _d, _e, _f;
                    return ({
                        id: row.id,
                        sessionId: row.sessionId,
                        turnIndex: row.turnIndex,
                        inputMode: row.inputMode,
                        userText: row.userText,
                        assistantText: row.assistantText,
                        provider: row.provider,
                        model: row.model,
                        status: row.status,
                        startedAt: (_a = row.startedAt) !== null && _a !== void 0 ? _a : now,
                        completedAt: row.completedAt,
                        tokenUsage: (_b = row.tokenUsage) !== null && _b !== void 0 ? _b : {},
                        audioMetrics: (_c = row.audioMetrics) !== null && _c !== void 0 ? _c : {},
                        latencySummary: (_d = row.latencySummary) !== null && _d !== void 0 ? _d : {},
                        trace: (_e = row.trace) !== null && _e !== void 0 ? _e : {},
                        metadata: (_f = row.metadata) !== null && _f !== void 0 ? _f : {},
                        createdAt: now,
                        updatedAt: now,
                    });
                }),
                events: memory.events
                    .filter((row) => row.sessionId === id)
                    .map((row) => {
                    var _a, _b, _c;
                    return ({
                        id: (_a = row.id) !== null && _a !== void 0 ? _a : "",
                        sessionId: row.sessionId,
                        turnId: row.turnId,
                        type: row.type,
                        source: row.source,
                        payload: (_b = row.payload) !== null && _b !== void 0 ? _b : {},
                        createdAt: (_c = row.createdAt) !== null && _c !== void 0 ? _c : now,
                    });
                }),
                audioArtifacts: memory.audioArtifacts.filter((row) => row.sessionId === id),
            };
        },
        async updateCurrentScene(input) {
            const current = memory.sessions.get(input.sessionId);
            if (!current)
                return;
            memory.sessions.set(input.sessionId, Object.assign(Object.assign({}, current), { currentScene: input.currentScene, lastActiveAt: new Date().toISOString() }));
        },
        async recordContextBuild(input) {
            memory.contexts.push(input);
        },
        async upsertTurn(input) {
            memory.turns.set(input.id, input);
        },
        async appendEvent(input) {
            memory.events.push(input);
        },
        async addAudioArtifact(input) {
            var _a, _b, _c, _d, _e, _f;
            const record = {
                id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                sessionId: input.sessionId,
                turnId: (_b = input.turnId) !== null && _b !== void 0 ? _b : null,
                direction: input.direction,
                mimeType: input.mimeType,
                durationMs: (_c = input.durationMs) !== null && _c !== void 0 ? _c : null,
                sampleRate: (_d = input.sampleRate) !== null && _d !== void 0 ? _d : null,
                byteSize: input.byteSize,
                storageKey: input.storageKey,
                waveformSummary: (_e = input.waveformSummary) !== null && _e !== void 0 ? _e : {},
                metadata: (_f = input.metadata) !== null && _f !== void 0 ? _f : {},
                createdAt: new Date().toISOString(),
            };
            memory.audioArtifacts.push(record);
            return record;
        },
        async listAudioArtifacts(sessionId) {
            return memory.audioArtifacts
                .filter((row) => row.sessionId === sessionId)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        },
        async getAudioArtifact(sessionId, artifactId) {
            var _a;
            return (_a = memory.audioArtifacts.find((row) => row.sessionId === sessionId && row.id === artifactId)) !== null && _a !== void 0 ? _a : null;
        },
    };
}
function neonStore() {
    const db = getDb();
    if (!db)
        return memoryStore();
    return {
        async createSession(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
            const id = (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID();
            const now = new Date();
            try {
                const [row] = await db
                    .insert(worldSessionsTable)
                    .values({
                    id,
                    userId: (_b = input.userId) !== null && _b !== void 0 ? _b : null,
                    worldId: (_c = input.worldId) !== null && _c !== void 0 ? _c : null,
                    characterId: (_d = input.characterId) !== null && _d !== void 0 ? _d : null,
                    mode: input.mode,
                    status: (_e = input.status) !== null && _e !== void 0 ? _e : "active",
                    initialMoment: (_f = input.initialMoment) !== null && _f !== void 0 ? _f : null,
                    initialScene: (_g = input.initialScene) !== null && _g !== void 0 ? _g : null,
                    currentMoment: (_j = (_h = input.currentMoment) !== null && _h !== void 0 ? _h : input.initialMoment) !== null && _j !== void 0 ? _j : null,
                    currentScene: (_l = (_k = input.currentScene) !== null && _k !== void 0 ? _k : input.initialScene) !== null && _l !== void 0 ? _l : null,
                    metadata: (_m = input.metadata) !== null && _m !== void 0 ? _m : {},
                    startedAt: now,
                    lastActiveAt: now,
                })
                    .onConflictDoUpdate({
                    target: worldSessionsTable.id,
                    set: {
                        status: (_o = input.status) !== null && _o !== void 0 ? _o : "active",
                        currentMoment: (_q = (_p = input.currentMoment) !== null && _p !== void 0 ? _p : input.initialMoment) !== null && _q !== void 0 ? _q : null,
                        currentScene: (_s = (_r = input.currentScene) !== null && _r !== void 0 ? _r : input.initialScene) !== null && _s !== void 0 ? _s : null,
                        metadata: (_t = input.metadata) !== null && _t !== void 0 ? _t : {},
                        lastActiveAt: now,
                    },
                })
                    .returning();
                return normalizeSession(row);
            }
            catch (error) {
                if (isMissingTableError(error))
                    return memoryStore().createSession(Object.assign(Object.assign({}, input), { id }));
                throw error;
            }
        },
        async endSession(id, status = "ended", metadata = {}) {
            try {
                await db
                    .update(worldSessionsTable)
                    .set({
                    status,
                    endedAt: new Date(),
                    lastActiveAt: new Date(),
                    metadata,
                })
                    .where(eq(worldSessionsTable.id, id));
            }
            catch (error) {
                if (!isMissingTableError(error))
                    throw error;
            }
        },
        async getSession(id) {
            try {
                const [row] = await retryRead(() => db
                    .select()
                    .from(worldSessionsTable)
                    .where(eq(worldSessionsTable.id, id))
                    .limit(1));
                return row ? normalizeSession(row) : null;
            }
            catch (error) {
                if (isMissingTableError(error))
                    return null;
                throw error;
            }
        },
        async listSessions(limit = 50) {
            try {
                const rows = await retryRead(() => db
                    .select()
                    .from(worldSessionsTable)
                    .orderBy(desc(worldSessionsTable.lastActiveAt))
                    .limit(limit));
                return rows.map(normalizeSession);
            }
            catch (error) {
                if (isMissingTableError(error))
                    return [];
                throw error;
            }
        },
        async listSessionSummaries(limit = 50) {
            try {
                const sessions = await this.listSessions(limit);
                const userIds = Array.from(new Set(sessions.map((session) => session.userId).filter((userId) => !!userId)));
                const users = userIds.length > 0
                    ? await retryRead(() => db
                        .select({
                        id: usersTable.id,
                        name: usersTable.name,
                        email: usersTable.email,
                        image: usersTable.image,
                    })
                        .from(usersTable)
                        .where(inArray(usersTable.id, userIds)))
                    : [];
                const usersById = new Map(users.map((user) => [user.id, normalizeUser(user)]));
                return Promise.all(sessions.map(async (session) => {
                    var _a, _b, _c, _d;
                    const [contextRow] = await retryRead(() => db
                        .select({ count: sql `count(*)::int` })
                        .from(worldSessionContextBuildsTable)
                        .where(eq(worldSessionContextBuildsTable.sessionId, session.id)));
                    const [turnRow] = await retryRead(() => db
                        .select({ count: sql `count(*)::int` })
                        .from(worldSessionTurnsTable)
                        .where(eq(worldSessionTurnsTable.sessionId, session.id)));
                    const [eventRow] = await retryRead(() => db
                        .select({ count: sql `count(*)::int` })
                        .from(worldSessionEventsTable)
                        .where(eq(worldSessionEventsTable.sessionId, session.id)));
                    return Object.assign(Object.assign({}, session), { user: session.userId ? (_a = usersById.get(session.userId)) !== null && _a !== void 0 ? _a : null : null, contextBuildCount: (_b = contextRow === null || contextRow === void 0 ? void 0 : contextRow.count) !== null && _b !== void 0 ? _b : 0, turnCount: (_c = turnRow === null || turnRow === void 0 ? void 0 : turnRow.count) !== null && _c !== void 0 ? _c : 0, eventCount: (_d = eventRow === null || eventRow === void 0 ? void 0 : eventRow.count) !== null && _d !== void 0 ? _d : 0 });
                }));
            }
            catch (error) {
                if (isMissingTableError(error))
                    return [];
                throw error;
            }
        },
        async getSessionDetail(id) {
            try {
                const session = await this.getSession(id);
                if (!session)
                    return null;
                const userId = session.userId;
                const [contexts, turns, events, audioArtifacts, users] = await Promise.all([
                    retryRead(() => db
                        .select()
                        .from(worldSessionContextBuildsTable)
                        .where(eq(worldSessionContextBuildsTable.sessionId, id))
                        .orderBy(asc(worldSessionContextBuildsTable.createdAt))),
                    retryRead(() => db
                        .select()
                        .from(worldSessionTurnsTable)
                        .where(eq(worldSessionTurnsTable.sessionId, id))
                        .orderBy(asc(worldSessionTurnsTable.startedAt))),
                    retryRead(() => db
                        .select()
                        .from(worldSessionEventsTable)
                        .where(eq(worldSessionEventsTable.sessionId, id))
                        .orderBy(asc(worldSessionEventsTable.createdAt))),
                    retryRead(() => db
                        .select()
                        .from(worldSessionAudioArtifactsTable)
                        .where(eq(worldSessionAudioArtifactsTable.sessionId, id))
                        .orderBy(asc(worldSessionAudioArtifactsTable.createdAt))),
                    userId
                        ? retryRead(() => db
                            .select({
                            id: usersTable.id,
                            name: usersTable.name,
                            email: usersTable.email,
                            image: usersTable.image,
                        })
                            .from(usersTable)
                            .where(eq(usersTable.id, userId))
                            .limit(1))
                        : Promise.resolve([]),
                ]);
                return {
                    session,
                    user: users[0] ? normalizeUser(users[0]) : null,
                    contextBuilds: contexts.map(normalizeContextBuild),
                    turns: turns.map(normalizeTurn),
                    events: events.map(normalizeEvent),
                    audioArtifacts: audioArtifacts.map(normalizeAudioArtifact),
                };
            }
            catch (error) {
                if (isMissingTableError(error))
                    return null;
                throw error;
            }
        },
        async updateCurrentScene(input) {
            try {
                await db
                    .update(worldSessionsTable)
                    .set({
                    currentScene: input.currentScene,
                    lastActiveAt: new Date(),
                })
                    .where(eq(worldSessionsTable.id, input.sessionId));
            }
            catch (error) {
                if (!isMissingTableError(error))
                    throw error;
            }
        },
        async recordContextBuild(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            try {
                await db.insert(worldSessionContextBuildsTable).values({
                    id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                    sessionId: input.sessionId,
                    turnId: (_b = input.turnId) !== null && _b !== void 0 ? _b : null,
                    mode: input.mode,
                    promptKind: input.promptKind,
                    query: (_c = input.query) !== null && _c !== void 0 ? _c : null,
                    moment: (_d = input.moment) !== null && _d !== void 0 ? _d : null,
                    scene: (_e = input.scene) !== null && _e !== void 0 ? _e : null,
                    tokenBudget: (_f = input.tokenBudget) !== null && _f !== void 0 ? _f : null,
                    tokensUsed: (_g = input.tokensUsed) !== null && _g !== void 0 ? _g : null,
                    tokensBudget: (_h = input.tokensBudget) !== null && _h !== void 0 ? _h : null,
                    selectedPages: (_j = input.selectedPages) !== null && _j !== void 0 ? _j : [],
                    curatorTrace: (_k = input.curatorTrace) !== null && _k !== void 0 ? _k : {},
                    timingTrace: (_l = input.timingTrace) !== null && _l !== void 0 ? _l : {},
                    promptChunk: (_m = input.promptChunk) !== null && _m !== void 0 ? _m : null,
                    systemPrompt: (_o = input.systemPrompt) !== null && _o !== void 0 ? _o : null,
                    metadata: (_p = input.metadata) !== null && _p !== void 0 ? _p : {},
                });
            }
            catch (error) {
                if (!isMissingTableError(error))
                    throw error;
            }
        },
        async upsertTurn(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
            const now = new Date();
            let resolvedTurnIndex = (_a = input.turnIndex) !== null && _a !== void 0 ? _a : null;
            if (resolvedTurnIndex == null) {
                try {
                    const [{ count: existing }] = await db
                        .select({ count: sql `count(*)::int` })
                        .from(worldSessionTurnsTable)
                        .where(and(eq(worldSessionTurnsTable.sessionId, input.sessionId), ne(worldSessionTurnsTable.id, input.id)));
                    resolvedTurnIndex = existing !== null && existing !== void 0 ? existing : 0;
                }
                catch (error) {
                    if (!isMissingTableError(error))
                        throw error;
                }
            }
            try {
                await db
                    .insert(worldSessionTurnsTable)
                    .values({
                    id: input.id,
                    sessionId: input.sessionId,
                    turnIndex: resolvedTurnIndex,
                    inputMode: input.inputMode,
                    userText: (_b = input.userText) !== null && _b !== void 0 ? _b : null,
                    assistantText: (_c = input.assistantText) !== null && _c !== void 0 ? _c : null,
                    provider: (_d = input.provider) !== null && _d !== void 0 ? _d : null,
                    model: (_e = input.model) !== null && _e !== void 0 ? _e : null,
                    status: input.status,
                    startedAt: input.startedAt ? new Date(input.startedAt) : now,
                    completedAt: input.completedAt ? new Date(input.completedAt) : null,
                    tokenUsage: (_f = input.tokenUsage) !== null && _f !== void 0 ? _f : {},
                    audioMetrics: (_g = input.audioMetrics) !== null && _g !== void 0 ? _g : {},
                    latencySummary: (_h = input.latencySummary) !== null && _h !== void 0 ? _h : {},
                    trace: (_j = input.trace) !== null && _j !== void 0 ? _j : {},
                    metadata: (_k = input.metadata) !== null && _k !== void 0 ? _k : {},
                    createdAt: now,
                    updatedAt: now,
                })
                    .onConflictDoUpdate({
                    target: worldSessionTurnsTable.id,
                    set: {
                        assistantText: (_l = input.assistantText) !== null && _l !== void 0 ? _l : null,
                        provider: (_m = input.provider) !== null && _m !== void 0 ? _m : null,
                        model: (_o = input.model) !== null && _o !== void 0 ? _o : null,
                        status: input.status,
                        completedAt: input.completedAt ? new Date(input.completedAt) : null,
                        tokenUsage: (_p = input.tokenUsage) !== null && _p !== void 0 ? _p : {},
                        audioMetrics: (_q = input.audioMetrics) !== null && _q !== void 0 ? _q : {},
                        latencySummary: (_r = input.latencySummary) !== null && _r !== void 0 ? _r : {},
                        trace: (_s = input.trace) !== null && _s !== void 0 ? _s : {},
                        metadata: (_t = input.metadata) !== null && _t !== void 0 ? _t : {},
                        updatedAt: now,
                    },
                });
            }
            catch (error) {
                if (!isMissingTableError(error))
                    throw error;
            }
        },
        async appendEvent(input) {
            var _a, _b, _c;
            try {
                await db.insert(worldSessionEventsTable).values({
                    id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                    sessionId: input.sessionId,
                    turnId: (_b = input.turnId) !== null && _b !== void 0 ? _b : null,
                    type: input.type,
                    source: input.source,
                    payload: (_c = input.payload) !== null && _c !== void 0 ? _c : {},
                    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
                });
            }
            catch (error) {
                if (!isMissingTableError(error))
                    throw error;
            }
        },
        async addAudioArtifact(input) {
            var _a, _b, _c, _d, _e, _f;
            const id = (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID();
            try {
                const [row] = await db
                    .insert(worldSessionAudioArtifactsTable)
                    .values({
                    id,
                    sessionId: input.sessionId,
                    turnId: (_b = input.turnId) !== null && _b !== void 0 ? _b : null,
                    direction: input.direction,
                    mimeType: input.mimeType,
                    durationMs: (_c = input.durationMs) !== null && _c !== void 0 ? _c : null,
                    sampleRate: (_d = input.sampleRate) !== null && _d !== void 0 ? _d : null,
                    byteSize: input.byteSize,
                    storageKey: input.storageKey,
                    waveformSummary: (_e = input.waveformSummary) !== null && _e !== void 0 ? _e : {},
                    metadata: (_f = input.metadata) !== null && _f !== void 0 ? _f : {},
                })
                    .returning();
                return normalizeAudioArtifact(row);
            }
            catch (error) {
                if (isMissingTableError(error))
                    return memoryStore().addAudioArtifact(Object.assign(Object.assign({}, input), { id }));
                throw error;
            }
        },
        async listAudioArtifacts(sessionId) {
            try {
                const rows = await retryRead(() => db
                    .select()
                    .from(worldSessionAudioArtifactsTable)
                    .where(eq(worldSessionAudioArtifactsTable.sessionId, sessionId))
                    .orderBy(asc(worldSessionAudioArtifactsTable.createdAt)));
                return rows.map(normalizeAudioArtifact);
            }
            catch (error) {
                if (isMissingTableError(error))
                    return [];
                throw error;
            }
        },
        async getAudioArtifact(sessionId, artifactId) {
            try {
                const [row] = await retryRead(() => db
                    .select()
                    .from(worldSessionAudioArtifactsTable)
                    .where(eq(worldSessionAudioArtifactsTable.id, artifactId))
                    .limit(1));
                if (!row || row.sessionId !== sessionId)
                    return null;
                return normalizeAudioArtifact(row);
            }
            catch (error) {
                if (isMissingTableError(error))
                    return null;
                throw error;
            }
        },
    };
}
let _store = null;
export function getWorldSessionStore() {
    if (!_store)
        _store = neonStore();
    return _store;
}
