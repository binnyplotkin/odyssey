import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  adminAgentContextSummariesTable,
  adminAgentConversationsTable,
  adminAgentMessagesTable,
  adminAgentOperationsTable,
  adminAgentToolCallsTable,
} from "./schema";

type JsonObject = Record<string, unknown>;

export type AdminAgentMessageRole = "user" | "assistant" | "system";
export type AdminAgentToolKind = "read" | "mutation";
export type AdminAgentToolStatus = "running" | "completed" | "failed";
export type AdminAgentRiskLevel = "low" | "medium" | "high" | "destructive";
export type AdminAgentOperationStatus =
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

export type AdminAgentConversationRecord = {
  id: string;
  adminUserId: string | null;
  title: string | null;
  routeContext: unknown;
  model: string | null;
  provider: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminAgentMessageRecord = {
  id: string;
  conversationId: string;
  role: AdminAgentMessageRole;
  content: string;
  metadata: unknown;
  createdAt: string;
};

export type AdminAgentToolCallRecord = {
  id: string;
  conversationId: string;
  messageId: string | null;
  toolName: string;
  toolKind: AdminAgentToolKind;
  args: unknown;
  resultSummary: unknown;
  status: AdminAgentToolStatus;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type AdminAgentOperationRecord = {
  id: string;
  conversationId: string;
  toolCallId: string | null;
  toolName: string;
  intent: string;
  riskLevel: AdminAgentRiskLevel;
  status: AdminAgentOperationStatus;
  args: unknown;
  affectedRecords: unknown;
  previewDiff: unknown;
  beforeSnapshot: unknown | null;
  afterSnapshot: unknown | null;
  resultSummary: unknown;
  errorMessage: string | null;
  requiresConfirmation: boolean;
  proposedByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminAgentContextSummaryRecord = {
  id: string;
  conversationId: string;
  summary: string;
  pinned: boolean;
  sourceMessageCount: number;
  lastMessageId: string | null;
  model: string | null;
  provider: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AdminAgentConversationDetail = {
  conversation: AdminAgentConversationRecord;
  messages: AdminAgentMessageRecord[];
  operations: AdminAgentOperationRecord[];
  contextSummaries: AdminAgentContextSummaryRecord[];
};

export type CreateConversationInput = {
  id?: string;
  adminUserId?: string | null;
  title?: string | null;
  routeContext?: unknown;
  model?: string | null;
  provider?: string | null;
};

export type AppendMessageInput = {
  id?: string;
  conversationId: string;
  role: AdminAgentMessageRole;
  content: string;
  metadata?: unknown;
};

export type RecordToolCallInput = {
  id?: string;
  conversationId: string;
  messageId?: string | null;
  toolName: string;
  toolKind: AdminAgentToolKind;
  args?: unknown;
  resultSummary?: unknown;
  status: AdminAgentToolStatus;
  errorMessage?: string | null;
  startedAt?: string;
  completedAt?: string | null;
};

export type CreateOperationInput = {
  id?: string;
  conversationId: string;
  toolCallId?: string | null;
  toolName: string;
  intent: string;
  riskLevel: AdminAgentRiskLevel;
  args?: unknown;
  affectedRecords?: unknown;
  previewDiff?: unknown;
  beforeSnapshot?: unknown | null;
  resultSummary?: unknown;
  proposedByUserId?: string | null;
};

export type UpdateOperationInput = Partial<
  Pick<
    AdminAgentOperationRecord,
    | "status"
    | "affectedRecords"
    | "previewDiff"
    | "beforeSnapshot"
    | "afterSnapshot"
    | "resultSummary"
    | "errorMessage"
    | "approvedByUserId"
    | "approvedAt"
    | "executedAt"
  >
>;

export type CreateContextSummaryInput = {
  id?: string;
  conversationId: string;
  summary: string;
  pinned?: boolean;
  sourceMessageCount?: number;
  lastMessageId?: string | null;
  model?: string | null;
  provider?: string | null;
  metadata?: unknown;
};

export interface AdminAgentStore {
  createConversation(input: CreateConversationInput): Promise<AdminAgentConversationRecord>;
  getConversation(id: string): Promise<AdminAgentConversationRecord | null>;
  getConversationDetail(id: string): Promise<AdminAgentConversationDetail | null>;
  touchConversation(id: string, input?: { title?: string | null; model?: string | null; provider?: string | null; routeContext?: unknown }): Promise<void>;
  appendMessage(input: AppendMessageInput): Promise<AdminAgentMessageRecord>;
  listMessages(conversationId: string): Promise<AdminAgentMessageRecord[]>;
  recordToolCall(input: RecordToolCallInput): Promise<AdminAgentToolCallRecord>;
  createOperation(input: CreateOperationInput): Promise<AdminAgentOperationRecord>;
  getOperation(id: string): Promise<AdminAgentOperationRecord | null>;
  updateOperation(id: string, input: UpdateOperationInput): Promise<AdminAgentOperationRecord | null>;
  listOperationsForConversation(conversationId: string): Promise<AdminAgentOperationRecord[]>;
  createContextSummary(input: CreateContextSummaryInput): Promise<AdminAgentContextSummaryRecord>;
  listContextSummaries(conversationId: string, limit?: number): Promise<AdminAgentContextSummaryRecord[]>;
  getLatestContextSummary(conversationId: string): Promise<AdminAgentContextSummaryRecord | null>;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isMissingTable(e: unknown): boolean {
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42P01") return true;
  return e instanceof Error && e.message.includes("42P01");
}

const memory = globalThis as typeof globalThis & {
  __odysseyAdminAgent?: {
    conversations: Map<string, AdminAgentConversationRecord>;
    messages: Map<string, AdminAgentMessageRecord>;
    toolCalls: Map<string, AdminAgentToolCallRecord>;
    operations: Map<string, AdminAgentOperationRecord>;
    contextSummaries: Map<string, AdminAgentContextSummaryRecord>;
  };
};

const memoryState =
  memory.__odysseyAdminAgent ??
  (memory.__odysseyAdminAgent = {
    conversations: new Map(),
    messages: new Map(),
    toolCalls: new Map(),
    operations: new Map(),
    contextSummaries: new Map(),
  });

memoryState.contextSummaries ??= new Map();

function memoryStore(): AdminAgentStore {
  return {
    async createConversation(input) {
      const now = nowIso();
      const record: AdminAgentConversationRecord = {
        id: input.id ?? crypto.randomUUID(),
        adminUserId: input.adminUserId ?? null,
        title: input.title ?? null,
        routeContext: input.routeContext ?? {},
        model: input.model ?? null,
        provider: input.provider ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      memoryState.conversations.set(record.id, record);
      return record;
    },

    async getConversation(id) {
      return memoryState.conversations.get(id) ?? null;
    },

    async getConversationDetail(id) {
      const conversation = memoryState.conversations.get(id);
      if (!conversation) return null;
      return {
        conversation,
        messages: await this.listMessages(id),
        operations: await this.listOperationsForConversation(id),
        contextSummaries: await this.listContextSummaries(id, 10),
      };
    },

    async touchConversation(id, input = {}) {
      const existing = memoryState.conversations.get(id);
      if (!existing) return;
      memoryState.conversations.set(id, {
        ...existing,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.routeContext !== undefined ? { routeContext: input.routeContext } : {}),
        updatedAt: nowIso(),
      });
    },

    async appendMessage(input) {
      const record: AdminAgentMessageRecord = {
        id: input.id ?? crypto.randomUUID(),
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        metadata: input.metadata ?? {},
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
      const startedAt = input.startedAt ?? nowIso();
      const record: AdminAgentToolCallRecord = {
        id: input.id ?? crypto.randomUUID(),
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        toolName: input.toolName,
        toolKind: input.toolKind,
        args: input.args ?? {},
        resultSummary: input.resultSummary ?? {},
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        startedAt,
        completedAt: input.completedAt ?? (input.status === "running" ? null : nowIso()),
      };
      memoryState.toolCalls.set(record.id, record);
      await this.touchConversation(input.conversationId);
      return record;
    },

    async createOperation(input) {
      const now = nowIso();
      const record: AdminAgentOperationRecord = {
        id: input.id ?? crypto.randomUUID(),
        conversationId: input.conversationId,
        toolCallId: input.toolCallId ?? null,
        toolName: input.toolName,
        intent: input.intent,
        riskLevel: input.riskLevel,
        status: "pending",
        args: input.args ?? {},
        affectedRecords: input.affectedRecords ?? [],
        previewDiff: input.previewDiff ?? {},
        beforeSnapshot: input.beforeSnapshot ?? null,
        afterSnapshot: null,
        resultSummary: input.resultSummary ?? {},
        errorMessage: null,
        requiresConfirmation: true,
        proposedByUserId: input.proposedByUserId ?? null,
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
      return memoryState.operations.get(id) ?? null;
    },

    async updateOperation(id, input) {
      const existing = memoryState.operations.get(id);
      if (!existing) return null;
      const updated = {
        ...existing,
        ...input,
        updatedAt: nowIso(),
      };
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
      const now = nowIso();
      const record: AdminAgentContextSummaryRecord = {
        id: input.id ?? crypto.randomUUID(),
        conversationId: input.conversationId,
        summary: input.summary,
        pinned: input.pinned ?? false,
        sourceMessageCount: input.sourceMessageCount ?? 0,
        lastMessageId: input.lastMessageId ?? null,
        model: input.model ?? null,
        provider: input.provider ?? null,
        metadata: input.metadata ?? {},
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
      return (await this.listContextSummaries(conversationId, 1))[0] ?? null;
    },
  };
}

function normalizeConversation(row: typeof adminAgentConversationsTable.$inferSelect): AdminAgentConversationRecord {
  return {
    id: row.id,
    adminUserId: row.adminUserId,
    title: row.title,
    routeContext: row.routeContext,
    model: row.model,
    provider: row.provider,
    status: row.status,
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function normalizeMessage(row: typeof adminAgentMessagesTable.$inferSelect): AdminAgentMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as AdminAgentMessageRole,
    content: row.content,
    metadata: row.metadata,
    createdAt: toIso(row.createdAt) ?? "",
  };
}

function normalizeToolCall(row: typeof adminAgentToolCallsTable.$inferSelect): AdminAgentToolCallRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    toolName: row.toolName,
    toolKind: row.toolKind as AdminAgentToolKind,
    args: row.args,
    resultSummary: row.resultSummary,
    status: row.status as AdminAgentToolStatus,
    errorMessage: row.errorMessage,
    startedAt: toIso(row.startedAt) ?? "",
    completedAt: toIso(row.completedAt),
  };
}

function normalizeOperation(row: typeof adminAgentOperationsTable.$inferSelect): AdminAgentOperationRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    intent: row.intent,
    riskLevel: row.riskLevel as AdminAgentRiskLevel,
    status: row.status as AdminAgentOperationStatus,
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
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function normalizeContextSummary(row: typeof adminAgentContextSummariesTable.$inferSelect): AdminAgentContextSummaryRecord {
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
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function neonStore(): AdminAgentStore {
  return {
    async createConversation(input) {
      const db = getDb();
      if (!db) return memoryStore().createConversation(input);
      try {
        const now = new Date();
        const [row] = await db
          .insert(adminAgentConversationsTable)
          .values({
            ...(input.id ? { id: input.id } : {}),
            adminUserId: input.adminUserId ?? null,
            title: input.title ?? null,
            routeContext: (input.routeContext ?? {}) as JsonObject,
            model: input.model ?? null,
            provider: input.provider ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return normalizeConversation(row);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().createConversation(input);
        throw e;
      }
    },

    async getConversation(id) {
      const db = getDb();
      if (!db) return memoryStore().getConversation(id);
      try {
        const [row] = await retryRead(() =>
          db.select().from(adminAgentConversationsTable).where(eq(adminAgentConversationsTable.id, id)).limit(1),
        );
        return row ? normalizeConversation(row) : null;
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().getConversation(id);
        throw e;
      }
    },

    async getConversationDetail(id) {
      const conversation = await this.getConversation(id);
      if (!conversation) return null;
      return {
        conversation,
        messages: await this.listMessages(id),
        operations: await this.listOperationsForConversation(id),
        contextSummaries: await this.listContextSummaries(id, 10),
      };
    },

    async touchConversation(id, input = {}) {
      const db = getDb();
      if (!db) return memoryStore().touchConversation(id, input);
      try {
        const values: Record<string, unknown> = { updatedAt: new Date() };
        if (input.title !== undefined) values.title = input.title;
        if (input.model !== undefined) values.model = input.model;
        if (input.provider !== undefined) values.provider = input.provider;
        if (input.routeContext !== undefined) values.routeContext = input.routeContext;
        await db.update(adminAgentConversationsTable).set(values).where(eq(adminAgentConversationsTable.id, id));
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().touchConversation(id, input);
        throw e;
      }
    },

    async appendMessage(input) {
      const db = getDb();
      if (!db) return memoryStore().appendMessage(input);
      try {
        const [row] = await db
          .insert(adminAgentMessagesTable)
          .values({
            ...(input.id ? { id: input.id } : {}),
            conversationId: input.conversationId,
            role: input.role,
            content: input.content,
            metadata: (input.metadata ?? {}) as JsonObject,
          })
          .returning();
        await this.touchConversation(input.conversationId);
        return normalizeMessage(row);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().appendMessage(input);
        throw e;
      }
    },

    async listMessages(conversationId) {
      const db = getDb();
      if (!db) return memoryStore().listMessages(conversationId);
      try {
        const rows = await retryRead(() =>
          db
            .select()
            .from(adminAgentMessagesTable)
            .where(eq(adminAgentMessagesTable.conversationId, conversationId))
            .orderBy(asc(adminAgentMessagesTable.createdAt)),
        );
        return rows.map(normalizeMessage);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().listMessages(conversationId);
        throw e;
      }
    },

    async recordToolCall(input) {
      const db = getDb();
      if (!db) return memoryStore().recordToolCall(input);
      try {
        const [row] = await db
          .insert(adminAgentToolCallsTable)
          .values({
            ...(input.id ? { id: input.id } : {}),
            conversationId: input.conversationId,
            messageId: input.messageId ?? null,
            toolName: input.toolName,
            toolKind: input.toolKind,
            args: (input.args ?? {}) as JsonObject,
            resultSummary: (input.resultSummary ?? {}) as JsonObject,
            status: input.status,
            errorMessage: input.errorMessage ?? null,
            startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
            completedAt: input.completedAt ? new Date(input.completedAt) : input.status === "running" ? null : new Date(),
          })
          .returning();
        await this.touchConversation(input.conversationId);
        return normalizeToolCall(row);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().recordToolCall(input);
        throw e;
      }
    },

    async createOperation(input) {
      const db = getDb();
      if (!db) return memoryStore().createOperation(input);
      try {
        const now = new Date();
        const [row] = await db
          .insert(adminAgentOperationsTable)
          .values({
            ...(input.id ? { id: input.id } : {}),
            conversationId: input.conversationId,
            toolCallId: input.toolCallId ?? null,
            toolName: input.toolName,
            intent: input.intent,
            riskLevel: input.riskLevel,
            status: "pending",
            args: (input.args ?? {}) as JsonObject,
            affectedRecords: (input.affectedRecords ?? []) as JsonObject[],
            previewDiff: (input.previewDiff ?? {}) as JsonObject,
            beforeSnapshot: input.beforeSnapshot as JsonObject | null | undefined,
            resultSummary: (input.resultSummary ?? {}) as JsonObject,
            proposedByUserId: input.proposedByUserId ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await this.touchConversation(input.conversationId);
        return normalizeOperation(row);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().createOperation(input);
        throw e;
      }
    },

    async getOperation(id) {
      const db = getDb();
      if (!db) return memoryStore().getOperation(id);
      try {
        const [row] = await retryRead(() =>
          db.select().from(adminAgentOperationsTable).where(eq(adminAgentOperationsTable.id, id)).limit(1),
        );
        return row ? normalizeOperation(row) : null;
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().getOperation(id);
        throw e;
      }
    },

    async updateOperation(id, input) {
      const db = getDb();
      if (!db) return memoryStore().updateOperation(id, input);
      try {
        const values: Record<string, unknown> = { updatedAt: new Date() };
        for (const [key, value] of Object.entries(input)) {
          if (value === undefined) continue;
          if (key === "approvedAt" || key === "executedAt") {
            values[key] = value ? new Date(String(value)) : null;
          } else {
            values[key] = value;
          }
        }
        const [row] = await db
          .update(adminAgentOperationsTable)
          .set(values)
          .where(eq(adminAgentOperationsTable.id, id))
          .returning();
        if (row) await this.touchConversation(row.conversationId);
        return row ? normalizeOperation(row) : null;
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().updateOperation(id, input);
        throw e;
      }
    },

    async listOperationsForConversation(conversationId) {
      const db = getDb();
      if (!db) return memoryStore().listOperationsForConversation(conversationId);
      try {
        const rows = await retryRead(() =>
          db
            .select()
            .from(adminAgentOperationsTable)
            .where(eq(adminAgentOperationsTable.conversationId, conversationId))
            .orderBy(asc(adminAgentOperationsTable.createdAt)),
        );
        return rows.map(normalizeOperation);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().listOperationsForConversation(conversationId);
        throw e;
      }
    },

    async createContextSummary(input) {
      const db = getDb();
      if (!db) return memoryStore().createContextSummary(input);
      try {
        const now = new Date();
        const [row] = await db
          .insert(adminAgentContextSummariesTable)
          .values({
            ...(input.id ? { id: input.id } : {}),
            conversationId: input.conversationId,
            summary: input.summary,
            pinned: input.pinned ?? false,
            sourceMessageCount: input.sourceMessageCount ?? 0,
            lastMessageId: input.lastMessageId ?? null,
            model: input.model ?? null,
            provider: input.provider ?? null,
            metadata: (input.metadata ?? {}) as JsonObject,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        await this.touchConversation(input.conversationId);
        return normalizeContextSummary(row);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().createContextSummary(input);
        throw e;
      }
    },

    async listContextSummaries(conversationId, limit = 10) {
      const db = getDb();
      if (!db) return memoryStore().listContextSummaries(conversationId, limit);
      try {
        const rows = await retryRead(() =>
          db
            .select()
            .from(adminAgentContextSummariesTable)
            .where(eq(adminAgentContextSummariesTable.conversationId, conversationId))
            .orderBy(desc(adminAgentContextSummariesTable.createdAt))
            .limit(limit),
        );
        return rows.map(normalizeContextSummary);
      } catch (e) {
        if (isMissingTable(e)) return memoryStore().listContextSummaries(conversationId, limit);
        throw e;
      }
    },

    async getLatestContextSummary(conversationId) {
      return (await this.listContextSummaries(conversationId, 1))[0] ?? null;
    },
  };
}

let _store: AdminAgentStore | null = null;

export function getAdminAgentStore(): AdminAgentStore {
  if (!_store) {
    _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
  }
  return _store;
}
