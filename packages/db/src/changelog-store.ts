import { eq, desc } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { changelogEntriesTable } from "./schema";

/* ── Types ────────────────────────────────────────────────────── */

export type ChangelogEntryRecord = {
  id: string;
  versionId: string | null;
  title: string;
  body: string | null;
  category: string;
  commitSha: string | null;
  prNumber: number | null;
  prTitle: string | null;
  branch: string | null;
  author: string | null;
  diffSummary: string | null;
  createdAt: string;
};

export type CreateChangelogEntryInput = {
  versionId?: string;
  title: string;
  body?: string;
  category: string;
  commitSha?: string;
  prNumber?: number;
  prTitle?: string;
  branch?: string;
  author?: string;
  diffSummary?: string;
};

export type UpdateChangelogEntryInput = Partial<Omit<ChangelogEntryRecord, "id" | "createdAt">>;

export interface ChangelogStore {
  list(versionId?: string): Promise<ChangelogEntryRecord[]>;
  getById(id: string): Promise<ChangelogEntryRecord | null>;
  create(input: CreateChangelogEntryInput): Promise<ChangelogEntryRecord>;
  update(id: string, input: UpdateChangelogEntryInput): Promise<ChangelogEntryRecord | null>;
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

const globalChangelog: Map<string, ChangelogEntryRecord> =
  (globalThis as unknown as Record<string, unknown>).__odysseyChangelog as Map<string, ChangelogEntryRecord> ??
  ((globalThis as unknown as Record<string, unknown>).__odysseyChangelog = new Map());

function memoryStore(): ChangelogStore {
  return {
    async list(versionId?) {
      let entries = Array.from(globalChangelog.values());
      if (versionId) entries = entries.filter((e) => e.versionId === versionId);
      return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    async getById(id) {
      return globalChangelog.get(id) ?? null;
    },
    async create(input) {
      const now = toIso(new Date());
      const record: ChangelogEntryRecord = {
        id: crypto.randomUUID(),
        versionId: input.versionId ?? null,
        title: input.title,
        body: input.body ?? null,
        category: input.category,
        commitSha: input.commitSha ?? null,
        prNumber: input.prNumber ?? null,
        prTitle: input.prTitle ?? null,
        branch: input.branch ?? null,
        author: input.author ?? null,
        diffSummary: input.diffSummary ?? null,
        createdAt: now,
      };
      globalChangelog.set(record.id, record);
      return record;
    },
    async update(id, input) {
      const existing = globalChangelog.get(id);
      if (!existing) return null;
      const updated: ChangelogEntryRecord = { ...existing, ...input };
      globalChangelog.set(id, updated);
      return updated;
    },
    async remove(id) {
      return globalChangelog.delete(id);
    },
  };
}

/* ── Neon implementation ──────────────────────────────────────── */

function neonStore(): ChangelogStore {
  function normalize(row: typeof changelogEntriesTable.$inferSelect): ChangelogEntryRecord {
    return {
      id: row.id,
      versionId: row.versionId,
      title: row.title,
      body: row.body,
      category: row.category,
      commitSha: row.commitSha,
      prNumber: row.prNumber,
      prTitle: row.prTitle,
      branch: row.branch,
      author: row.author,
      diffSummary: row.diffSummary,
      createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
    };
  }

  return {
    async list(versionId?) {
      const db = getDb();
      if (!db) return memoryStore().list(versionId);
      try {
        const rows = await retryRead(() => {
          let query = db.select().from(changelogEntriesTable);
          if (versionId) {
            query = query.where(eq(changelogEntriesTable.versionId, versionId)) as typeof query;
          }
          return query.orderBy(desc(changelogEntriesTable.createdAt));
        });
        return rows.map(normalize);
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().list(versionId);
        throw e;
      }
    },
    async getById(id) {
      const db = getDb();
      if (!db) return memoryStore().getById(id);
      try {
        const [row] = await retryRead(() =>
          db.select().from(changelogEntriesTable).where(eq(changelogEntriesTable.id, id)).limit(1),
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
        const [row] = await db
          .insert(changelogEntriesTable)
          .values({
            versionId: input.versionId ?? null,
            title: input.title,
            body: input.body ?? null,
            category: input.category,
            commitSha: input.commitSha ?? null,
            prNumber: input.prNumber ?? null,
            prTitle: input.prTitle ?? null,
            branch: input.branch ?? null,
            author: input.author ?? null,
            diffSummary: input.diffSummary ?? null,
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
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input)) {
          if (v !== undefined) values[k] = v;
        }
        const [row] = await db
          .update(changelogEntriesTable)
          .set(values)
          .where(eq(changelogEntriesTable.id, id))
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
        const result = await db.delete(changelogEntriesTable).where(eq(changelogEntriesTable.id, id)).returning();
        return result.length > 0;
      } catch (e: unknown) {
        if (isMissingTable(e)) return memoryStore().remove(id);
        throw e;
      }
    },
  };
}

/* ── Factory ─────────────────────────────────────────────────── */

let _store: ChangelogStore | null = null;

export function getChangelogStore(): ChangelogStore {
  if (!_store) {
    _store = process.env.DATABASE_URL ? neonStore() : memoryStore();
  }
  return _store;
}
