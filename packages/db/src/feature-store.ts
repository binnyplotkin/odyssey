import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { featuresTable } from "./schema";

/* ── Types ────────────────────────────────────────────────────── */

export type FeatureRecord = {
  id: string;
  versionId: string;
  title: string;
  description: string | null;
  color: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateFeatureInput = {
  versionId: string;
  title: string;
  description?: string;
  color?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  sortOrder?: number;
};

export type UpdateFeatureInput = Partial<Omit<FeatureRecord, "id" | "createdAt">>;

export interface FeatureStore {
  list(versionId?: string): Promise<FeatureRecord[]>;
  getById(id: string): Promise<FeatureRecord | null>;
  create(input: CreateFeatureInput): Promise<FeatureRecord>;
  update(id: string, input: UpdateFeatureInput): Promise<FeatureRecord | null>;
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

const globalFeatures: Map<string, FeatureRecord> =
  (globalThis as unknown as Record<string, unknown>).__odysseyFeatures as Map<string, FeatureRecord> ??
  ((globalThis as unknown as Record<string, unknown>).__odysseyFeatures = new Map());

function memoryStore(): FeatureStore {
  return {
    async list(versionId?) {
      let items = Array.from(globalFeatures.values());
      if (versionId) items = items.filter((f) => f.versionId === versionId);
      return items.sort(
        (a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    },

    async getById(id) {
      return globalFeatures.get(id) ?? null;
    },

    async create(input) {
      const now = toIso(new Date());
      const record: FeatureRecord = {
        id: crypto.randomUUID(),
        versionId: input.versionId,
        title: input.title,
        description: input.description ?? null,
        color: input.color ?? null,
        status: input.status,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      globalFeatures.set(record.id, record);
      return record;
    },

    async update(id, input) {
      const existing = globalFeatures.get(id);
      if (!existing) return null;
      const updated: FeatureRecord = {
        ...existing,
        ...input,
        updatedAt: toIso(new Date()),
      };
      globalFeatures.set(id, updated);
      return updated;
    },

    async remove(id) {
      return globalFeatures.delete(id);
    },
  };
}

/* ── Neon (Postgres) implementation ──────────────────────────── */

function neonStore(): FeatureStore {
  function normalize(row: typeof featuresTable.$inferSelect): FeatureRecord {
    return {
      id: row.id,
      versionId: row.versionId,
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
    async list(versionId?) {
      const db = getDb();
      if (!db) return memoryStore().list(versionId);
      try {
        const query = versionId
          ? db.select().from(featuresTable).where(eq(featuresTable.versionId, versionId))
          : db.select().from(featuresTable);
        const rows = await query;
        return rows.map(normalize).sort(
          (a, b) => a.sortOrder - b.sortOrder || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().list(versionId);
        throw e;
      }
    },

    async getById(id) {
      const db = getDb();
      if (!db) return memoryStore().getById(id);
      try {
        const [row] = await db.select().from(featuresTable).where(eq(featuresTable.id, id)).limit(1);
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
          .insert(featuresTable)
          .values({
            versionId: input.versionId,
            title: input.title,
            description: input.description ?? null,
            color: input.color ?? null,
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
          .update(featuresTable)
          .set(values)
          .where(eq(featuresTable.id, id))
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
        const result = await db.delete(featuresTable).where(eq(featuresTable.id, id)).returning();
        return result.length > 0;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().remove(id);
        throw e;
      }
    },
  };
}

/* ── Factory ─────────────────────────────────────────────────── */

let _store: FeatureStore | null = null;

export function getFeatureStore(): FeatureStore {
  if (!_store) {
    _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
  }
  return _store;
}
