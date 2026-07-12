import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { audioAssetsTable } from "./schema";

export type AudioAssetStatus = "uploaded" | "ready" | "failed";

// How the asset entered the library. Adding a generation provider = add a
// value here + a relay route under /api/sounds.
export type AudioAssetSource = "upload" | "elevenlabs_sfx";

export interface AudioAssetRecord {
  id: string;
  slug: string;
  name: string;
  /** LLM-facing description — what the director reads in the audio roster. */
  description: string | null;
  tags: string[];
  loopable: boolean;
  source: AudioAssetSource;
  generationPrompt: string | null;
  status: AudioAssetStatus;
  statusError: string | null;
  sourcePath: string | null;
  processedPath: string | null;
  durationS: number | null;
  sampleRate: number | null;
  rmsDb: number | null;
  peakDb: number | null;
  license: string | null;
  attribution: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAudioAssetInput {
  slug: string;
  name: string;
  description?: string | null;
  tags?: string[];
  loopable?: boolean;
  source?: AudioAssetSource;
  generationPrompt?: string | null;
  status?: AudioAssetStatus;
  sourcePath?: string | null;
  processedPath?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
  rmsDb?: number | null;
  peakDb?: number | null;
  license?: string | null;
  attribution?: string | null;
  createdBy?: string | null;
}

export interface UpdateAudioAssetInput {
  name?: string;
  description?: string | null;
  tags?: string[];
  loopable?: boolean;
  status?: AudioAssetStatus;
  statusError?: string | null;
  sourcePath?: string | null;
  processedPath?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
  rmsDb?: number | null;
  peakDb?: number | null;
  license?: string | null;
  attribution?: string | null;
  archivedAt?: Date | string | null;
  updatedBy?: string | null;
}

export interface ListAudioAssetsOptions {
  /** Include soft-deleted (archived) assets. Default false. */
  includeArchived?: boolean;
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the audio asset store");
  return db;
}

function isMissingTableError(error: unknown) {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

function isRecoverableReadError(error: unknown) {
  if (isMissingTableError(error)) return true;
  const message =
    (error as { message?: string })?.message ??
    (error as { cause?: { message?: string } })?.cause?.message ??
    "";
  return message.includes("Failed query:");
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function toIsoNullable(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return toIso(d);
}

function normalize(row: typeof audioAssetsTable.$inferSelect): AudioAssetRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    tags: row.tags ?? [],
    loopable: row.loopable ?? false,
    source: (row.source as AudioAssetSource) ?? "upload",
    generationPrompt: row.generationPrompt,
    status: row.status as AudioAssetStatus,
    statusError: row.statusError,
    sourcePath: row.sourcePath,
    processedPath: row.processedPath,
    durationS: row.durationS,
    sampleRate: row.sampleRate,
    rmsDb: row.rmsDb,
    peakDb: row.peakDb,
    license: row.license,
    attribution: row.attribution,
    archivedAt: toIsoNullable(row.archivedAt),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export interface AudioAssetStore {
  list(options?: ListAudioAssetsOptions): Promise<AudioAssetRecord[]>;
  getById(id: string): Promise<AudioAssetRecord | null>;
  getBySlug(slug: string): Promise<AudioAssetRecord | null>;
  create(input: CreateAudioAssetInput): Promise<AudioAssetRecord>;
  update(id: string, input: UpdateAudioAssetInput): Promise<AudioAssetRecord | null>;
  /** Soft-delete — sets archivedAt. Scene nodes referencing the asset keep
   * working; the library UI filters it out. */
  archive(id: string, archivedBy?: string | null): Promise<AudioAssetRecord | null>;
  unarchive(id: string, unarchivedBy?: string | null): Promise<AudioAssetRecord | null>;
  /** Hard delete. Prefer `archive` — scene nodes hold refIds to this row. */
  remove(id: string): Promise<boolean>;
}

function neonStore(): AudioAssetStore {
  return {
    async list({ includeArchived = false }: ListAudioAssetsOptions = {}) {
      try {
        const rows = await retryRead(() => {
          const q = requireDb()
            .select()
            .from(audioAssetsTable)
            .orderBy(desc(audioAssetsTable.createdAt));
          return includeArchived
            ? q
            : q.where(isNull(audioAssetsTable.archivedAt));
        });
        return rows.map(normalize);
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
            .from(audioAssetsTable)
            .where(eq(audioAssetsTable.id, id))
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
            .from(audioAssetsTable)
            .where(eq(audioAssetsTable.slug, slug))
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
        .insert(audioAssetsTable)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          tags: input.tags ?? [],
          loopable: input.loopable ?? false,
          source: input.source ?? "upload",
          generationPrompt: input.generationPrompt ?? null,
          status: input.status ?? "uploaded",
          sourcePath: input.sourcePath ?? null,
          processedPath: input.processedPath ?? null,
          durationS: input.durationS ?? null,
          sampleRate: input.sampleRate ?? null,
          rmsDb: input.rmsDb ?? null,
          peakDb: input.peakDb ?? null,
          license: input.license ?? null,
          attribution: input.attribution ?? null,
          createdBy: input.createdBy ?? null,
          updatedBy: input.createdBy ?? null,
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
        .update(audioAssetsTable)
        .set(values)
        .where(eq(audioAssetsTable.id, id))
        .returning();
      return row ? normalize(row) : null;
    },

    async archive(id, archivedBy = null) {
      return this.update(id, { archivedAt: new Date(), updatedBy: archivedBy });
    },

    async unarchive(id, unarchivedBy = null) {
      return this.update(id, { archivedAt: null, updatedBy: unarchivedBy });
    },

    async remove(id) {
      const db = requireDb();
      const result = await db
        .delete(audioAssetsTable)
        .where(eq(audioAssetsTable.id, id))
        .returning();
      return result.length > 0;
    },
  };
}

let _store: AudioAssetStore | null = null;

export function getAudioAssetStore(): AudioAssetStore {
  if (!_store) _store = neonStore();
  return _store;
}
