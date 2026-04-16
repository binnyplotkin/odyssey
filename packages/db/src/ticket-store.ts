import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { ticketsTable } from "./schema";

/* ── Types ────────────────────────────────────────────────────── */

export type TicketRecord = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  domain: string | null;
  priority: string | null;
  assignee: string | null;
  phase: string | null;
  featureId: string | null;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  subtasks: unknown | null;
  activity: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateTicketInput = {
  title: string;
  description?: string;
  status: string;
  domain?: string;
  priority?: string;
  assignee?: string;
  phase?: string;
  featureId?: string;
  sortOrder?: number;
  startDate?: string;
  endDate?: string;
  subtasks?: unknown;
  activity?: unknown;
};

export type UpdateTicketInput = Partial<Omit<TicketRecord, "id" | "createdAt">>;

export interface TicketStore {
  list(): Promise<TicketRecord[]>;
  getById(id: string): Promise<TicketRecord | null>;
  create(input: CreateTicketInput): Promise<TicketRecord>;
  update(id: string, input: UpdateTicketInput): Promise<TicketRecord | null>;
  remove(id: string): Promise<boolean>;
  listByFeature(featureId: string): Promise<TicketRecord[]>;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function toIso(d: Date): string {
  return d.toISOString();
}

function isMissingTable(e: unknown): boolean {
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  if (code === "42P01") return true;
  return e instanceof Error && e.message.includes("42P01");
}

/* ── Memory implementation ────────────────────────────────────── */

const globalTickets: Map<string, TicketRecord> =
  (globalThis as unknown as Record<string, unknown>).__odysseyTickets as Map<string, TicketRecord> ??
  ((globalThis as unknown as Record<string, unknown>).__odysseyTickets = new Map());

function memoryStore(): TicketStore {
  return {
    async list() {
      return Array.from(globalTickets.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },

    async getById(id) {
      return globalTickets.get(id) ?? null;
    },

    async create(input) {
      const now = toIso(new Date());
      const record: TicketRecord = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        domain: input.domain ?? null,
        priority: input.priority ?? null,
        assignee: input.assignee ?? null,
        phase: input.phase ?? null,
        featureId: input.featureId ?? null,
        sortOrder: input.sortOrder ?? 0,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        subtasks: input.subtasks ?? null,
        activity: input.activity ?? null,
        createdAt: now,
        updatedAt: now,
      };
      globalTickets.set(record.id, record);
      return record;
    },

    async update(id, input) {
      const existing = globalTickets.get(id);
      if (!existing) return null;
      const updated: TicketRecord = {
        ...existing,
        ...input,
        updatedAt: toIso(new Date()),
      };
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

function neonStore(): TicketStore {
  function normalize(row: typeof ticketsTable.$inferSelect): TicketRecord {
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
      if (!db) return memoryStore().list();
      try {
        const rows = await db.select().from(ticketsTable);
        return rows.map(normalize).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().list();
        throw e;
      }
    },

    async getById(id) {
      const db = getDb();
      if (!db) return memoryStore().getById(id);
      try {
        const [row] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id)).limit(1);
        return row ? normalize(row) : null;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().getById(id);
        throw e;
      }
    },

    async create(input) {
      const db = getDb();
      if (!db) return memoryStore().create(input);
      try {
        const now = new Date();
        const [row] = await db
          .insert(ticketsTable)
          .values({
            title: input.title,
            description: input.description ?? null,
            status: input.status,
            domain: input.domain ?? null,
            priority: input.priority ?? null,
            assignee: input.assignee ?? null,
            phase: input.phase ?? null,
            featureId: input.featureId ?? null,
            sortOrder: input.sortOrder ?? 0,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            subtasks: input.subtasks ?? null,
            activity: input.activity ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return normalize(row);
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().create(input);
        throw e;
      }
    },

    async update(id, input) {
      const db = getDb();
      if (!db) return memoryStore().update(id, input);
      try {
        const values: Record<string, unknown> = { updatedAt: new Date() };
        for (const [k, v] of Object.entries(input)) {
          if (k !== "updatedAt" && v !== undefined) values[k] = v;
        }
        const [row] = await db
          .update(ticketsTable)
          .set(values)
          .where(eq(ticketsTable.id, id))
          .returning();
        return row ? normalize(row) : null;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().update(id, input);
        throw e;
      }
    },

    async remove(id) {
      const db = getDb();
      if (!db) return memoryStore().remove(id);
      try {
        const result = await db.delete(ticketsTable).where(eq(ticketsTable.id, id)).returning();
        return result.length > 0;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().remove(id);
        throw e;
      }
    },

    async listByFeature(featureId) {
      const db = getDb();
      if (!db) return memoryStore().listByFeature(featureId);
      try {
        const rows = await db.select().from(ticketsTable).where(eq(ticketsTable.featureId, featureId));
        return rows.map(normalize).sort(
          (a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().listByFeature(featureId);
        throw e;
      }
    },
  };
}

/* ── Factory ─────────────────────────────────────────────────── */

let _store: TicketStore | null = null;

export function getTicketStore(): TicketStore {
  if (!_store) {
    _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
  }
  return _store;
}
