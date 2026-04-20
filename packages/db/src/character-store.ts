import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";
import { charactersTable, worldNodesTable } from "./schema";
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

  // Count distinct worlds this character is part of (via world_nodes graph).
  countWorldsFor(characterId: string): Promise<number>;
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

    async countWorldsFor(characterId) {
      const db = requireDb();
      const [row] = await db
        .select({ n: sql<number>`count(distinct ${worldNodesTable.worldId})::int` })
        .from(worldNodesTable)
        .where(
          and(
            eq(worldNodesTable.kind, "character"),
            eq(worldNodesTable.refId, characterId),
          ),
        );
      return row?.n ?? 0;
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────── */

let _store: CharacterStore | null = null;

export function getCharacterStore(): CharacterStore {
  if (!_store) _store = neonStore();
  return _store;
}
