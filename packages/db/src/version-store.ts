import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { versionsTable } from "./schema";

/* ── Types ────────────────────────────────────────────────────── */

export type VersionRecord = {
  id: string;
  tag: string;
  title: string;
  description: string | null;
  color: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateVersionInput = {
  tag: string;
  title: string;
  description?: string;
  color: string;
  status: string;
  startDate?: string;
  endDate?: string;
  sortOrder?: number;
};

export type UpdateVersionInput = Partial<Omit<VersionRecord, "id" | "createdAt">>;

export interface VersionStore {
  list(): Promise<VersionRecord[]>;
  getById(id: string): Promise<VersionRecord | null>;
  create(input: CreateVersionInput): Promise<VersionRecord>;
  update(id: string, input: UpdateVersionInput): Promise<VersionRecord | null>;
  remove(id: string): Promise<boolean>;
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

const globalVersions: Map<string, VersionRecord> =
  (globalThis as unknown as Record<string, unknown>).__odysseyVersions as Map<string, VersionRecord> ??
  ((globalThis as unknown as Record<string, unknown>).__odysseyVersions = new Map());

function memoryStore(): VersionStore {
  return {
    async list() {
      return Array.from(globalVersions.values()).sort(
        (a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    },

    async getById(id) {
      return globalVersions.get(id) ?? null;
    },

    async create(input) {
      const now = toIso(new Date());
      const record: VersionRecord = {
        id: crypto.randomUUID(),
        tag: input.tag,
        title: input.title,
        description: input.description ?? null,
        color: input.color,
        status: input.status,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      globalVersions.set(record.id, record);
      return record;
    },

    async update(id, input) {
      const existing = globalVersions.get(id);
      if (!existing) return null;
      const updated: VersionRecord = {
        ...existing,
        ...input,
        updatedAt: toIso(new Date()),
      };
      globalVersions.set(id, updated);
      return updated;
    },

    async remove(id) {
      return globalVersions.delete(id);
    },
  };
}

/* ── Neon (Postgres) implementation ──────────────────────────── */

function neonStore(): VersionStore {
  function normalize(row: typeof versionsTable.$inferSelect): VersionRecord {
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
      if (!db) return memoryStore().list();
      try {
        const rows = await retryRead(() => db.select().from(versionsTable));
        return rows.map(normalize).sort(
          (a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
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
        const [row] = await retryRead(() =>
          db.select().from(versionsTable).where(eq(versionsTable.id, id)).limit(1),
        );
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
          .insert(versionsTable)
          .values({
            tag: input.tag,
            title: input.title,
            description: input.description ?? null,
            color: input.color,
            status: input.status,
            startDate: input.startDate ?? null,
            endDate: input.endDate ?? null,
            sortOrder: input.sortOrder ?? 0,
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
          .update(versionsTable)
          .set(values)
          .where(eq(versionsTable.id, id))
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
        const result = await db.delete(versionsTable).where(eq(versionsTable.id, id)).returning();
        return result.length > 0;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().remove(id);
        throw e;
      }
    },
  };
}

/* ── Factory ─────────────────────────────────────────────────── */

let _store: VersionStore | null = null;

export function getVersionStore(): VersionStore {
  if (!_store) {
    _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
  }
  return _store;
}
