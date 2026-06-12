import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  usersTable,
  sceneSessionAudioArtifactsTable,
  sceneSessionContextBuildsTable,
  sceneSessionEventsTable,
  sceneSessionsTable,
  sceneSessionTurnsTable,
} from "./schema";

type JsonRecord = Record<string, unknown>;

export type SceneSessionRecord = {
  id: string;
  userId?: string | null;
  sceneId?: string | null;
  characterId?: string | null;
  mode: "chat" | "voice" | "mixed" | string;
  status: "active" | "ended" | "error" | string;
  initialScene?: unknown;
  currentScene?: unknown;
  metadata?: JsonRecord;
  startedAt: string;
  endedAt?: string | null;
  lastActiveAt: string;
};

export type SceneSessionContextBuildRecord = {
  id: string;
  sessionId: string;
  turnId?: string | null;
  mode: string;
  promptKind: string;
  query?: string | null;
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

export type SceneSessionTurnRecord = {
  id: string;
  sessionId: string;
  turnIndex?: number | null;
  inputMode: string;
  speakerSlug?: string | null;
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

export type SceneSessionEventRecord = {
  id: string;
  sessionId: string;
  turnId?: string | null;
  type: string;
  source: string;
  payload: unknown;
  createdAt: string;
};

export type SceneSessionUserRecord = {
  id: string;
  name?: string | null;
  email: string;
  image?: string | null;
};

export type SceneSessionAudioArtifactRecord = {
  id: string;
  sessionId: string;
  turnId?: string | null;
  direction: "input" | "output" | string;
  mimeType: string;
  durationMs?: number | null;
  sampleRate?: number | null;
  byteSize: number;
  storageKey: string;
  waveformSummary: unknown;
  metadata: JsonRecord;
  createdAt: string;
};

export type SceneSessionSummaryRecord = SceneSessionRecord & {
  user: SceneSessionUserRecord | null;
  contextBuildCount: number;
  turnCount: number;
  eventCount: number;
};

export type SceneSessionDetailRecord = {
  session: SceneSessionRecord;
  user: SceneSessionUserRecord | null;
  contextBuilds: SceneSessionContextBuildRecord[];
  turns: SceneSessionTurnRecord[];
  events: SceneSessionEventRecord[];
  audioArtifacts: SceneSessionAudioArtifactRecord[];
};

export type CreateSceneSessionInput = {
  id?: string;
  userId?: string | null;
  sceneId?: string | null;
  characterId?: string | null;
  mode: string;
  status?: string;
  initialScene?: unknown;
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

export type UpsertSceneSessionTurnInput = {
  id: string;
  sessionId: string;
  turnIndex?: number | null;
  inputMode: string;
  speakerSlug?: string | null;
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

export type AppendSceneSessionEventInput = {
  id?: string;
  sessionId: string;
  turnId?: string | null;
  type: string;
  source: string;
  payload?: unknown;
  createdAt?: string;
};

export type UpdateSceneSessionSceneInput = {
  sessionId: string;
  currentScene: unknown;
};

export type AddSceneSessionAudioArtifactInput = {
  id?: string;
  sessionId: string;
  turnId?: string | null;
  direction: string;
  mimeType: string;
  durationMs?: number | null;
  sampleRate?: number | null;
  byteSize: number;
  storageKey: string;
  waveformSummary?: unknown;
  metadata?: JsonRecord;
};

export interface SceneSessionStore {
  createSession(input: CreateSceneSessionInput): Promise<SceneSessionRecord>;
  endSession(id: string, status?: string, metadata?: JsonRecord): Promise<void>;
  getSession(id: string): Promise<SceneSessionRecord | null>;
  listSessions(limit?: number): Promise<SceneSessionRecord[]>;
  listSessionSummaries(limit?: number): Promise<SceneSessionSummaryRecord[]>;
  getSessionDetail(id: string): Promise<SceneSessionDetailRecord | null>;
  updateCurrentScene(input: UpdateSceneSessionSceneInput): Promise<void>;
  recordContextBuild(input: RecordContextBuildInput): Promise<void>;
  upsertTurn(input: UpsertSceneSessionTurnInput): Promise<void>;
  appendEvent(input: AppendSceneSessionEventInput): Promise<void>;
  addAudioArtifact(input: AddSceneSessionAudioArtifactInput): Promise<SceneSessionAudioArtifactRecord>;
  listAudioArtifacts(sessionId: string): Promise<SceneSessionAudioArtifactRecord[]>;
  getAudioArtifact(sessionId: string, artifactId: string): Promise<SceneSessionAudioArtifactRecord | null>;
}

type MemoryState = {
  sessions: Map<string, SceneSessionRecord>;
  contexts: RecordContextBuildInput[];
  turns: Map<string, UpsertSceneSessionTurnInput>;
  events: AppendSceneSessionEventInput[];
  audioArtifacts: SceneSessionAudioArtifactRecord[];
};

const globalStore = globalThis as typeof globalThis & {
  __odysseySceneSessionStore?: MemoryState;
};

const memory =
  globalStore.__odysseySceneSessionStore ??
  (globalStore.__odysseySceneSessionStore = {
    sessions: new Map(),
    contexts: [] as RecordContextBuildInput[],
    turns: new Map(),
    events: [] as AppendSceneSessionEventInput[],
    audioArtifacts: [] as SceneSessionAudioArtifactRecord[],
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
  return message.includes("scene_sessions") && message.includes("does not exist");
}

function normalizeSession(row: typeof sceneSessionsTable.$inferSelect): SceneSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    sceneId: row.sceneId,
    characterId: row.characterId,
    mode: row.mode,
    status: row.status,
    initialScene: row.initialScene,
    currentScene: row.currentScene,
    metadata: (row.metadata as JsonRecord | null) ?? {},
    startedAt: toIso(row.startedAt)!,
    endedAt: toIso(row.endedAt),
    lastActiveAt: toIso(row.lastActiveAt)!,
  };
}

function normalizeContextBuild(
  row: typeof sceneSessionContextBuildsTable.$inferSelect,
): SceneSessionContextBuildRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnId: row.turnId,
    mode: row.mode,
    promptKind: row.promptKind,
    query: row.query,
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

function normalizeTurn(row: typeof sceneSessionTurnsTable.$inferSelect): SceneSessionTurnRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    turnIndex: row.turnIndex,
    inputMode: row.inputMode,
    speakerSlug: row.speakerSlug,
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

function normalizeEvent(row: typeof sceneSessionEventsTable.$inferSelect): SceneSessionEventRecord {
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

function normalizeAudioArtifact(
  row: typeof sceneSessionAudioArtifactsTable.$inferSelect,
): SceneSessionAudioArtifactRecord {
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
    metadata: (row.metadata as JsonRecord | null) ?? {},
    createdAt: toIso(row.createdAt)!,
  };
}

function normalizeUser(
  row: Pick<typeof usersTable.$inferSelect, "id" | "name" | "email" | "image">,
): SceneSessionUserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
  };
}

function memoryStore(): SceneSessionStore {
  return {
    async createSession(input) {
      const now = new Date().toISOString();
      const record: SceneSessionRecord = {
        id: input.id ?? crypto.randomUUID(),
        userId: input.userId ?? null,
        sceneId: input.sceneId ?? null,
        characterId: input.characterId ?? null,
        mode: input.mode,
        status: input.status ?? "active",
        initialScene: input.initialScene,
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
        user: null,
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
        user: null,
        contextBuilds: memory.contexts
          .filter((row) => row.sessionId === id)
          .map((row) => ({
            id: row.id ?? "",
            sessionId: row.sessionId,
            turnId: row.turnId,
            mode: row.mode,
            promptKind: row.promptKind,
            query: row.query,
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
        audioArtifacts: memory.audioArtifacts.filter((row) => row.sessionId === id),
      };
    },
    async updateCurrentScene(input) {
      const current = memory.sessions.get(input.sessionId);
      if (!current) return;
      memory.sessions.set(input.sessionId, {
        ...current,
        currentScene: input.currentScene,
        lastActiveAt: new Date().toISOString(),
      });
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
      const record: SceneSessionAudioArtifactRecord = {
        id: input.id ?? crypto.randomUUID(),
        sessionId: input.sessionId,
        turnId: input.turnId ?? null,
        direction: input.direction,
        mimeType: input.mimeType,
        durationMs: input.durationMs ?? null,
        sampleRate: input.sampleRate ?? null,
        byteSize: input.byteSize,
        storageKey: input.storageKey,
        waveformSummary: input.waveformSummary ?? {},
        metadata: input.metadata ?? {},
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
      return memory.audioArtifacts.find((row) => row.sessionId === sessionId && row.id === artifactId) ?? null;
    },
  };
}

function neonStore(): SceneSessionStore {
  const db = getDb();
  if (!db) return memoryStore();

  return {
    async createSession(input) {
      const id = input.id ?? crypto.randomUUID();
      const now = new Date();
      try {
        const [row] = await db
          .insert(sceneSessionsTable)
          .values({
            id,
            userId: input.userId ?? null,
            sceneId: input.sceneId ?? null,
            characterId: input.characterId ?? null,
            mode: input.mode,
            status: input.status ?? "active",
            initialScene: input.initialScene ?? null,
            currentScene: input.currentScene ?? input.initialScene ?? null,
            metadata: input.metadata ?? {},
            startedAt: now,
            lastActiveAt: now,
          })
          .onConflictDoUpdate({
            target: sceneSessionsTable.id,
            set: {
              status: input.status ?? "active",
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
          .update(sceneSessionsTable)
          .set({
            status,
            endedAt: new Date(),
            lastActiveAt: new Date(),
            metadata,
          })
          .where(eq(sceneSessionsTable.id, id));
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
    },

    async getSession(id) {
      try {
        const [row] = await retryRead(() =>
          db
            .select()
            .from(sceneSessionsTable)
            .where(eq(sceneSessionsTable.id, id))
            .limit(1),
        );
        return row ? normalizeSession(row) : null;
      } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
    },

    async listSessions(limit = 50) {
      try {
        const rows = await retryRead(() =>
          db
            .select()
            .from(sceneSessionsTable)
            .orderBy(desc(sceneSessionsTable.lastActiveAt))
            .limit(limit),
        );
        return rows.map(normalizeSession);
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
    },

    async listSessionSummaries(limit = 50) {
      try {
        const sessions = await this.listSessions(limit);
        const userIds = Array.from(
          new Set(sessions.map((session) => session.userId).filter((userId): userId is string => !!userId)),
        );
        const users = userIds.length > 0
          ? await retryRead(() =>
              db
                .select({
                  id: usersTable.id,
                  name: usersTable.name,
                  email: usersTable.email,
                  image: usersTable.image,
                })
                .from(usersTable)
                .where(inArray(usersTable.id, userIds)),
            )
          : [];
        const usersById = new Map(users.map((user) => [user.id, normalizeUser(user)]));

        return Promise.all(
          sessions.map(async (session) => {
            const [contextRow] = await retryRead(() =>
              db
                .select({ count: sql<number>`count(*)::int` })
                .from(sceneSessionContextBuildsTable)
                .where(eq(sceneSessionContextBuildsTable.sessionId, session.id)),
            );
            const [turnRow] = await retryRead(() =>
              db
                .select({ count: sql<number>`count(*)::int` })
                .from(sceneSessionTurnsTable)
                .where(eq(sceneSessionTurnsTable.sessionId, session.id)),
            );
            const [eventRow] = await retryRead(() =>
              db
                .select({ count: sql<number>`count(*)::int` })
                .from(sceneSessionEventsTable)
                .where(eq(sceneSessionEventsTable.sessionId, session.id)),
            );
            return {
              ...session,
              user: session.userId ? usersById.get(session.userId) ?? null : null,
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
        const userId = session.userId;
        const [contexts, turns, events, audioArtifacts, users] = await Promise.all([
          retryRead(() =>
            db
              .select()
              .from(sceneSessionContextBuildsTable)
              .where(eq(sceneSessionContextBuildsTable.sessionId, id))
              .orderBy(asc(sceneSessionContextBuildsTable.createdAt)),
          ),
          retryRead(() =>
            db
              .select()
              .from(sceneSessionTurnsTable)
              .where(eq(sceneSessionTurnsTable.sessionId, id))
              .orderBy(asc(sceneSessionTurnsTable.startedAt)),
          ),
          retryRead(() =>
            db
              .select()
              .from(sceneSessionEventsTable)
              .where(eq(sceneSessionEventsTable.sessionId, id))
              .orderBy(asc(sceneSessionEventsTable.createdAt)),
          ),
          retryRead(() =>
            db
              .select()
              .from(sceneSessionAudioArtifactsTable)
              .where(eq(sceneSessionAudioArtifactsTable.sessionId, id))
              .orderBy(asc(sceneSessionAudioArtifactsTable.createdAt)),
          ),
          userId
            ? retryRead(() =>
                db
                  .select({
                    id: usersTable.id,
                    name: usersTable.name,
                    email: usersTable.email,
                    image: usersTable.image,
                  })
                  .from(usersTable)
                  .where(eq(usersTable.id, userId))
                  .limit(1),
              )
            : Promise.resolve([] as Array<{ id: string; name: string | null; email: string; image: string | null }>),
        ]);
        return {
          session,
          user: users[0] ? normalizeUser(users[0]) : null,
          contextBuilds: contexts.map(normalizeContextBuild),
          turns: turns.map(normalizeTurn),
          events: events.map(normalizeEvent),
          audioArtifacts: audioArtifacts.map(normalizeAudioArtifact),
        };
      } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
    },

    async updateCurrentScene(input) {
      try {
        await db
          .update(sceneSessionsTable)
          .set({
            currentScene: input.currentScene,
            lastActiveAt: new Date(),
          })
          .where(eq(sceneSessionsTable.id, input.sessionId));
      } catch (error) {
        if (!isMissingTableError(error)) throw error;
      }
    },

    async recordContextBuild(input) {
      try {
        await db.insert(sceneSessionContextBuildsTable).values({
          id: input.id ?? crypto.randomUUID(),
          sessionId: input.sessionId,
          turnId: input.turnId ?? null,
          mode: input.mode,
          promptKind: input.promptKind,
          query: input.query ?? null,
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
      let resolvedTurnIndex = input.turnIndex ?? null;
      if (resolvedTurnIndex == null) {
        try {
          const [{ count: existing }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(sceneSessionTurnsTable)
            .where(
              and(
                eq(sceneSessionTurnsTable.sessionId, input.sessionId),
                ne(sceneSessionTurnsTable.id, input.id),
              ),
            );
          resolvedTurnIndex = existing ?? 0;
        } catch (error) {
          if (!isMissingTableError(error)) throw error;
        }
      }
      try {
        await db
          .insert(sceneSessionTurnsTable)
          .values({
            id: input.id,
            sessionId: input.sessionId,
            turnIndex: resolvedTurnIndex,
            inputMode: input.inputMode,
            speakerSlug: input.speakerSlug ?? null,
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
            target: sceneSessionTurnsTable.id,
            set: {
              speakerSlug: input.speakerSlug ?? null,
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
        await db.insert(sceneSessionEventsTable).values({
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

    async addAudioArtifact(input) {
      const id = input.id ?? crypto.randomUUID();
      try {
        const [row] = await db
          .insert(sceneSessionAudioArtifactsTable)
          .values({
            id,
            sessionId: input.sessionId,
            turnId: input.turnId ?? null,
            direction: input.direction,
            mimeType: input.mimeType,
            durationMs: input.durationMs ?? null,
            sampleRate: input.sampleRate ?? null,
            byteSize: input.byteSize,
            storageKey: input.storageKey,
            waveformSummary: input.waveformSummary ?? {},
            metadata: input.metadata ?? {},
          })
          .returning();
        return normalizeAudioArtifact(row);
      } catch (error) {
        if (isMissingTableError(error)) return memoryStore().addAudioArtifact({ ...input, id });
        throw error;
      }
    },

    async listAudioArtifacts(sessionId) {
      try {
        const rows = await retryRead(() =>
          db
            .select()
            .from(sceneSessionAudioArtifactsTable)
            .where(eq(sceneSessionAudioArtifactsTable.sessionId, sessionId))
            .orderBy(asc(sceneSessionAudioArtifactsTable.createdAt)),
        );
        return rows.map(normalizeAudioArtifact);
      } catch (error) {
        if (isMissingTableError(error)) return [];
        throw error;
      }
    },

    async getAudioArtifact(sessionId, artifactId) {
      try {
        const [row] = await retryRead(() =>
          db
            .select()
            .from(sceneSessionAudioArtifactsTable)
            .where(eq(sceneSessionAudioArtifactsTable.id, artifactId))
            .limit(1),
        );
        if (!row || row.sessionId !== sessionId) return null;
        return normalizeAudioArtifact(row);
      } catch (error) {
        if (isMissingTableError(error)) return null;
        throw error;
      }
    },
  };
}

let _store: SceneSessionStore | null = null;

export function getSceneSessionStore(): SceneSessionStore {
  if (!_store) _store = neonStore();
  return _store;
}
