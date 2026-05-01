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
 * The Neon serverless driver speaks HTTP to Neon's edge proxy. Stale sockets
 * occasionally fail with `fetch failed` / `ECONNRESET` mid-read. A single
 * retry recovers the request without changing semantics. Reads only — never
 * wrap writes (could double-apply).
 */
function isTransientFetchError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidates: unknown[] = [
    error,
    (error as { cause?: unknown }).cause,
    (error as { sourceError?: unknown }).sourceError,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const code = (c as { code?: string }).code ?? "";
    if (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENETUNREACH" ||
      code === "EAI_AGAIN"
    ) {
      return true;
    }
    const message = (c as { message?: string }).message ?? "";
    if (message.includes("fetch failed")) return true;
  }
  return false;
}

async function retryRead<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (!isTransientFetchError(error)) throw error;
    await new Promise((r) => setTimeout(r, 80));
    return await op();
  }
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
      try {
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
