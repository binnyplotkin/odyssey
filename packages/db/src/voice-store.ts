import { asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  charactersTable,
  voicesTable,
  voicePreviewsTable,
  voiceExtractionAttemptsTable,
} from "./schema";

export type VoiceStatus = "uploaded" | "processing" | "ready" | "failed";
export type VoiceAttemptStatus = "processing" | "succeeded" | "failed";

// Provider discriminator. Adding a new value requires (a) an adapter in
// @odyssey/engine/audio.ts and (b) a case in createStreamingTtsAdapterForVoice.
export type VoiceProvider = "pocket_tts" | "elevenlabs" | "openai" | "cartesia";

// Provider-specific settings carried in voices.provider_config (jsonb). The
// runtime shape is validated by adapters; the union below is the
// type-level contract.
export type VoiceProviderConfig =
  | { /* pocket_tts: no extra config; uses sourcePath + embeddingPath */ }
  | { voiceId: string; modelId?: string; stability?: number; similarityBoost?: number; style?: number } // elevenlabs
  | { voice: string } // openai (alloy | echo | fable | onyx | nova | shimmer)
  | { voiceId: string; modelId?: string }; // cartesia

/**
 * Per-binding override of a bound voice's runtime knobs. Stored on the
 * character row (`characters.voice_settings`), provider-discriminated so the
 * resolver can narrow safely. Every field except `provider` is optional —
 * a sparse overlay applied on top of the voice's `providerConfig`. The
 * voice's identity (`voiceId` / `voice`) is intentionally never
 * overrideable here; that's what binding to a different voice is for.
 */
export type VoiceSettingsOverride =
  | { provider: "pocket_tts" } // placeholder — no tunable knobs today
  | {
      provider: "elevenlabs";
      modelId?: string;
      stability?: number;
      similarityBoost?: number;
      style?: number;
      speakerBoost?: boolean;
    }
  | { provider: "openai" } // placeholder — `voice` is identity, no tunable knobs today
  | { provider: "cartesia"; modelId?: string };

/* Compact character payload returned alongside each voice in `list()` so
 * the library UI can render the bindings block (avatar stack + name pills)
 * without an N+1 query per card. Capped to the first 4 characters by
 * createdAt; the total live count is on `boundCharacterCount`. */
export interface BoundCharacterPreview {
  id: string;
  title: string;
  thumbnailColor: string | null;
}

export interface VoiceRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  provider: VoiceProvider;
  providerConfig: Record<string, unknown>;
  status: VoiceStatus;
  statusError: string | null;
  sourcePath: string | null;
  embeddingPath: string | null;
  previewPath: string | null;
  durationS: number | null;
  sampleRate: number | null;
  tags: string[];
  language: string | null;
  gender: string | null;
  license: string | null;
  attribution: string | null;
  archivedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  // Hydrated by list/getById; absent on raw normalize.
  boundCharacterCount?: number;
  /* First N bound characters (newest first) for the library card's avatar
   * stack + name pills. Empty for unbound voices. Capped server-side to 4;
   * the remainder is implied by `boundCharacterCount > boundCharacters.length`. */
  boundCharacters?: BoundCharacterPreview[];
}

export interface CreateVoiceInput {
  slug: string;
  name: string;
  description?: string | null;
  // Provider defaults to "pocket_tts" for backward compat with existing
  // upload flows. Hosted-provider voices set this explicitly + populate
  // providerConfig with the credentials/settings their adapter needs.
  provider?: VoiceProvider;
  providerConfig?: Record<string, unknown>;
  sourcePath?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
  tags?: string[];
  language?: string | null;
  gender?: string | null;
  license?: string | null;
  attribution?: string | null;
  createdBy?: string | null;
  // Hosted-provider voices skip extraction and arrive ready; allow the
  // caller to set the initial status accordingly.
  status?: VoiceStatus;
}

export interface UpdateVoiceInput {
  name?: string;
  description?: string | null;
  provider?: VoiceProvider;
  providerConfig?: Record<string, unknown>;
  status?: VoiceStatus;
  statusError?: string | null;
  sourcePath?: string | null;
  embeddingPath?: string | null;
  previewPath?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
  tags?: string[];
  language?: string | null;
  gender?: string | null;
  license?: string | null;
  attribution?: string | null;
  archivedAt?: Date | string | null;
  updatedBy?: string | null;
}

export interface ListVoicesOptions {
  /** Include soft-deleted (archived) voices. Default false. */
  includeArchived?: boolean;
}

export interface VoicePreviewRecord {
  id: string;
  voiceId: string;
  label: string;
  path: string;
  /** Text the voice was asked to speak when this take was synthesized.
   * Null for legacy / imported takes registered via the `{label, path}`
   * payload (no synth, no prompt to record). */
  prompt: string | null;
  durationS: number | null;
  sampleRate: number | null;
  createdAt: string;
}

export interface CreatePreviewInput {
  label: string;
  path: string;
  prompt?: string | null;
  durationS?: number | null;
  sampleRate?: number | null;
}

export interface VoiceExtractionAttemptRecord {
  id: string;
  voiceId: string;
  attemptNumber: number;
  status: VoiceAttemptStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface FinishAttemptInput {
  status: Exclude<VoiceAttemptStatus, "processing">;
  error?: string | null;
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the voice store");
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

function normalize(row: typeof voicesTable.$inferSelect): VoiceRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    provider: (row.provider as VoiceProvider) ?? "pocket_tts",
    providerConfig:
      (row.providerConfig as Record<string, unknown> | null) ?? {},
    status: row.status as VoiceStatus,
    statusError: row.statusError,
    sourcePath: row.sourcePath,
    embeddingPath: row.embeddingPath,
    previewPath: row.previewPath,
    durationS: row.durationS,
    sampleRate: row.sampleRate,
    tags: row.tags ?? [],
    language: row.language,
    gender: row.gender,
    license: row.license,
    attribution: row.attribution,
    archivedAt: toIsoNullable(row.archivedAt),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function normalizePreview(
  row: typeof voicePreviewsTable.$inferSelect,
): VoicePreviewRecord {
  return {
    id: row.id,
    voiceId: row.voiceId,
    label: row.label,
    path: row.path,
    prompt: row.prompt,
    durationS: row.durationS,
    sampleRate: row.sampleRate,
    createdAt: toIso(row.createdAt),
  };
}

function normalizeAttempt(
  row: typeof voiceExtractionAttemptsTable.$inferSelect,
): VoiceExtractionAttemptRecord {
  return {
    id: row.id,
    voiceId: row.voiceId,
    attemptNumber: row.attemptNumber,
    status: row.status as VoiceAttemptStatus,
    error: row.error,
    startedAt: toIso(row.startedAt),
    finishedAt: toIsoNullable(row.finishedAt),
  };
}

/** Slim character row shape used by the voice detail page to render
 * bindings — just enough to render the avatar + title + slug + summary.
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
  list(options?: ListVoicesOptions): Promise<VoiceRecord[]>;
  getById(id: string): Promise<VoiceRecord | null>;
  getBySlug(slug: string): Promise<VoiceRecord | null>;
  create(input: CreateVoiceInput): Promise<VoiceRecord>;
  update(id: string, input: UpdateVoiceInput): Promise<VoiceRecord | null>;
  /** Soft-delete — sets archivedAt. Characters bound to the voice keep
   * playing; the library UI filters them out. */
  archive(id: string, archivedBy?: string | null): Promise<VoiceRecord | null>;
  unarchive(id: string, unarchivedBy?: string | null): Promise<VoiceRecord | null>;
  /** Hard delete — cascades to previews + attempts. Prefer `archive`. */
  remove(id: string): Promise<boolean>;
  countCharactersUsing(voiceId: string): Promise<number>;
  listBoundCharacters(voiceId: string): Promise<BoundCharacterSummary[]>;

  // Preview gallery
  listPreviews(voiceId: string): Promise<VoicePreviewRecord[]>;
  addPreview(
    voiceId: string,
    input: CreatePreviewInput,
  ): Promise<VoicePreviewRecord>;
  removePreview(previewId: string): Promise<boolean>;

  // Extraction journal
  listAttempts(voiceId: string): Promise<VoiceExtractionAttemptRecord[]>;
  startAttempt(voiceId: string): Promise<VoiceExtractionAttemptRecord>;
  finishAttempt(
    attemptId: string,
    input: FinishAttemptInput,
  ): Promise<VoiceExtractionAttemptRecord | null>;
}

function neonStore(): VoiceStore {
  return {
    async list({ includeArchived = false }: ListVoicesOptions = {}) {
      try {
        const rows = await retryRead(() => {
          const q = requireDb()
            .select({
              voice: voicesTable,
              boundCount: sql<number>`count(${charactersTable.id})::int`,
              // First 4 bound characters as a json[] for the library card.
              // The FILTER keeps the LEFT JOIN's NULL row out of the agg;
              // the [1:4] slice caps payload size for voices with many
              // bindings (think shared narrators); COALESCE handles voices
              // with zero bindings (FILTER returns NULL not empty array).
              boundCharacters: sql<BoundCharacterPreview[]>`
                COALESCE(
                  (array_agg(
                    json_build_object(
                      'id', ${charactersTable.id},
                      'title', ${charactersTable.title},
                      'thumbnailColor', ${charactersTable.thumbnailColor}
                    ) ORDER BY ${charactersTable.createdAt} ASC
                  ) FILTER (WHERE ${charactersTable.id} IS NOT NULL))[1:4],
                  ARRAY[]::json[]
                )
              `,
            })
            .from(voicesTable)
            .leftJoin(
              charactersTable,
              eq(charactersTable.voiceId, voicesTable.id),
            )
            .groupBy(voicesTable.id)
            .orderBy(desc(voicesTable.createdAt));
          return includeArchived
            ? q
            : q.where(isNull(voicesTable.archivedAt));
        });
        return rows.map((r) => ({
          ...normalize(r.voice),
          boundCharacterCount: r.boundCount,
          boundCharacters: r.boundCharacters ?? [],
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
      const provider = input.provider ?? "pocket_tts";
      const [row] = await db
        .insert(voicesTable)
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description ?? null,
          provider,
          providerConfig: input.providerConfig ?? {},
          // Pocket goes through extraction → default to "uploaded".
          // Hosted providers skip extraction; default them to "ready" unless
          // the caller asks for something else.
          status:
            input.status ?? (provider === "pocket_tts" ? "uploaded" : "ready"),
          sourcePath: input.sourcePath ?? null,
          durationS: input.durationS ?? null,
          sampleRate: input.sampleRate ?? null,
          tags: input.tags ?? [],
          language: input.language ?? null,
          gender: input.gender ?? null,
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
        .update(voicesTable)
        .set(values)
        .where(eq(voicesTable.id, id))
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

    async listPreviews(voiceId) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select()
            .from(voicePreviewsTable)
            .where(eq(voicePreviewsTable.voiceId, voiceId))
            .orderBy(asc(voicePreviewsTable.createdAt)),
        );
        return rows.map(normalizePreview);
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async addPreview(voiceId, input) {
      const db = requireDb();
      const [row] = await db
        .insert(voicePreviewsTable)
        .values({
          voiceId,
          label: input.label,
          path: input.path,
          prompt: input.prompt ?? null,
          durationS: input.durationS ?? null,
          sampleRate: input.sampleRate ?? null,
        })
        .returning();
      return normalizePreview(row);
    },

    async removePreview(previewId) {
      const db = requireDb();
      const result = await db
        .delete(voicePreviewsTable)
        .where(eq(voicePreviewsTable.id, previewId))
        .returning();
      return result.length > 0;
    },

    async listAttempts(voiceId) {
      try {
        const rows = await retryRead(() =>
          requireDb()
            .select()
            .from(voiceExtractionAttemptsTable)
            .where(eq(voiceExtractionAttemptsTable.voiceId, voiceId))
            .orderBy(desc(voiceExtractionAttemptsTable.attemptNumber)),
        );
        return rows.map(normalizeAttempt);
      } catch (error) {
        if (isRecoverableReadError(error)) return [];
        throw error;
      }
    },

    async startAttempt(voiceId) {
      const db = requireDb();
      // Compute next attempt number as MAX + 1. Cheap with the unique
      // index; a race that picks the same number falls back to the
      // unique-violation retry below.
      const next = await nextAttemptNumber(voiceId);
      try {
        const [row] = await db
          .insert(voiceExtractionAttemptsTable)
          .values({
            voiceId,
            attemptNumber: next,
            status: "processing",
            startedAt: new Date(),
          })
          .returning();
        return normalizeAttempt(row);
      } catch (error) {
        // Unique-violation under concurrent extraction kicks — recompute
        // once and retry. If it fails again, surface the error.
        const code =
          (error as { code?: string })?.code ??
          (error as { cause?: { code?: string } })?.cause?.code;
        if (code !== "23505") throw error;
        const retry = await nextAttemptNumber(voiceId);
        const [row] = await db
          .insert(voiceExtractionAttemptsTable)
          .values({
            voiceId,
            attemptNumber: retry,
            status: "processing",
            startedAt: new Date(),
          })
          .returning();
        return normalizeAttempt(row);
      }
    },

    async finishAttempt(attemptId, { status, error = null }) {
      const db = requireDb();
      const [row] = await db
        .update(voiceExtractionAttemptsTable)
        .set({ status, error, finishedAt: new Date() })
        .where(eq(voiceExtractionAttemptsTable.id, attemptId))
        .returning();
      return row ? normalizeAttempt(row) : null;
    },
  };
}

async function nextAttemptNumber(voiceId: string): Promise<number> {
  const [row] = await retryRead(() =>
    requireDb()
      .select({
        max: sql<number | null>`max(${voiceExtractionAttemptsTable.attemptNumber})`,
      })
      .from(voiceExtractionAttemptsTable)
      .where(eq(voiceExtractionAttemptsTable.voiceId, voiceId)),
  );
  return (row?.max ?? 0) + 1;
}

let _store: VoiceStore | null = null;

export function getVoiceStore(): VoiceStore {
  if (!_store) _store = neonStore();
  return _store;
}

// Helper exports for callers that need to mirror attempt status onto
// `voices.status` in a single transaction-equivalent flow.
export const VOICE_STATUS_FROM_ATTEMPT: Record<VoiceAttemptStatus, VoiceStatus> = {
  processing: "processing",
  succeeded: "ready",
  failed: "failed",
};
