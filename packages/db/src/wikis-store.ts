/**
 * Wiki + character-binding store.
 *
 * Manages the new top-level wikis (shared knowledge resources) plus the
 * many-to-many `character_knowledge_bindings` between characters and wikis.
 *
 * Read/write paths on existing wiki-scoped tables (wiki_pages, wiki_edges,
 * wiki_sources, wiki_ingestion_log) still live in `wiki-store.ts` and use
 * the legacy `character_id` column during Phase 2. This store covers the
 * new wiki-aware surface only: list/create/update wikis, manage bindings,
 * look up wiki-scoped row counts for the /wikis admin UI.
 */

import { and, asc, count, desc, eq, sql } from "drizzle-orm";

import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  characterKnowledgeBindingsTable,
  wikiEdgesTable,
  wikiIngestionLogTable,
  wikiPagesTable,
  wikiSourcesTable,
  wikisTable,
} from "./schema";
import type {
  BindingPriority,
  CharacterKnowledgeBindingRecord,
  CreateBindingInput,
  CreateWikiInput,
  Era,
  UpdateBindingInput,
  UpdateWikiInput,
  WikiPageType,
  WikiRecord,
} from "./wiki-types";

/* ── Lightweight summary types ──────────────────────────────────── */

export type WikiPageSummary = {
  id: string;
  slug: string;
  type: string;
  title: string;
  summary: string | null;
  updatedAt: string;
};

export type WikiSourceSummary = {
  id: string;
  title: string;
  kind: string;
  contentHash: string;
  createdAt: string;
};

export type WikiIngestionSummary = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  startedAt: string;
  finishedAt: string | null;
  pagesCreated: number;
  pagesUpdated: number;
  edgesAdded: number;
  contradictionsFound: number;
  tokensUsed: number;
  model: string | null;
  sourceId: string | null;
  errorMessage: string | null;
};

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured");
  return db;
}

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

function normalizeWiki(row: typeof wikisTable.$inferSelect): WikiRecord {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? null,
    eras: (row.eras as Era[] | null) ?? [],
    ingestionPrompt: row.ingestionPrompt ?? null,
    ingestionPromptName: row.ingestionPromptName ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function normalizeBinding(
  row: typeof characterKnowledgeBindingsTable.$inferSelect,
): CharacterKnowledgeBindingRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    wikiId: row.wikiId,
    priority: row.priority as BindingPriority,
    isActive: row.isActive,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export type WikiSummary = WikiRecord & {
  pageCount: number;
  edgeCount: number;
  sourceCount: number;
  ingestionCount: number;
  /** Number of characters bound to this wiki (any priority, active or not). */
  characterCount: number;
};

export interface WikisStore {
  // Wikis
  listWikis(): Promise<WikiRecord[]>;
  listWikiSummaries(): Promise<WikiSummary[]>;
  getWikiById(id: string): Promise<WikiRecord | null>;
  getWikiBySlug(slug: string): Promise<WikiRecord | null>;
  createWiki(input: CreateWikiInput): Promise<WikiRecord>;
  updateWiki(id: string, input: UpdateWikiInput): Promise<WikiRecord | null>;
  deleteWiki(id: string): Promise<boolean>;

  // Bindings
  listBindingsForCharacter(characterId: string): Promise<CharacterKnowledgeBindingRecord[]>;
  listBindingsForWiki(wikiId: string): Promise<CharacterKnowledgeBindingRecord[]>;
  getBinding(characterId: string, wikiId: string): Promise<CharacterKnowledgeBindingRecord | null>;
  createBinding(input: CreateBindingInput): Promise<CharacterKnowledgeBindingRecord>;
  updateBinding(
    id: string,
    input: UpdateBindingInput,
  ): Promise<CharacterKnowledgeBindingRecord | null>;
  deleteBinding(id: string): Promise<boolean>;

  /**
   * Convenience: list the wiki records bound to a character, ordered by
   * priority (primary → secondary → reference) then createdAt. Includes
   * inactive bindings; filter callers do their own pass.
   */
  listWikisForCharacter(
    characterId: string,
  ): Promise<Array<WikiRecord & { binding: CharacterKnowledgeBindingRecord }>>;

  // Wiki-scoped content reads. These return lightweight summaries shaped
  // for /wikis/[id] views; full editors still use the per-character
  // wiki-store methods during Phase 2.
  listPagesForWiki(wikiId: string): Promise<WikiPageSummary[]>;
  listSourcesForWiki(wikiId: string): Promise<WikiSourceSummary[]>;
  listIngestionsForWiki(
    wikiId: string,
    limit?: number,
  ): Promise<WikiIngestionSummary[]>;

  countEdgesForWiki(wikiId: string): Promise<number>;

  /**
   * Top-N nodes + their inter-node edges, projected from the cached
   * layout. Drives the per-graph icon. Returns at most `limit` nodes
   * (highest internal degree first) and only edges among the chosen
   * nodes. Coords are passed through raw — the renderer normalizes.
   *
   * Default `limit` is 5 — locked in after icon-test review. Icons live
   * at 32-56px in lists and 220px on the overview hero; 5 nodes reads
   * cleanly at both sizes without crowding.
   */
  getIconDataForWiki(
    wikiId: string,
    limit?: number,
  ): Promise<KnowledgeGraphData>;
}

export type KnowledgeGraphNode = {
  id: string;
  x: number;
  y: number;
  degree: number;
  /** Page type so the icon can color-code dots. */
  type: WikiPageType;
};

export type KnowledgeGraphData = {
  nodes: KnowledgeGraphNode[];
  edges: Array<{ from: string; to: string; strength: number }>;
};

function neonStore(): WikisStore {
  return {
    async listWikis() {
      const db = requireDb();
      const rows = await retryRead(() =>
        db.select().from(wikisTable).orderBy(asc(wikisTable.title)),
      );
      return rows.map(normalizeWiki);
    },

    async listWikiSummaries() {
      const db = requireDb();

      const wikis = await retryRead(() =>
        db.select().from(wikisTable).orderBy(asc(wikisTable.title)),
      );

      if (wikis.length === 0) return [];

      // Aggregate counts in parallel. The wiki child tables aren't huge so
      // this is fine; if it ever becomes hot, replace with a single SQL
      // grouping over a UNION of (wikiId, kind) rows.
      const [pageCounts, edgeCounts, sourceCounts, ingestionCounts, charCounts] =
        await Promise.all([
          retryRead(() =>
            db
              .select({ wikiId: wikiPagesTable.wikiId, n: count() })
              .from(wikiPagesTable)
              .where(sql`${wikiPagesTable.wikiId} IS NOT NULL`)
              .groupBy(wikiPagesTable.wikiId),
          ),
          retryRead(() =>
            db
              .select({ wikiId: wikiEdgesTable.wikiId, n: count() })
              .from(wikiEdgesTable)
              .where(sql`${wikiEdgesTable.wikiId} IS NOT NULL`)
              .groupBy(wikiEdgesTable.wikiId),
          ),
          retryRead(() =>
            db
              .select({ wikiId: wikiSourcesTable.wikiId, n: count() })
              .from(wikiSourcesTable)
              .where(sql`${wikiSourcesTable.wikiId} IS NOT NULL`)
              .groupBy(wikiSourcesTable.wikiId),
          ),
          retryRead(() =>
            db
              .select({ wikiId: wikiIngestionLogTable.wikiId, n: count() })
              .from(wikiIngestionLogTable)
              .where(sql`${wikiIngestionLogTable.wikiId} IS NOT NULL`)
              .groupBy(wikiIngestionLogTable.wikiId),
          ),
          retryRead(() =>
            db
              .select({
                wikiId: characterKnowledgeBindingsTable.wikiId,
                n: count(),
              })
              .from(characterKnowledgeBindingsTable)
              .groupBy(characterKnowledgeBindingsTable.wikiId),
          ),
        ]);

      const pageMap = new Map(pageCounts.map((r) => [r.wikiId, r.n]));
      const edgeMap = new Map(edgeCounts.map((r) => [r.wikiId, r.n]));
      const sourceMap = new Map(sourceCounts.map((r) => [r.wikiId, r.n]));
      const ingestionMap = new Map(ingestionCounts.map((r) => [r.wikiId, r.n]));
      const charMap = new Map(charCounts.map((r) => [r.wikiId, r.n]));

      return wikis.map((row) => ({
        ...normalizeWiki(row),
        pageCount: pageMap.get(row.id) ?? 0,
        edgeCount: edgeMap.get(row.id) ?? 0,
        sourceCount: sourceMap.get(row.id) ?? 0,
        ingestionCount: ingestionMap.get(row.id) ?? 0,
        characterCount: charMap.get(row.id) ?? 0,
      }));
    },

    async getWikiById(id) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikisTable)
          .where(eq(wikisTable.id, id))
          .limit(1),
      );
      return row ? normalizeWiki(row) : null;
    },

    async getWikiBySlug(slug) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikisTable)
          .where(eq(wikisTable.slug, slug))
          .limit(1),
      );
      return row ? normalizeWiki(row) : null;
    },

    async createWiki(input) {
      const db = requireDb();
      const [row] = await db
        .insert(wikisTable)
        .values({
          slug: input.slug,
          title: input.title,
          summary: input.summary ?? null,
          eras: input.eras ?? [],
          ingestionPrompt: input.ingestionPrompt ?? null,
          ingestionPromptName: input.ingestionPromptName ?? null,
        })
        .returning();
      return normalizeWiki(row);
    },

    async updateWiki(id, input) {
      const db = requireDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.summary !== undefined) patch.summary = input.summary;
      if (input.eras !== undefined) patch.eras = input.eras;
      if (input.ingestionPrompt !== undefined)
        patch.ingestionPrompt = input.ingestionPrompt;
      if (input.ingestionPromptName !== undefined)
        patch.ingestionPromptName = input.ingestionPromptName;

      const [row] = await db
        .update(wikisTable)
        .set(patch)
        .where(eq(wikisTable.id, id))
        .returning();
      return row ? normalizeWiki(row) : null;
    },

    async deleteWiki(id) {
      const db = requireDb();
      const rows = await db
        .delete(wikisTable)
        .where(eq(wikisTable.id, id))
        .returning({ id: wikisTable.id });
      return rows.length > 0;
    },

    async listBindingsForCharacter(characterId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(characterKnowledgeBindingsTable)
          .where(eq(characterKnowledgeBindingsTable.characterId, characterId))
          .orderBy(desc(characterKnowledgeBindingsTable.createdAt)),
      );
      return rows.map(normalizeBinding);
    },

    async listBindingsForWiki(wikiId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(characterKnowledgeBindingsTable)
          .where(eq(characterKnowledgeBindingsTable.wikiId, wikiId))
          .orderBy(desc(characterKnowledgeBindingsTable.createdAt)),
      );
      return rows.map(normalizeBinding);
    },

    async getBinding(characterId, wikiId) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(characterKnowledgeBindingsTable)
          .where(
            and(
              eq(characterKnowledgeBindingsTable.characterId, characterId),
              eq(characterKnowledgeBindingsTable.wikiId, wikiId),
            ),
          )
          .limit(1),
      );
      return row ? normalizeBinding(row) : null;
    },

    async createBinding(input) {
      const db = requireDb();
      const [row] = await db
        .insert(characterKnowledgeBindingsTable)
        .values({
          characterId: input.characterId,
          wikiId: input.wikiId,
          priority: input.priority ?? "primary",
          isActive: input.isActive ?? true,
        })
        .returning();
      return normalizeBinding(row);
    },

    async updateBinding(id, input) {
      const db = requireDb();
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.isActive !== undefined) patch.isActive = input.isActive;

      const [row] = await db
        .update(characterKnowledgeBindingsTable)
        .set(patch)
        .where(eq(characterKnowledgeBindingsTable.id, id))
        .returning();
      return row ? normalizeBinding(row) : null;
    },

    async deleteBinding(id) {
      const db = requireDb();
      const rows = await db
        .delete(characterKnowledgeBindingsTable)
        .where(eq(characterKnowledgeBindingsTable.id, id))
        .returning({ id: characterKnowledgeBindingsTable.id });
      return rows.length > 0;
    },

    async listPagesForWiki(wikiId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select({
            id: wikiPagesTable.id,
            slug: wikiPagesTable.slug,
            type: wikiPagesTable.type,
            title: wikiPagesTable.title,
            summary: wikiPagesTable.summary,
            updatedAt: wikiPagesTable.updatedAt,
          })
          .from(wikiPagesTable)
          .where(eq(wikiPagesTable.wikiId, wikiId))
          .orderBy(asc(wikiPagesTable.title)),
      );
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        type: row.type,
        title: row.title,
        summary: row.summary,
        updatedAt: toIso(row.updatedAt),
      }));
    },

    async listSourcesForWiki(wikiId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select({
            id: wikiSourcesTable.id,
            title: wikiSourcesTable.title,
            kind: wikiSourcesTable.kind,
            contentHash: wikiSourcesTable.contentHash,
            createdAt: wikiSourcesTable.createdAt,
          })
          .from(wikiSourcesTable)
          .where(eq(wikiSourcesTable.wikiId, wikiId))
          .orderBy(desc(wikiSourcesTable.createdAt)),
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        kind: row.kind,
        contentHash: row.contentHash,
        createdAt: toIso(row.createdAt),
      }));
    },

    async listIngestionsForWiki(wikiId, limit = 30) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiIngestionLogTable)
          .where(eq(wikiIngestionLogTable.wikiId, wikiId))
          .orderBy(desc(wikiIngestionLogTable.startedAt))
          .limit(limit),
      );
      return rows.map((row) => ({
        id: row.id,
        status: row.status as WikiIngestionSummary["status"],
        startedAt: toIso(row.startedAt),
        finishedAt: row.finishedAt ? toIso(row.finishedAt) : null,
        pagesCreated: row.pagesCreated,
        pagesUpdated: row.pagesUpdated,
        edgesAdded: row.edgesAdded,
        contradictionsFound: row.contradictionsFound,
        tokensUsed: row.tokensUsed,
        model: row.model,
        sourceId: row.sourceId,
        errorMessage: row.errorMessage,
      }));
    },

    async countEdgesForWiki(wikiId) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select({ n: count() })
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.wikiId, wikiId)),
      );
      return row?.n ?? 0;
    },

    async getIconDataForWiki(wikiId, limit = 5) {
      const db = requireDb();

      // Pull pages with cached layout coordinates. Pages without coords
      // (layout not yet computed) are excluded — better to render a smaller
      // graph than misplace dots.
      const pageRows = await retryRead(() =>
        db
          .select({
            id: wikiPagesTable.id,
            x: wikiPagesTable.layoutX,
            y: wikiPagesTable.layoutY,
            type: wikiPagesTable.type,
          })
          .from(wikiPagesTable)
          .where(sql`${wikiPagesTable.wikiId} = ${wikiId}
            and ${wikiPagesTable.layoutX} is not null
            and ${wikiPagesTable.layoutY} is not null`),
      );

      if (pageRows.length === 0) {
        return { nodes: [], edges: [] };
      }

      const pagesById = new Map(pageRows.map((p) => [p.id, p]));

      // All edges within this wiki. We compute degree from the full edge
      // set (so node prominence reflects the entire graph), then keep
      // only the edges among the top-N for the rendered icon.
      const edgeRows = await retryRead(() =>
        db
          .select({
            fromPageId: wikiEdgesTable.fromPageId,
            toPageId: wikiEdgesTable.toPageId,
            strength: wikiEdgesTable.strength,
          })
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.wikiId, wikiId)),
      );

      const degree = new Map<string, number>();
      for (const e of edgeRows) {
        if (!pagesById.has(e.fromPageId) || !pagesById.has(e.toPageId)) continue;
        degree.set(e.fromPageId, (degree.get(e.fromPageId) ?? 0) + 1);
        degree.set(e.toPageId, (degree.get(e.toPageId) ?? 0) + 1);
      }

      const ranked = pageRows
        .map((p) => ({
          id: p.id,
          x: p.x as number,
          y: p.y as number,
          degree: degree.get(p.id) ?? 0,
          type: p.type as WikiPageType,
        }))
        // Highest-degree first; stable id tiebreaker keeps renders deterministic.
        .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
        .slice(0, limit);

      const kept = new Set(ranked.map((n) => n.id));
      const edges = edgeRows
        .filter((e) => kept.has(e.fromPageId) && kept.has(e.toPageId))
        .map((e) => ({
          from: e.fromPageId,
          to: e.toPageId,
          strength: e.strength,
        }));

      return { nodes: ranked, edges };
    },

    async listWikisForCharacter(characterId) {
      const db = requireDb();

      const PRIORITY_RANK = sql<number>`CASE ${characterKnowledgeBindingsTable.priority}
        WHEN 'primary' THEN 0
        WHEN 'secondary' THEN 1
        WHEN 'reference' THEN 2
        ELSE 3
      END`;

      const rows = await retryRead(() =>
        db
          .select({
            binding: characterKnowledgeBindingsTable,
            wiki: wikisTable,
          })
          .from(characterKnowledgeBindingsTable)
          .innerJoin(
            wikisTable,
            eq(wikisTable.id, characterKnowledgeBindingsTable.wikiId),
          )
          .where(eq(characterKnowledgeBindingsTable.characterId, characterId))
          .orderBy(PRIORITY_RANK, asc(characterKnowledgeBindingsTable.createdAt)),
      );

      return rows.map((row) => ({
        ...normalizeWiki(row.wiki),
        binding: normalizeBinding(row.binding),
      }));
    },
  };
}

let cached: WikisStore | null = null;

export function getWikisStore(): WikisStore {
  if (!cached) cached = neonStore();
  return cached;
}
