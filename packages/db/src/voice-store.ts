import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, voicesTable } from "./schema";

export type VoiceStatus = "uploaded" | "processing" | "ready" | "failed";

export interface VoiceRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: VoiceStatus;
  statusError: string | null;
  sourcePath: string | null;
  embeddingPath: string | null;
  previewPath: string | null;
  durationS: number | null;
  sampleRate: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  // Hydrated separately by list/getById; null on raw normalize.
  boundCharacterCount?: number;
}

export interface CreateVoiceInput {
  slug: string;
  name: string;
  description?: string | null;
  sourcePath?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
  createdBy?: string | null;
}

export interface UpdateVoiceInput {
  name?: string;
  description?: string | null;
  status?: VoiceStatus;
  statusError?: string | null;
  sourcePath?: string | null;
  embeddingPath?: string | null;
  previewPath?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the voice store");
  return db;
}

function isMissingVoicesTableError(error: unknown) {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

function isRecoverableReadError(error: unknown) {
  if (isMissingVoicesTableError(error)) return true;
  const message =
    (error as { message?: string })?.message ??
    (error as { cause?: { message?: string } })?.cause?.message ??
    "";
  return message.includes("Failed query:");
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function normalize(row: typeof voicesTable.$inferSelect): VoiceRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    status: row.status as VoiceStatus,
    statusError: row.statusError,
    sourcePath: row.sourcePath,
    embeddingPath: row.embeddingPath,
    previewPath: row.previewPath,
    durationS: row.durationS,
    sampleRate: row.sampleRate,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Slim character row shape used by the voice detail page to render
 * bindings — just enough to render the avatar + title + slug + summary.
 * Full CharacterRecord is overkill and pulls in fields we never read here.
 */
export interface BoundCharacterSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  thumbnailColor: string | null;
}

export interface VoiceStore {
  list(): Promise<VoiceRecord[]>;
  getById(id: string): Promise<VoiceRecord | null>;
  getBySlug(slug: string): Promise<VoiceRecord | null>;
  create(input: CreateVoiceInput): Promise<VoiceRecord>;
  update(id: string, input: UpdateVoiceInput): Promise<VoiceRecord | null>;
  remove(id: string): Promise<boolean>;
  countCharactersUsing(voiceId: string): Promise<number>;
  listBoundCharacters(voiceId: string): Promise<BoundCharacterSummary[]>;
}

function neonStore(): VoiceStore {
  return {
    async list() {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select({
              voice: voicesTable,
              boundCount: sql<number>`(
                SELECT count(*)::int FROM ${charactersTable}
                WHERE ${charactersTable.voiceId} = ${voicesTable.id}
              )`,
            })
            .from(voicesTable)
            .orderBy(desc(voicesTable.createdAt)),
        );
        return rows.map((r) => ({
          ...normalize(r.voice),
          boundCharacterCount: r.boundCount,
        }));
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async getById(id) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(voicesTable)
            .where(eq(voicesTable.id, id))
            .limit(1),
        );
        return row ? normalize(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async getBySlug(slug) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(voicesTable)
            .where(eq(voicesTable.slug, slug))
            .limit(1),
        );
        return row ? normalize(row) : null;
      } catch (error) {
        if (isRecoverableReadError(error)) return null;
        throw error;
      }
    },

    async create(input) {
      const db = requireDb();
      const now = new Date();
      const [row] = await db
        .insert(voicesTable)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          status: "uploaded",
          sourcePath: input.sourcePath ?? null,
          durationS: input.durationS ?? null,
          sampleRate: input.sampleRate ?? null,
          createdBy: input.createdBy ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return normalize(row);
    },

    async update(id, input) {
      const db = requireDb();
      const values: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(input)) {
        if (v !== undefined) values[k] = v;
      }
      const [row] = await db
        .update(voicesTable)
        .set(values)
        .where(eq(voicesTable.id, id))
        .returning();
      return row ? normalize(row) : null;
    },

    async remove(id) {
      const db = requireDb();
      const result = await db
        .delete(voicesTable)
        .where(eq(voicesTable.id, id))
        .returning();
      return result.length > 0;
    },

    async countCharactersUsing(voiceId) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select({ n: sql<number>`count(*)::int` })
            .from(charactersTable)
            .where(eq(charactersTable.voiceId, voiceId)),
        );
        return row?.n ?? 0;
      } catch (error) {
        if (isRecoverableReadError(error)) return 0;
        throw error;
      }
    },

    async listBoundCharacters(voiceId) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select({
              id: charactersTable.id,
              slug: charactersTable.slug,
              title: charactersTable.title,
              summary: charactersTable.summary,
              image: charactersTable.image,
              thumbnailColor: charactersTable.thumbnailColor,
            })
            .from(charactersTable)
            .where(eq(charactersTable.voiceId, voiceId)),
        );
        return rows;
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },
  };
}

let _store: VoiceStore | null = null;

export function getVoiceStore(): VoiceStore {
  if (!_store) _store = neonStore();
  return _store;
}
