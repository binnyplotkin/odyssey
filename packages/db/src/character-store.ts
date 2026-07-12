import { and, eq, sql } from "drizzle-orm";
import type { SceneSound } from "@odyssey/types";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, sceneNodesTable } from "./schema";
import type {
  CharacterDirective,
  CharacterIdentity,
  CharacterBrainModel,
  CharacterRecord,
  CharacterSoundDesign,
  CharacterVoiceStyle,
  CreateCharacterInput,
  EraConfig,
  UpdateCharacterInput,
} from "./wiki-types";
import type { VoiceSettingsOverride } from "./voice-store";

/* ── Shared helpers ─────────────────────────────────────────────── */

function toIso(d: Date): string {
  return d.toISOString();
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the character store");
  return db;
}

function isMissingCharactersTableError(error: unknown) {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

/**
 * Wider catch-and-return-null guard for "expected" read failures: missing
 * table (fresh DB) plus the Neon driver's generic "Failed query:" wrapper
 * — used at the read-method boundary so the UI gets `null` / `[]` instead
 * of a 500 in those cases.
 */
function isRecoverableCharacterReadError(error: unknown) {
  if (isMissingCharactersTableError(error)) return true;
  const message =
    (error as { message?: string })?.message ??
    (error as { cause?: { message?: string } })?.cause?.message ??
    "";
  return message.includes("Failed query:");
}

/**
 * Fold the legacy single-bed shape ({ambienceSlug, gainDb}) into the
 * canonical `sounds` list so every reader sees one shape. Rows written
 * before the character-canvas sound nodes carry the legacy fields; all
 * writers now emit the list. Name falls back to the slug — legacy rows
 * never snapshotted asset metadata.
 */
export function normalizeSoundDesign(
  raw: CharacterSoundDesign | null,
): CharacterSoundDesign | null {
  if (!raw) return null;
  if (raw.sounds?.length) return { sounds: raw.sounds };
  const slug = raw.ambienceSlug?.trim();
  if (!slug) return null;
  return {
    sounds: [
      {
        slug,
        role: "bed",
        name: slug,
        description: null,
        ...(typeof raw.gainDb === "number" ? { gainDb: raw.gainDb } : {}),
        isDefault: true,
      },
    ],
  };
}

/**
 * Map a character's placed sounds to the orchestrator `Scene.sounds`
 * roster shape (the director's audio menu). Names/descriptions come from
 * the bind-time snapshots on each entry; beds are loopable by definition.
 * Used by the scene-less synthesis paths (SceneDriver.fromCharacter, the
 * admin character-sandbox resolveScene).
 */
export function soundDesignToSceneSounds(
  soundDesign: CharacterSoundDesign | null,
): SceneSound[] {
  const normalized = normalizeSoundDesign(soundDesign);
  return (normalized?.sounds ?? []).map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
    role: s.role,
    ...(s.triggerHint ? { triggerHint: s.triggerHint } : {}),
    ...(typeof s.gainDb === "number" ? { gainDb: s.gainDb } : {}),
    loopable: s.role === "bed",
  }));
}

function normalize(row: typeof charactersTable.$inferSelect): CharacterRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    brief: row.brief,
    image: row.image,
    thumbnailColor: row.thumbnailColor,
    eras: (row.eras as EraConfig[] | null) ?? [],
    ingestionPrompt: row.ingestionPrompt,
    identity: (row.identity as CharacterIdentity | null) ?? null,
    voiceStyle: (row.voiceStyle as CharacterVoiceStyle | null) ?? null,
    brainModel: (row.brainModel as CharacterBrainModel | null) ?? null,
    directive: (row.directive as CharacterDirective | null) ?? null,
    voiceId: row.voiceId ?? null,
    soundDesign: normalizeSoundDesign(row.soundDesign as CharacterSoundDesign | null),
    voiceSettings: (row.voiceSettings as VoiceSettingsOverride | null) ?? null,
    createdAt: row.createdAt instanceof Date ? toIso(row.createdAt) : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? toIso(row.updatedAt) : String(row.updatedAt),
  };
}

/* ── Public interface ───────────────────────────────────────────── */

export interface CharacterStore {
  list(): Promise<CharacterRecord[]>;
  getById(id: string): Promise<CharacterRecord | null>;
  getBySlug(slug: string): Promise<CharacterRecord | null>;
  create(input: CreateCharacterInput): Promise<CharacterRecord>;
  update(id: string, input: UpdateCharacterInput): Promise<CharacterRecord | null>;
  remove(id: string): Promise<boolean>;

  // Count distinct worlds this character is part of (via world_nodes graph).
  countWorldsFor(characterId: string): Promise<number>;
}

/* ── Implementation ─────────────────────────────────────────────── */

function neonStore(): CharacterStore {
  return {
    async list() {
      try {
        const rows = await retryRead(() =>
          requireDb().select().from(charactersTable),
        );
        return rows
          .map(normalize)
          .sort((a, b) => a.title.localeCompare(b.title));
      } catch (error) {
        if (isRecoverableCharacterReadError(error)) return [];
        throw error;
      }
    },

    async getById(id) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(charactersTable)
            .where(eq(charactersTable.id, id))
            .limit(1),
        );
        return row ? normalize(row) : null;
      } catch (error) {
        if (isRecoverableCharacterReadError(error)) return null;
        throw error;
      }
    },

    async getBySlug(slug) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select()
            .from(charactersTable)
            .where(eq(charactersTable.slug, slug))
            .limit(1),
        );
        return row ? normalize(row) : null;
      } catch (error) {
        if (isRecoverableCharacterReadError(error)) return null;
        throw error;
      }
    },

    async create(input) {
      const db = requireDb();
      const now = new Date();
      const [row] = await db
        .insert(charactersTable)
        .values({
          slug: input.slug,
          title: input.title,
          summary: input.summary ?? null,
          brief: input.brief ?? null,
          image: input.image ?? null,
          thumbnailColor: input.thumbnailColor ?? null,
          eras: input.eras ?? [],
          ingestionPrompt: input.ingestionPrompt ?? null,
          identity: input.identity ?? null,
          voiceStyle: input.voiceStyle ?? null,
          brainModel: input.brainModel ?? null,
          directive: input.directive ?? null,
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
        if (k !== "updatedAt" && v !== undefined) values[k] = v;
      }
      const [row] = await db
        .update(charactersTable)
        .set(values)
        .where(eq(charactersTable.id, id))
        .returning();
      return row ? normalize(row) : null;
    },

    async remove(id) {
      const db = requireDb();
      const result = await db
        .delete(charactersTable)
        .where(eq(charactersTable.id, id))
        .returning();
      return result.length > 0;
    },

    async countWorldsFor(characterId) {
      try {
        const [row] = await retryRead(() =>
          requireDb()
            .select({ n: sql<number>`count(distinct ${sceneNodesTable.sceneId})::int` })
            .from(sceneNodesTable)
            .where(
              and(
                eq(sceneNodesTable.kind, "character"),
                eq(sceneNodesTable.refId, characterId),
              ),
            ),
        );
        return row?.n ?? 0;
      } catch (error) {
        if (isRecoverableCharacterReadError(error)) return 0;
        throw error;
      }
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────── */

let _store: CharacterStore | null = null;

export function getCharacterStore(): CharacterStore {
  if (!_store) _store = neonStore();
  return _store;
}
