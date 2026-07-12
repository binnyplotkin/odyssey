/**
 * Character version store — named snapshots of full character config state.
 *
 * Each save captures the current authorial state (identity, voiceStyle,
 * brainModel, directive, ingestionPrompt, eras, voiceIdentityPageId, title,
 * summary, image) plus the wiki bindings list (wikiId, priority, isActive).
 * Wiki page/edge/source content is *not* snapshotted — those are shared
 * resources with their own change history; only the character's pointer
 * to them is captured.
 *
 * Version numbers are monotonic per character, computed at save time as
 * `MAX(versionNumber) + 1`. Names are not user-authored — every version
 * is `v{N}` for stable ordinal identity. Restoring a version overwrites
 * the live character row and replaces the bindings list. To preserve
 * history, save a snapshot first.
 */

import { and, desc, eq, max, sql } from "drizzle-orm";

import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  characterKnowledgeBindingsTable,
  characterVersionsTable,
  charactersTable,
} from "./schema";
import type {
  BindingPriority,
  CharacterDirective,
  CharacterIdentity,
  CharacterBrainModel,
  CharacterRecord,
  CharacterSoundDesign,
  CharacterVoiceStyle,
  EraConfig,
} from "./wiki-types";
import type { VoiceSettingsOverride } from "./voice-store";
import { normalizeSoundDesign } from "./character-store";

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

/** Wiki binding row inside a version snapshot. */
export type CharacterVersionBindingSnapshot = {
  wikiId: string;
  priority: BindingPriority;
  isActive: boolean;
};

/** The full character config captured by a saved version. */
export type CharacterVersionSnapshot = {
  title: string;
  summary: string | null;
  image: string | null;
  eras: EraConfig[];
  ingestionPrompt: string | null;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  brainModel: CharacterBrainModel | null;
  directive: CharacterDirective | null;
  voiceIdentityPageId: string | null;
  bindings: CharacterVersionBindingSnapshot[];
};

export type CharacterVersionRecord = {
  id: string;
  characterId: string;
  versionNumber: number;
  snapshot: CharacterVersionSnapshot;
  createdAt: string;
  createdBy: string | null;
};

export interface CharacterVersionStore {
  /** Versions for a character, newest first. */
  listForCharacter(characterId: string): Promise<CharacterVersionRecord[]>;

  /** Lookup a single version by id. */
  getById(id: string): Promise<CharacterVersionRecord | null>;

  /**
   * Snapshot the character's current state into a new version row. Returns
   * the new version with the auto-assigned `versionNumber`. Throws if the
   * character doesn't exist.
   */
  save(input: { characterId: string; createdBy?: string | null }): Promise<CharacterVersionRecord>;

  /**
   * Apply a version's snapshot to the live character row + replace its
   * bindings with the snapshot's bindings list. Returns the updated
   * character or null when the version (or its character) is missing.
   */
  restore(versionId: string): Promise<CharacterRecord | null>;

  delete(id: string): Promise<boolean>;
}

function normalize(row: typeof characterVersionsTable.$inferSelect): CharacterVersionRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    versionNumber: row.versionNumber,
    snapshot: row.snapshot as CharacterVersionSnapshot,
    createdAt: toIso(row.createdAt),
    createdBy: row.createdBy,
  };
}

function normalizeCharacter(row: typeof charactersTable.$inferSelect): CharacterRecord {
  // Mirrors character-store.normalize() — voiceIdentityPageId stays in the
  // DB column (and in the version snapshot) but isn't surfaced on
  // CharacterRecord yet.
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    // Not versioned (yet): the brief passes through untouched on restore.
    brief: row.brief,
    image: row.image,
    thumbnailColor: row.thumbnailColor,
    voiceId: row.voiceId ?? null,
    // Not versioned: the sandbox sound binding passes through on restore.
    soundDesign: normalizeSoundDesign(row.soundDesign as CharacterSoundDesign | null),
    voiceSettings: (row.voiceSettings as VoiceSettingsOverride | null) ?? null,
    eras: (row.eras as EraConfig[]) ?? [],
    ingestionPrompt: row.ingestionPrompt,
    identity: (row.identity as CharacterIdentity | null) ?? null,
    voiceStyle: (row.voiceStyle as CharacterVoiceStyle | null) ?? null,
    brainModel: (row.brainModel as CharacterBrainModel | null) ?? null,
    directive: (row.directive as CharacterDirective | null) ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function getCharacterVersionStore(): CharacterVersionStore {
  return {
    async listForCharacter(characterId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(characterVersionsTable)
          .where(eq(characterVersionsTable.characterId, characterId))
          .orderBy(desc(characterVersionsTable.versionNumber)),
      );
      return rows.map(normalize);
    },

    async getById(id) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(characterVersionsTable)
          .where(eq(characterVersionsTable.id, id))
          .limit(1),
      );
      return row ? normalize(row) : null;
    },

    async save({ characterId, createdBy }) {
      const db = requireDb();

      // Look up the character + bindings together so the snapshot reflects
      // a consistent moment in time.
      const [characterRow] = await retryRead(() =>
        db
          .select()
          .from(charactersTable)
          .where(eq(charactersTable.id, characterId))
          .limit(1),
      );
      if (!characterRow) throw new Error(`character ${characterId} not found`);

      const bindingRows = await retryRead(() =>
        db
          .select({
            wikiId: characterKnowledgeBindingsTable.wikiId,
            priority: characterKnowledgeBindingsTable.priority,
            isActive: characterKnowledgeBindingsTable.isActive,
          })
          .from(characterKnowledgeBindingsTable)
          .where(eq(characterKnowledgeBindingsTable.characterId, characterId)),
      );

      const snapshot: CharacterVersionSnapshot = {
        title: characterRow.title,
        summary: characterRow.summary,
        image: characterRow.image,
        eras: (characterRow.eras as EraConfig[]) ?? [],
        ingestionPrompt: characterRow.ingestionPrompt,
        identity: (characterRow.identity as CharacterIdentity | null) ?? null,
        voiceStyle: (characterRow.voiceStyle as CharacterVoiceStyle | null) ?? null,
        brainModel: (characterRow.brainModel as CharacterBrainModel | null) ?? null,
        directive: (characterRow.directive as CharacterDirective | null) ?? null,
        voiceIdentityPageId: characterRow.voiceIdentityPageId,
        bindings: bindingRows.map((b) => ({
          wikiId: b.wikiId,
          priority: b.priority as BindingPriority,
          isActive: b.isActive,
        })),
      };

      // Compute next version number atomically. A race here is benign
      // because (characterId, versionNumber) is unique — a duplicate
      // insert will fail and the caller can retry.
      const [maxRow] = await retryRead(() =>
        db
          .select({ n: max(characterVersionsTable.versionNumber) })
          .from(characterVersionsTable)
          .where(eq(characterVersionsTable.characterId, characterId)),
      );
      const nextNumber = (maxRow?.n ?? 0) + 1;

      const [inserted] = await db
        .insert(characterVersionsTable)
        .values({
          characterId,
          versionNumber: nextNumber,
          snapshot,
          createdBy: createdBy ?? null,
        })
        .returning();
      return normalize(inserted);
    },

    async restore(versionId) {
      const db = requireDb();
      const [versionRow] = await retryRead(() =>
        db
          .select()
          .from(characterVersionsTable)
          .where(eq(characterVersionsTable.id, versionId))
          .limit(1),
      );
      if (!versionRow) return null;

      const snapshot = versionRow.snapshot as CharacterVersionSnapshot;

      // Overwrite the live character row with the snapshot's authorial fields.
      // `slug` is intentionally NOT restored — slugs are URL-stable identity
      // and shouldn't time-travel.
      const [updated] = await db
        .update(charactersTable)
        .set({
          title: snapshot.title,
          summary: snapshot.summary,
          image: snapshot.image,
          eras: snapshot.eras,
          ingestionPrompt: snapshot.ingestionPrompt,
          identity: snapshot.identity,
          voiceStyle: snapshot.voiceStyle,
          brainModel: snapshot.brainModel,
          directive: snapshot.directive,
          voiceIdentityPageId: snapshot.voiceIdentityPageId,
          updatedAt: sql`now()`,
        })
        .where(eq(charactersTable.id, versionRow.characterId))
        .returning();
      if (!updated) return null;

      // Replace the bindings list. Drop everything for this character then
      // re-insert from the snapshot.
      await db
        .delete(characterKnowledgeBindingsTable)
        .where(eq(characterKnowledgeBindingsTable.characterId, versionRow.characterId));
      if (snapshot.bindings.length > 0) {
        await db.insert(characterKnowledgeBindingsTable).values(
          snapshot.bindings.map((b) => ({
            characterId: versionRow.characterId,
            wikiId: b.wikiId,
            priority: b.priority,
            isActive: b.isActive,
          })),
        );
      }

      return normalizeCharacter(updated);
    },

    async delete(id) {
      const db = requireDb();
      const rows = await db
        .delete(characterVersionsTable)
        .where(eq(characterVersionsTable.id, id))
        .returning({ id: characterVersionsTable.id });
      return rows.length > 0;
    },
  };
}

// Avoid unused-import warning when the file shrinks.
void and;
