import { desc, eq } from "drizzle-orm";
import { getDb } from "./client";
import { sessionsTable, turnsTable } from "./schema";
import {
  sessionRecordSchema,
  SessionRecord,
  turnRecordSchema,
  TurnRecord,
} from "@odyssey/types";

/**
 * Normalize simulation state from pre-rename DB records
 * (politicalStability→stability, factionInfluence→groupInfluence, etc.)
 */
function normalizeState(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const s = raw as Record<string, unknown>;

  const stability = (s.stability ?? s.politicalStability) as number | undefined;
  const morale = (s.morale ?? s.publicSentiment) as number | undefined;
  const resources = (s.resources ?? s.treasury) as number | undefined;
  const pressure = (s.pressure ?? s.militaryPressure ?? s.warPressure) as number | undefined;

  // Synthesize metricValues from legacy flat fields if absent
  let metricValues = s.metricValues as Record<string, number> | undefined;
  if (!metricValues || Object.keys(metricValues).length === 0) {
    metricValues = {};
    if (stability !== undefined) metricValues.stability = stability;
    if (morale !== undefined) metricValues.morale = morale;
    if (resources !== undefined) metricValues.resources = resources;
    if (pressure !== undefined) metricValues.pressure = pressure;
  }

  return {
    ...s,
    stability,
    morale,
    resources,
    pressure,
    metricValues,
    groupInfluence: s.groupInfluence ?? s.factionInfluence,
  };
}

type StoreState = {
  sessions: Map<string, SessionRecord>;
  turns: Map<string, TurnRecord[]>;
};

const globalStore = globalThis as typeof globalThis & {
  __odysseyStore?: StoreState;
};

const memoryStore =
  globalStore.__odysseyStore ??
  (globalStore.__odysseyStore = {
    sessions: new Map(),
    turns: new Map(),
  });

export interface PersistenceStore {
  createSession(session: SessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  updateSession(session: SessionRecord): Promise<void>;
  listSessions(): Promise<SessionRecord[]>;
  appendTurn(turn: TurnRecord): Promise<void>;
  getTurns(sessionId: string): Promise<TurnRecord[]>;
}

class MemoryPersistenceStore implements PersistenceStore {
  async createSession(session: SessionRecord) {
    memoryStore.sessions.set(session.id, session);
  }

  async getSession(sessionId: string) {
    return memoryStore.sessions.get(sessionId) ?? null;
  }

  async updateSession(session: SessionRecord) {
    memoryStore.sessions.set(session.id, session);
  }

  async listSessions() {
    return Array.from(memoryStore.sessions.values()).sort((left, right) =>
      right.lastActiveAt.localeCompare(left.lastActiveAt),
    );
  }

  async appendTurn(turn: TurnRecord) {
    const turns = memoryStore.turns.get(turn.sessionId) ?? [];
    turns.push(turn);
    memoryStore.turns.set(turn.sessionId, turns);
  }

  async getTurns(sessionId: string) {
    return memoryStore.turns.get(sessionId) ?? [];
  }
}

class NeonPersistenceStore implements PersistenceStore {
  private db = getDb();

  async createSession(session: SessionRecord) {
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

  async getSession(sessionId: string) {
    if (!this.db) {
      return null;
    }

    const rows = await this.db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, sessionId))
      .limit(1);

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

  async updateSession(session: SessionRecord) {
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

    const rows = await this.db
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.lastActiveAt))
      .limit(12);

    return rows.map((row) =>
      sessionRecordSchema.parse({
        id: row.id,
        worldId: row.worldId,
        roleId: row.roleId,
        status: row.status,
        currentStateVersion: row.currentStateVersion,
        state: normalizeState(row.state),
        createdAt: row.createdAt.toISOString(),
        lastActiveAt: row.lastActiveAt.toISOString(),
      }),
    );
  }

  async appendTurn(turn: TurnRecord) {
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

  async getTurns(sessionId: string) {
    if (!this.db) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(turnsTable)
      .where(eq(turnsTable.sessionId, sessionId))
      .orderBy(desc(turnsTable.stateVersion));

    return rows
      .map((row) =>
        turnRecordSchema.parse({
          id: row.id,
          sessionId: row.sessionId,
          stateVersion: row.stateVersion,
          input: row.input,
          result: row.result,
          stateDeltaSummary: row.stateDeltaSummary,
          createdAt: row.createdAt.toISOString(),
        }),
      )
      .reverse();
  }
}

export function getPersistenceStore(): PersistenceStore {
  return process.env.DATABASE_URL
    ? new NeonPersistenceStore()
    : new MemoryPersistenceStore();
}
