var _a, _b;
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { adminAgentContextSummariesTable, adminAgentConversationsTable, adminAgentMessagesTable, adminAgentOperationsTable, adminAgentToolCallsTable, } from "./schema";
function toIso(value) {
    if (!value)
        return null;
    return value instanceof Date ? value.toISOString() : String(value);
}
function nowIso() {
    return new Date().toISOString();
}
function isMissingTable(e) {
    var _a, _b;
    const code = (_a = e === null || e === void 0 ? void 0 : e.code) !== null && _a !== void 0 ? _a : (_b = e === null || e === void 0 ? void 0 : e.cause) === null || _b === void 0 ? void 0 : _b.code;
    if (code === "42P01")
        return true;
    return e instanceof Error && e.message.includes("42P01");
}
const memory = globalThis;
const memoryState = (_a = memory.__odysseyAdminAgent) !== null && _a !== void 0 ? _a : (memory.__odysseyAdminAgent = {
    conversations: new Map(),
    messages: new Map(),
    toolCalls: new Map(),
    operations: new Map(),
    contextSummaries: new Map(),
});
(_b = memoryState.contextSummaries) !== null && _b !== void 0 ? _b : (memoryState.contextSummaries = new Map());
function memoryStore() {
    return {
        async createConversation(input) {
            var _a, _b, _c, _d, _e, _f;
            const now = nowIso();
            const record = {
                id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                adminUserId: (_b = input.adminUserId) !== null && _b !== void 0 ? _b : null,
                title: (_c = input.title) !== null && _c !== void 0 ? _c : null,
                routeContext: (_d = input.routeContext) !== null && _d !== void 0 ? _d : {},
                model: (_e = input.model) !== null && _e !== void 0 ? _e : null,
                provider: (_f = input.provider) !== null && _f !== void 0 ? _f : null,
                status: "active",
                createdAt: now,
                updatedAt: now,
            };
            memoryState.conversations.set(record.id, record);
            return record;
        },
        async getConversation(id) {
            var _a;
            return (_a = memoryState.conversations.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async getConversationDetail(id) {
            const conversation = memoryState.conversations.get(id);
            if (!conversation)
                return null;
            return {
                conversation,
                messages: await this.listMessages(id),
                operations: await this.listOperationsForConversation(id),
                contextSummaries: await this.listContextSummaries(id, 10),
            };
        },
        async touchConversation(id, input = {}) {
            const existing = memoryState.conversations.get(id);
            if (!existing)
                return;
            memoryState.conversations.set(id, Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, existing), (input.title !== undefined ? { title: input.title } : {})), (input.model !== undefined ? { model: input.model } : {})), (input.provider !== undefined ? { provider: input.provider } : {})), (input.routeContext !== undefined ? { routeContext: input.routeContext } : {})), { updatedAt: nowIso() }));
        },
        async appendMessage(input) {
            var _a, _b;
            const record = {
                id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                conversationId: input.conversationId,
                role: input.role,
                content: input.content,
                metadata: (_b = input.metadata) !== null && _b !== void 0 ? _b : {},
                createdAt: nowIso(),
            };
            memoryState.messages.set(record.id, record);
            await this.touchConversation(input.conversationId);
            return record;
        },
        async listMessages(conversationId) {
            return Array.from(memoryState.messages.values())
                .filter((m) => m.conversationId === conversationId)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        },
        async recordToolCall(input) {
            var _a, _b, _c, _d, _e, _f, _g;
            const startedAt = (_a = input.startedAt) !== null && _a !== void 0 ? _a : nowIso();
            const record = {
                id: (_b = input.id) !== null && _b !== void 0 ? _b : crypto.randomUUID(),
                conversationId: input.conversationId,
                messageId: (_c = input.messageId) !== null && _c !== void 0 ? _c : null,
                toolName: input.toolName,
                toolKind: input.toolKind,
                args: (_d = input.args) !== null && _d !== void 0 ? _d : {},
                resultSummary: (_e = input.resultSummary) !== null && _e !== void 0 ? _e : {},
                status: input.status,
                errorMessage: (_f = input.errorMessage) !== null && _f !== void 0 ? _f : null,
                startedAt,
                completedAt: (_g = input.completedAt) !== null && _g !== void 0 ? _g : (input.status === "running" ? null : nowIso()),
            };
            memoryState.toolCalls.set(record.id, record);
            await this.touchConversation(input.conversationId);
            return record;
        },
        async createOperation(input) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const now = nowIso();
            const record = {
                id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                conversationId: input.conversationId,
                toolCallId: (_b = input.toolCallId) !== null && _b !== void 0 ? _b : null,
                toolName: input.toolName,
                intent: input.intent,
                riskLevel: input.riskLevel,
                status: "pending",
                args: (_c = input.args) !== null && _c !== void 0 ? _c : {},
                affectedRecords: (_d = input.affectedRecords) !== null && _d !== void 0 ? _d : [],
                previewDiff: (_e = input.previewDiff) !== null && _e !== void 0 ? _e : {},
                beforeSnapshot: (_f = input.beforeSnapshot) !== null && _f !== void 0 ? _f : null,
                afterSnapshot: null,
                resultSummary: (_g = input.resultSummary) !== null && _g !== void 0 ? _g : {},
                errorMessage: null,
                requiresConfirmation: true,
                proposedByUserId: (_h = input.proposedByUserId) !== null && _h !== void 0 ? _h : null,
                approvedByUserId: null,
                approvedAt: null,
                executedAt: null,
                createdAt: now,
                updatedAt: now,
            };
            memoryState.operations.set(record.id, record);
            await this.touchConversation(input.conversationId);
            return record;
        },
        async getOperation(id) {
            var _a;
            return (_a = memoryState.operations.get(id)) !== null && _a !== void 0 ? _a : null;
        },
        async updateOperation(id, input) {
            const existing = memoryState.operations.get(id);
            if (!existing)
                return null;
            const updated = Object.assign(Object.assign(Object.assign({}, existing), input), { updatedAt: nowIso() });
            memoryState.operations.set(id, updated);
            await this.touchConversation(updated.conversationId);
            return updated;
        },
        async listOperationsForConversation(conversationId) {
            return Array.from(memoryState.operations.values())
                .filter((o) => o.conversationId === conversationId)
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        },
        async createContextSummary(input) {
            var _a, _b, _c, _d, _e, _f, _g;
            const now = nowIso();
            const record = {
                id: (_a = input.id) !== null && _a !== void 0 ? _a : crypto.randomUUID(),
                conversationId: input.conversationId,
                summary: input.summary,
                pinned: (_b = input.pinned) !== null && _b !== void 0 ? _b : false,
                sourceMessageCount: (_c = input.sourceMessageCount) !== null && _c !== void 0 ? _c : 0,
                lastMessageId: (_d = input.lastMessageId) !== null && _d !== void 0 ? _d : null,
                model: (_e = input.model) !== null && _e !== void 0 ? _e : null,
                provider: (_f = input.provider) !== null && _f !== void 0 ? _f : null,
                metadata: (_g = input.metadata) !== null && _g !== void 0 ? _g : {},
                createdAt: now,
                updatedAt: now,
            };
            memoryState.contextSummaries.set(record.id, record);
            await this.touchConversation(input.conversationId);
            return record;
        },
        async listContextSummaries(conversationId, limit = 10) {
            return Array.from(memoryState.contextSummaries.values())
                .filter((s) => s.conversationId === conversationId)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, limit);
        },
        async getLatestContextSummary(conversationId) {
            var _a;
            return (_a = (await this.listContextSummaries(conversationId, 1))[0]) !== null && _a !== void 0 ? _a : null;
        },
    };
}
function normalizeConversation(row) {
    var _a, _b;
    return {
        id: row.id,
        adminUserId: row.adminUserId,
        title: row.title,
        routeContext: row.routeContext,
        model: row.model,
        provider: row.provider,
        status: row.status,
        createdAt: (_a = toIso(row.createdAt)) !== null && _a !== void 0 ? _a : "",
        updatedAt: (_b = toIso(row.updatedAt)) !== null && _b !== void 0 ? _b : "",
    };
}
function normalizeMessage(row) {
    var _a;
    return {
        id: row.id,
        conversationId: row.conversationId,
        role: row.role,
        content: row.content,
        metadata: row.metadata,
        createdAt: (_a = toIso(row.createdAt)) !== null && _a !== void 0 ? _a : "",
    };
}
function normalizeToolCall(row) {
    var _a;
    return {
        id: row.id,
        conversationId: row.conversationId,
        messageId: row.messageId,
        toolName: row.toolName,
        toolKind: row.toolKind,
        args: row.args,
        resultSummary: row.resultSummary,
        status: row.status,
        errorMessage: row.errorMessage,
        startedAt: (_a = toIso(row.startedAt)) !== null && _a !== void 0 ? _a : "",
        completedAt: toIso(row.completedAt),
    };
}
function normalizeOperation(row) {
    var _a, _b;
    return {
        id: row.id,
        conversationId: row.conversationId,
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        intent: row.intent,
        riskLevel: row.riskLevel,
        status: row.status,
        args: row.args,
        affectedRecords: row.affectedRecords,
        previewDiff: row.previewDiff,
        beforeSnapshot: row.beforeSnapshot,
        afterSnapshot: row.afterSnapshot,
        resultSummary: row.resultSummary,
        errorMessage: row.errorMessage,
        requiresConfirmation: row.requiresConfirmation,
        proposedByUserId: row.proposedByUserId,
        approvedByUserId: row.approvedByUserId,
        approvedAt: toIso(row.approvedAt),
        executedAt: toIso(row.executedAt),
        createdAt: (_a = toIso(row.createdAt)) !== null && _a !== void 0 ? _a : "",
        updatedAt: (_b = toIso(row.updatedAt)) !== null && _b !== void 0 ? _b : "",
    };
}
function normalizeContextSummary(row) {
    var _a, _b;
    return {
        id: row.id,
        conversationId: row.conversationId,
        summary: row.summary,
        pinned: row.pinned,
        sourceMessageCount: row.sourceMessageCount,
        lastMessageId: row.lastMessageId,
        model: row.model,
        provider: row.provider,
        metadata: row.metadata,
        createdAt: (_a = toIso(row.createdAt)) !== null && _a !== void 0 ? _a : "",
        updatedAt: (_b = toIso(row.updatedAt)) !== null && _b !== void 0 ? _b : "",
    };
}
function neonStore() {
    return {
        async createConversation(input) {
            var _a, _b, _c, _d, _e;
            const db = getDb();
            if (!db)
                return memoryStore().createConversation(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(adminAgentConversationsTable)
                    .values(Object.assign(Object.assign({}, (input.id ? { id: input.id } : {})), { adminUserId: (_a = input.adminUserId) !== null && _a !== void 0 ? _a : null, title: (_b = input.title) !== null && _b !== void 0 ? _b : null, routeContext: ((_c = input.routeContext) !== null && _c !== void 0 ? _c : {}), model: (_d = input.model) !== null && _d !== void 0 ? _d : null, provider: (_e = input.provider) !== null && _e !== void 0 ? _e : null, createdAt: now, updatedAt: now }))
                    .returning();
                return normalizeConversation(row);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().createConversation(input);
                throw e;
            }
        },
        async getConversation(id) {
            const db = getDb();
            if (!db)
                return memoryStore().getConversation(id);
            try {
                const [row] = await retryRead(() => db.select().from(adminAgentConversationsTable).where(eq(adminAgentConversationsTable.id, id)).limit(1));
                return row ? normalizeConversation(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getConversation(id);
                throw e;
            }
        },
        async getConversationDetail(id) {
            const conversation = await this.getConversation(id);
            if (!conversation)
                return null;
            return {
                conversation,
                messages: await this.listMessages(id),
                operations: await this.listOperationsForConversation(id),
                contextSummaries: await this.listContextSummaries(id, 10),
            };
        },
        async touchConversation(id, input = {}) {
            const db = getDb();
            if (!db)
                return memoryStore().touchConversation(id, input);
            try {
                const values = { updatedAt: new Date() };
                if (input.title !== undefined)
                    values.title = input.title;
                if (input.model !== undefined)
                    values.model = input.model;
                if (input.provider !== undefined)
                    values.provider = input.provider;
                if (input.routeContext !== undefined)
                    values.routeContext = input.routeContext;
                await db.update(adminAgentConversationsTable).set(values).where(eq(adminAgentConversationsTable.id, id));
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().touchConversation(id, input);
                throw e;
            }
        },
        async appendMessage(input) {
            var _a;
            const db = getDb();
            if (!db)
                return memoryStore().appendMessage(input);
            try {
                const [row] = await db
                    .insert(adminAgentMessagesTable)
                    .values(Object.assign(Object.assign({}, (input.id ? { id: input.id } : {})), { conversationId: input.conversationId, role: input.role, content: input.content, metadata: ((_a = input.metadata) !== null && _a !== void 0 ? _a : {}) }))
                    .returning();
                await this.touchConversation(input.conversationId);
                return normalizeMessage(row);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().appendMessage(input);
                throw e;
            }
        },
        async listMessages(conversationId) {
            const db = getDb();
            if (!db)
                return memoryStore().listMessages(conversationId);
            try {
                const rows = await retryRead(() => db
                    .select()
                    .from(adminAgentMessagesTable)
                    .where(eq(adminAgentMessagesTable.conversationId, conversationId))
                    .orderBy(asc(adminAgentMessagesTable.createdAt)));
                return rows.map(normalizeMessage);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().listMessages(conversationId);
                throw e;
            }
        },
        async recordToolCall(input) {
            var _a, _b, _c, _d;
            const db = getDb();
            if (!db)
                return memoryStore().recordToolCall(input);
            try {
                const [row] = await db
                    .insert(adminAgentToolCallsTable)
                    .values(Object.assign(Object.assign({}, (input.id ? { id: input.id } : {})), { conversationId: input.conversationId, messageId: (_a = input.messageId) !== null && _a !== void 0 ? _a : null, toolName: input.toolName, toolKind: input.toolKind, args: ((_b = input.args) !== null && _b !== void 0 ? _b : {}), resultSummary: ((_c = input.resultSummary) !== null && _c !== void 0 ? _c : {}), status: input.status, errorMessage: (_d = input.errorMessage) !== null && _d !== void 0 ? _d : null, startedAt: input.startedAt ? new Date(input.startedAt) : new Date(), completedAt: input.completedAt ? new Date(input.completedAt) : input.status === "running" ? null : new Date() }))
                    .returning();
                await this.touchConversation(input.conversationId);
                return normalizeToolCall(row);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().recordToolCall(input);
                throw e;
            }
        },
        async createOperation(input) {
            var _a, _b, _c, _d, _e, _f;
            const db = getDb();
            if (!db)
                return memoryStore().createOperation(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(adminAgentOperationsTable)
                    .values(Object.assign(Object.assign({}, (input.id ? { id: input.id } : {})), { conversationId: input.conversationId, toolCallId: (_a = input.toolCallId) !== null && _a !== void 0 ? _a : null, toolName: input.toolName, intent: input.intent, riskLevel: input.riskLevel, status: "pending", args: ((_b = input.args) !== null && _b !== void 0 ? _b : {}), affectedRecords: ((_c = input.affectedRecords) !== null && _c !== void 0 ? _c : []), previewDiff: ((_d = input.previewDiff) !== null && _d !== void 0 ? _d : {}), beforeSnapshot: input.beforeSnapshot, resultSummary: ((_e = input.resultSummary) !== null && _e !== void 0 ? _e : {}), proposedByUserId: (_f = input.proposedByUserId) !== null && _f !== void 0 ? _f : null, createdAt: now, updatedAt: now }))
                    .returning();
                await this.touchConversation(input.conversationId);
                return normalizeOperation(row);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().createOperation(input);
                throw e;
            }
        },
        async getOperation(id) {
            const db = getDb();
            if (!db)
                return memoryStore().getOperation(id);
            try {
                const [row] = await retryRead(() => db.select().from(adminAgentOperationsTable).where(eq(adminAgentOperationsTable.id, id)).limit(1));
                return row ? normalizeOperation(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().getOperation(id);
                throw e;
            }
        },
        async updateOperation(id, input) {
            const db = getDb();
            if (!db)
                return memoryStore().updateOperation(id, input);
            try {
                const values = { updatedAt: new Date() };
                for (const [key, value] of Object.entries(input)) {
                    if (value === undefined)
                        continue;
                    if (key === "approvedAt" || key === "executedAt") {
                        values[key] = value ? new Date(String(value)) : null;
                    }
                    else {
                        values[key] = value;
                    }
                }
                const [row] = await db
                    .update(adminAgentOperationsTable)
                    .set(values)
                    .where(eq(adminAgentOperationsTable.id, id))
                    .returning();
                if (row)
                    await this.touchConversation(row.conversationId);
                return row ? normalizeOperation(row) : null;
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().updateOperation(id, input);
                throw e;
            }
        },
        async listOperationsForConversation(conversationId) {
            const db = getDb();
            if (!db)
                return memoryStore().listOperationsForConversation(conversationId);
            try {
                const rows = await retryRead(() => db
                    .select()
                    .from(adminAgentOperationsTable)
                    .where(eq(adminAgentOperationsTable.conversationId, conversationId))
                    .orderBy(asc(adminAgentOperationsTable.createdAt)));
                return rows.map(normalizeOperation);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().listOperationsForConversation(conversationId);
                throw e;
            }
        },
        async createContextSummary(input) {
            var _a, _b, _c, _d, _e, _f;
            const db = getDb();
            if (!db)
                return memoryStore().createContextSummary(input);
            try {
                const now = new Date();
                const [row] = await db
                    .insert(adminAgentContextSummariesTable)
                    .values(Object.assign(Object.assign({}, (input.id ? { id: input.id } : {})), { conversationId: input.conversationId, summary: input.summary, pinned: (_a = input.pinned) !== null && _a !== void 0 ? _a : false, sourceMessageCount: (_b = input.sourceMessageCount) !== null && _b !== void 0 ? _b : 0, lastMessageId: (_c = input.lastMessageId) !== null && _c !== void 0 ? _c : null, model: (_d = input.model) !== null && _d !== void 0 ? _d : null, provider: (_e = input.provider) !== null && _e !== void 0 ? _e : null, metadata: ((_f = input.metadata) !== null && _f !== void 0 ? _f : {}), createdAt: now, updatedAt: now }))
                    .returning();
                await this.touchConversation(input.conversationId);
                return normalizeContextSummary(row);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().createContextSummary(input);
                throw e;
            }
        },
        async listContextSummaries(conversationId, limit = 10) {
            const db = getDb();
            if (!db)
                return memoryStore().listContextSummaries(conversationId, limit);
            try {
                const rows = await retryRead(() => db
                    .select()
                    .from(adminAgentContextSummariesTable)
                    .where(eq(adminAgentContextSummariesTable.conversationId, conversationId))
                    .orderBy(desc(adminAgentContextSummariesTable.createdAt))
                    .limit(limit));
                return rows.map(normalizeContextSummary);
            }
            catch (e) {
                if (isMissingTable(e))
                    return memoryStore().listContextSummaries(conversationId, limit);
                throw e;
            }
        },
        async getLatestContextSummary(conversationId) {
            var _a;
            return (_a = (await this.listContextSummaries(conversationId, 1))[0]) !== null && _a !== void 0 ? _a : null;
        },
    };
}
let _store = null;
export function getAdminAgentStore() {
    if (!_store) {
        _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
    }
    return _store;
}
