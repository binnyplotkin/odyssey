import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import {
  worldSessionContextBuildsTable,
  worldSessionEventsTable,
  worldSessionsTable,
  worldSessionTurnsTable,
} from "./schema";

type JsonRecord = Record<string, unknown>;

export type WorldSessionRecord = {
  id: string;
  userId?: string | null;
  worldId?: string | null;
  characterId?: string | null;
  mode: "chat" | "voice" | "mixed" | "simulation" | string;
  status: "active" | "ended" | "error" | string;
  initialMoment?: unknown;
  initialScene?: unknown;
  currentMoment?: unknown;
  currentScene?: unknown;
  metadata?: JsonRecord;
  startedAt: string;
  endedAt?: string | null;
  lastActiveAt: string;
};

export type WorldSessionContextBuildRecord = {
  id: string;
  sessionId: string;
  turnId?: string | null;
  mode: string;
  promptKind: string;
  query?: string | null;
  moment?: unknown;
  scene?: unknown;
  tokenBudget?: number | null;
  tokensUsed?: number | null;
  tokensBudget?: number | null;
  selectedPages: unknown;
  curatorTrace: unknown;
  timingTrace: unknown;
  promptChunk?: string | null;
  systemPrompt?: string | null;
  metadata: JsonRecord;
  createdAt: string;
};

export type WorldSessionTurnRecord = {
  id: string;
  sessionId: string;
  turnIndex?: number | null;
  inputMode: string;
  userText?: string | null;
  assistantText?: string | null;
  provider?: string | null;
  model?: string | null;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  tokenUsage: unknown;
  audioMetrics: unknown;
  latencySummary: unknown;
  trace: unknown;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type WorldSessionEventRecord = {
  id: string;
  sessionId: string;
  turnId?: string | null;
  type: string;
  source: string;
  payload: unknown;
  createdAt: string;
};

export type WorldSessionSummaryRecord = WorldSessionRecord & {
  contextBuildCount: number;
  turnCount: number;
  eventCount: number;
};

export type WorldSessionDetailRecord = {
  session: WorldSessionRecord;
  contextBuilds: WorldSessionContextBuildRecord[];
  turns: WorldSessionTurnRecord[];
  events: WorldSessionEventRecord[];
};

export type CreateWorldSessionInput = {
  id?: string;
  userId?: string | null;
  worldId?: string | null;
  characterId?: string | null;
  mode: string;
  status?: string;
  initialMoment?: unknown;
  initialScene?: unknown;
  currentMoment?: unknown;
  currentScene?: unknown;
  metadata?: JsonRecord;
};

export type RecordContextBuildInput = {
  id?: string;
  sessionId: string;
  turnId?: string | null;
  mode: string;
  promptKind: string;
  query?: string | null;
  moment?: unknown;
  scene?: unknown;
  tokenBudget?: number | null;
  tokensUsed?: number | null;
  tokensBudget?: number | null;
  selectedPages?: unknown;
  curatorTrace?: unknown;
  timingTrace?: unknown;
  promptChunk?: string | null;
  systemPrompt?: string | null;
  metadata?: JsonRecord;
};

export type UpsertWorldSessionTurnInput = {
  id: string;
  sessionId: string;
  turnIndex?: number | null;
  inputMode: string;
  userText?: string | null;
  assistantText?: string | null;
  provider?: string | null;
  model?: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string | null;
  tokenUsage?: unknown;
  audioMetrics?: unknown;
  latencySummary?: unknown;
  trace?: unknown;
  metadata?: JsonRecord;
};

export type AppendWorldSessionEventInput = {
  id?: string;
  sessionId: string;
  turnId?: string | null;
  type: string;
  source: string;
  payload?: unknown;
  createdAt?: string;
};

export interface WorldSessionStore {
  createSession(input: CreateWorldSessionInput): Promise<WorldSessionRecord>;
  endSession(id: string, status?: string, metadata?: JsonRecord): Promise<void>;
  getSession(id: string): Promise<WorldSessionRecord | null>;
  listSessions(limit?: number): Promise<WorldSessionRecord[]>;
  listSessionSummaries(limit?: number): Promise<WorldSessionSummaryRecord[]>;
  getSessionDetail(id: string): Promise<WorldSessionDetailRecord | null>;
  recordContextBuild(input: RecordContextBuildInput): Promise<void>;
  upsertTurn(input: UpsertWorldSessionTurnInput): Promise<void>;
  appendEvent(input: AppendWorldSessionEventInput): Promise<void>;
}

type MemoryState = {
  sessions: Map<string, WorldSessionRecord>;
  contexts: RecordContextBuildInput[];
  turns: Map<string, UpsertWorldSessionTurnInput>;
  events: AppendWorldSessionEventInput[];
};

const globalStore = globalThis as typeof globalThis & {
  __odysseyWorldSessionStore?: MemoryState;
};

const memory =
  globalStore.__odysseyWorldSessionStore ??
  (globalStore.__odysseyWorldSessionStore = {
    sessions: new Map(),
    contexts: [] as RecordContextBuildInput[],
    turns: new Map(),
    events: [] as AppendWorldSessionEventInput[],
  });

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function isMissingTableError(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  if (code === "42P01") return true;
  const message =
    (error as { message?: string })?.message ??
    (error as { cause?: { message?: string } })?.cause?.message ??
    "";
  return message.includes("world_sessions") && message.includes("does not exist");
}

function normalizeSession(row: typeof worldSessionsTable.$inferSelect): WorldSessionRecord {
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
    metadata: (row.metadata as JsonRecord | null) ?? {},
    startedAt: toIso(row.startedAt)!,
    endedAt: toIso(row.endedAt),
    lastActiveAt: toIso(row.lastActiveAt)!,
  };
}

function normalizeContextBuild(
  row: typeof worldSessionContextBuildsTable.$inferSelect,
): WorldSessionContextBuildRecord {
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
    metadata: (row.metadata as JsonRecord | null) ?? {},
    createdAt: toIso(row.createdAt)!,
  };
}

function normalizeTurn(row: typeof worldSessionTurnsTable.$inferSelect): WorldSessionTurnRecord {
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
    startedAt: toIso(row.startedAt)!,
    completedAt: toIso(row.completedAt),
    tokenUsage: row.tokenUsage,
    audioMetrics: row.audioMetrics,
    latencySummary: row.latencySummary,
    trace: row.trace,
    metadata: (row.metadata as JsonRecord | null) ?? {},
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

function normalizeEvent(row: typeof worldSessionEventsTable.$inferSelect): WorldSessionEventRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    type: row.type,
    source: row.source,
    payload: row.payload,
    createdAt: toIso(row.createdAt)!,
  };
}

function memoryStore(): WorldSessionStore {
  return {
    async createSession(input) {
      const now = new Date().toISOString();
      const record: WorldSessionRecord = {
        id: input.id ?? crypto.randomUUID(),
        userId: input.userId ?? null,
        worldId: input.worldId ?? null,
        characterId: input.characterId ?? null,
        mode: input.mode,
        status: input.status ?? "active",
        initialMoment: input.initialMoment,
        initialScene: input.initialScene,
        currentMoment: input.currentMoment ?? input.initialMoment,
        currentScene: input.currentScene ?? input.initialScene,
        metadata: input.metadata ?? {},
        startedAt: now,
        endedAt: null,
        lastActiveAt: now,
      };
      memory.sessions.set(record.id, record);
      return record;
    },
    async endSession(id, status = "ended", metadata) {
      const current = memory.sessions.get(id);
      if (!current) return;
      const now = new Date().toISOString();
      memory.sessions.set(id, {
        ...current,
        status,
        endedAt: now,
        lastActiveAt: now,
        metadata: { ...(current.metadata ?? {}), ...(metadata ?? {}) },
      });
    },
    async getSession(id) {
      return memory.sessions.get(id) ?? null;
    },
    async listSessions(limit = 50) {
      return Array.from(memory.sessions.values())
        .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
        .slice(0, limit);
    },
    async listSessionSummaries(limit = 50) {
      const sessions = await this.listSessions(limit);
      const turns = Array.from(memory.turns.values());
      return sessions.map((session) => ({
        ...session,
        contextBuildCount: memory.contexts.filter((row) => row.sessionId === session.id).length,
        turnCount: turns.filter((row) => row.sessionId === session.id).length,
        eventCount: memory.events.filter((row) => row.sessionId === session.id).length,
      }));
    },
    async getSessionDetail(id) {
      const session = memory.sessions.get(id);
      if (!session) return null;
      const now = new Date().toISOString();
      return {
        session,
        contextBuilds: memory.contexts
          .filter((row) => row.sessionId === id)
          .map((row) => ({
            id: row.id ?? "",
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
            selectedPages: row.selectedPages ?? [],
            curatorTrace: row.curatorTrace ?? {},
            timingTrace: row.timingTrace ?? {},
            promptChunk: row.promptChunk,
            systemPrompt: row.systemPrompt,
            metadata: row.metadata ?? {},
            createdAt: now,
          })),
        turns: Array.from(memory.turns.values())
          .filter((row) => row.sessionId === id)
          .map((row) => ({
            id: row.id,
            sessionId: row.sessionId,
            turnIndex: row.turnIndex,
            inputMode: row.inputMode,
            userText: row.userText,
            assistantText: row.assistantText,
            provider: row.provider,
            model: row.model,
            status: row.status,
            startedAt: row.startedAt ?? now,
            completedAt: row.completedAt,
            tokenUsage: row.tokenUsage ?? {},
            audioMetrics: row.audioMetrics ?? {},
            latencySummary: row.latencySummary ?? {},
            trace: row.trace ?? {},
            metadata: row.metadata ?? {},
            createdAt: now,
            updatedAt: now,
          })),
        events: memory.events
          .filter((row) => row.sessionId === id)
          .map((row) => ({
            id: row.id ?? "",
            sessionId: row.sessionId,
            turnId: row.turnId,
            type: row.type,
            source: row.source,
            payload: row.payload ?? {},
            createdAt: row.createdAt ?? now,
          })),
      };
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
  };
}

function neonStore(): WorldSessionStore {
  const db = getDb();
  if (!db) return memoryStore();

  return {
    async createSession(input) {
      const id = input.id ?? crypto.randomUUID();
      const now = new Date();
      try {
        const [row] = await db
          .insert(worldSessionsTable)
          .values({
            id,
            userId: input.userId ?? null,
            worldId: input.worldId ?? null,
            characterId: input.characterId ?? null,
            mode: input.mode,
            status: input.status ?? "active",
            initialMoment: input.initialMoment ?? null,
            initialScene: input.initialScene ?? null,
            currentMoment: input.currentMoment ?? input.initialMoment ?? null,
            currentScene: input.currentScene ?? input.initialScene ?? null,
            metadata: input.metadata ?? {},
            startedAt: now,
            lastActiveAt: now,
          })
          .onConflictDoUpdate({
            target: worldSessionsTable.id,
            set: {
              status: input.status ?? "active",
              currentMoment: input.currentMoment ?? input.initialMoment ?? null,
              currentScene: input.currentScene ?? input.initialScene ?? null,
              metadata: input.metadata ?? {},
              lastActiveAt: now,
            },
          })
          .returning();
        return normalizeSession(row);
      } catch (error) {
        if (isMissingTableError(error)) return memoryStore().createSession({ ...input, id });
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
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
    },

    async getSession(id) {
      try {
        const [row] = await db
          .select()
          .from(worldSessionsTable)
          .where(eq(worldSessionsTable.id, id))
          .limit(1);
        return row ? normalizeSession(row) : null;
      } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
    },

    async listSessions(limit = 50) {
      try {
        const rows = await db
          .select()
          .from(worldSessionsTable)
          .orderBy(desc(worldSessionsTable.lastActiveAt))
          .limit(limit);
        return rows.map(normalizeSession);
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
    },

    async listSessionSummaries(limit = 50) {
      try {
        const sessions = await this.listSessions(limit);
        return Promise.all(
          sessions.map(async (session) => {
            const [contextRow] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(worldSessionContextBuildsTable)
              .where(eq(worldSessionContextBuildsTable.sessionId, session.id));
            const [turnRow] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(worldSessionTurnsTable)
              .where(eq(worldSessionTurnsTable.sessionId, session.id));
            const [eventRow] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(worldSessionEventsTable)
              .where(eq(worldSessionEventsTable.sessionId, session.id));
            return {
              ...session,
              contextBuildCount: contextRow?.count ?? 0,
              turnCount: turnRow?.count ?? 0,
              eventCount: eventRow?.count ?? 0,
            };
          }),
        );
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
    },

    async getSessionDetail(id) {
      try {
        const session = await this.getSession(id);
        if (!session) return null;
        const [contexts, turns, events] = await Promise.all([
          db
            .select()
            .from(worldSessionContextBuildsTable)
            .where(eq(worldSessionContextBuildsTable.sessionId, id))
            .orderBy(asc(worldSessionContextBuildsTable.createdAt)),
          db
            .select()
            .from(worldSessionTurnsTable)
            .where(eq(worldSessionTurnsTable.sessionId, id))
            .orderBy(asc(worldSessionTurnsTable.startedAt)),
          db
            .select()
            .from(worldSessionEventsTable)
            .where(eq(worldSessionEventsTable.sessionId, id))
            .orderBy(asc(worldSessionEventsTable.createdAt)),
        ]);
        return {
          session,
          contextBuilds: contexts.map(normalizeContextBuild),
          turns: turns.map(normalizeTurn),
          events: events.map(normalizeEvent),
        };
      } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
    },

    async recordContextBuild(input) {
      try {
        await db.insert(worldSessionContextBuildsTable).values({
          id: input.id ?? crypto.randomUUID(),
          sessionId: input.sessionId,
          turnId: input.turnId ?? null,
          mode: input.mode,
          promptKind: input.promptKind,
          query: input.query ?? null,
          moment: input.moment ?? null,
          scene: input.scene ?? null,
          tokenBudget: input.tokenBudget ?? null,
          tokensUsed: input.tokensUsed ?? null,
          tokensBudget: input.tokensBudget ?? null,
          selectedPages: input.selectedPages ?? [],
          curatorTrace: input.curatorTrace ?? {},
          timingTrace: input.timingTrace ?? {},
          promptChunk: input.promptChunk ?? null,
          systemPrompt: input.systemPrompt ?? null,
          metadata: input.metadata ?? {},
        });
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
    },

    async upsertTurn(input) {
      const now = new Date();
      try {
        await db
          .insert(worldSessionTurnsTable)
          .values({
            id: input.id,
            sessionId: input.sessionId,
            turnIndex: input.turnIndex ?? null,
            inputMode: input.inputMode,
            userText: input.userText ?? null,
            assistantText: input.assistantText ?? null,
            provider: input.provider ?? null,
            model: input.model ?? null,
            status: input.status,
            startedAt: input.startedAt ? new Date(input.startedAt) : now,
            completedAt: input.completedAt ? new Date(input.completedAt) : null,
            tokenUsage: input.tokenUsage ?? {},
            audioMetrics: input.audioMetrics ?? {},
            latencySummary: input.latencySummary ?? {},
            trace: input.trace ?? {},
            metadata: input.metadata ?? {},
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: worldSessionTurnsTable.id,
            set: {
              assistantText: input.assistantText ?? null,
              provider: input.provider ?? null,
              model: input.model ?? null,
              status: input.status,
              completedAt: input.completedAt ? new Date(input.completedAt) : null,
              tokenUsage: input.tokenUsage ?? {},
              audioMetrics: input.audioMetrics ?? {},
              latencySummary: input.latencySummary ?? {},
              trace: input.trace ?? {},
              metadata: input.metadata ?? {},
              updatedAt: now,
            },
          });
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
    },

    async appendEvent(input) {
      try {
        await db.insert(worldSessionEventsTable).values({
          id: input.id ?? crypto.randomUUID(),
          sessionId: input.sessionId,
          turnId: input.turnId ?? null,
          type: input.type,
          source: input.source,
          payload: input.payload ?? {},
          createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
        });
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
    },
  };
}

let _store: WorldSessionStore | null = null;

export function getWorldSessionStore(): WorldSessionStore {
  if (!_store) _store = neonStore();
  return _store;
}
