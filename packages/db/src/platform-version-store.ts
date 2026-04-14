import { eq, desc } from "drizzle-orm";
import { getDb } from "./client";
import { platformVersionsTable } from "./schema";

/* ── Types ────────────────────────────────────────────────────── */

export type PlatformVersionRecord = {
  id: string;
  version: string;
  title: string;
  summary: string | null;
  status: string;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlatformVersionInput = {
  version: string;
  title: string;
  summary?: string;
  status?: string;
};

export type UpdatePlatformVersionInput = Partial<Omit<PlatformVersionRecord, "id" | "createdAt">>;

export interface PlatformVersionStore {
  list(): Promise<PlatformVersionRecord[]>;
  getById(id: string): Promise<PlatformVersionRecord | null>;
  getByVersion(version: string): Promise<PlatformVersionRecord | null>;
  create(input: CreatePlatformVersionInput): Promise<PlatformVersionRecord>;
  update(id: string, input: UpdatePlatformVersionInput): Promise<PlatformVersionRecord | null>;
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

const globalPlatformVersions: Map<string, PlatformVersionRecord> =
  (globalThis as unknown as Record<string, unknown>).__odysseyPlatformVersions as Map<string, PlatformVersionRecord> ??
  ((globalThis as unknown as Record<string, unknown>).__odysseyPlatformVersions = new Map());

function memoryStore(): PlatformVersionStore {
  return {
    async list() {
      return Array.from(globalPlatformVersions.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    async getById(id) {
      return globalPlatformVersions.get(id) ?? null;
    },
    async getByVersion(version) {
      for (const r of globalPlatformVersions.values()) {
        if (r.version === version) return r;
      }
      return null;
    },
    async create(input) {
      const now = toIso(new Date());
      const record: PlatformVersionRecord = {
        id: crypto.randomUUID(),
        version: input.version,
        title: input.title,
        summary: input.summary ?? null,
        status: input.status ?? "draft",
        releasedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      globalPlatformVersions.set(record.id, record);
      return record;
    },
    async update(id, input) {
      const existing = globalPlatformVersions.get(id);
      if (!existing) return null;
      const updated: PlatformVersionRecord = { ...existing, ...input, updatedAt: toIso(new Date()) };
      globalPlatformVersions.set(id, updated);
      return updated;
    },
    async remove(id) {
      return globalPlatformVersions.delete(id);
    },
  };
}

/* ── Neon implementation ──────────────────────────────────────── */

function neonStore(): PlatformVersionStore {
  function normalize(row: typeof platformVersionsTable.$inferSelect): PlatformVersionRecord {
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      status: row.status,
      releasedAt: row.releasedAt instanceof Date ? toIso(row.releasedAt) : row.releasedAt ? String(row.releasedAt) : null,
      createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? toIso(row.updatedAt) : String(row.updatedAt),
    };
  }

  return {
    async list() {
      const db = getDb();
      if (!db) return memoryStore().list();
      try {
        const rows = await db.select().from(platformVersionsTable).orderBy(desc(platformVersionsTable.createdAt));
        return rows.map(normalize);
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().list();
        throw e;
      }
    },
    async getById(id) {
      const db = getDb();
      if (!db) return memoryStore().getById(id);
      try {
        const [row] = await db.select().from(platformVersionsTable).where(eq(platformVersionsTable.id, id)).limit(1);
        return row ? normalize(row) : null;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().getById(id);
        throw e;
      }
    },
    async getByVersion(version) {
      const db = getDb();
      if (!db) return memoryStore().getByVersion(version);
      try {
        const [row] = await db.select().from(platformVersionsTable).where(eq(platformVersionsTable.version, version)).limit(1);
        return row ? normalize(row) : null;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().getByVersion(version);
        throw e;
      }
    },
    async create(input) {
      const db = getDb();
      if (!db) return memoryStore().create(input);
      try {
        const now = new Date();
        const [row] = await db
          .insert(platformVersionsTable)
          .values({
            version: input.version,
            title: input.title,
            summary: input.summary ?? null,
            status: input.status ?? "draft",
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
          .update(platformVersionsTable)
          .set(values)
          .where(eq(platformVersionsTable.id, id))
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
        const result = await db.delete(platformVersionsTable).where(eq(platformVersionsTable.id, id)).returning();
        return result.length > 0;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().remove(id);
        throw e;
      }
    },
  };
}

/* ── Factory ─────────────────────────────────────────────────── */

let _store: PlatformVersionStore | null = null;

export function getPlatformVersionStore(): PlatformVersionStore {
  if (!_store) {
    _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
  }
  return _store;
}
