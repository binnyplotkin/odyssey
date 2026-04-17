import { and, eq } from "drizzle-orm";
import { getDb } from "./client";
import { charactersTable, worldCharactersTable } from "./schema";
import type {
  CharacterRecord,
  CreateCharacterInput,
  EraConfig,
  UpdateCharacterInput,
} from "./wiki-types";

/* ── Shared helpers ─────────────────────────────────────────────── */

function toIso(d: Date): string {
  return d.toISOString();
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the character store");
  return db;
}

function normalize(row: typeof charactersTable.$inferSelect): CharacterRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    image: row.image,
    eras: (row.eras as EraConfig[] | null) ?? [],
    ingestionPrompt: row.ingestionPrompt,
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

  // World bridge
  linkToWorld(characterId: string, worldId: string, roleInWorld?: string): Promise<void>;
  unlinkFromWorld(characterId: string, worldId: string): Promise<void>;
  listForWorld(worldId: string): Promise<CharacterRecord[]>;
}

/* ── Implementation ─────────────────────────────────────────────── */

function neonStore(): CharacterStore {
  return {
    async list() {
      const db = requireDb();
      const rows = await db.select().from(charactersTable);
      return rows
        .map(normalize)
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async getById(id) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(charactersTable)
        .where(eq(charactersTable.id, id))
        .limit(1);
      return row ? normalize(row) : null;
    },

    async getBySlug(slug) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(charactersTable)
        .where(eq(charactersTable.slug, slug))
        .limit(1);
      return row ? normalize(row) : null;
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
          image: input.image ?? null,
          eras: input.eras ?? [],
          ingestionPrompt: input.ingestionPrompt ?? null,
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

    async linkToWorld(characterId, worldId, roleInWorld) {
      const db = requireDb();
      // Idempotent: ignore duplicate (we have a composite PK).
      try {
        await db.insert(worldCharactersTable).values({
          worldId,
          characterId,
          roleInWorld: roleInWorld ?? null,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        // 23505 = unique_violation — link already exists, that's fine.
        if (!/23505|duplicate key/i.test(msg)) throw e;
      }
    },

    async unlinkFromWorld(characterId, worldId) {
      const db = requireDb();
      await db
        .delete(worldCharactersTable)
        .where(
          and(
            eq(worldCharactersTable.worldId, worldId),
            eq(worldCharactersTable.characterId, characterId),
          ),
        );
    },

    async listForWorld(worldId) {
      const db = requireDb();
      const rows = await db
        .select({
          id: charactersTable.id,
          slug: charactersTable.slug,
          title: charactersTable.title,
          summary: charactersTable.summary,
          image: charactersTable.image,
          eras: charactersTable.eras,
          ingestionPrompt: charactersTable.ingestionPrompt,
          createdAt: charactersTable.createdAt,
          updatedAt: charactersTable.updatedAt,
        })
        .from(worldCharactersTable)
        .innerJoin(charactersTable, eq(worldCharactersTable.characterId, charactersTable.id))
        .where(eq(worldCharactersTable.worldId, worldId));
      return rows
        .map(normalize)
        .sort((a, b) => a.title.localeCompare(b.title));
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────── */

let _store: CharacterStore | null = null;

export function getCharacterStore(): CharacterStore {
  if (!_store) _store = neonStore();
  return _store;
}
