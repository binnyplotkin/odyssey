/**
 * Wiki store — CRUD for pages, versions, edges, sources, and ingestion runs.
 *
 * The core primitive is `savePage`, which atomically (best-effort over HTTP):
 *   1. Upserts the page by (characterId, slug)
 *   2. Decides whether the page materially changed (body/frontmatter/etc.)
 *   3. Bumps the version + writes a snapshot if it changed
 *   4. Reconciles edges: parses wikilinks + reads frontmatter, diffs against
 *      current edges for this page, inserts new + deletes removed
 *
 * Edges are a cache — the body and frontmatter are the source of truth.
 * `rebuildEdges(characterId)` is the safety valve for when drift shows up.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import {
  wikiEdgesTable,
  wikiIngestionLogTable,
  wikiPagesTable,
  wikiPageVersionsTable,
  wikiSourceRefsTable,
  wikiSourcesTable,
} from "./schema";
import { extractReferencedSlugs } from "./wiki-links";
import type {
  Contradiction,
  CreateSourceInput,
  CreateSourceRefInput,
  EdgeKind,
  EventFrontmatter,
  FinishIngestionInput,
  Frontmatter,
  IngestionStatus,
  Perspective,
  RelationshipFrontmatter,
  SavePageInput,
  SavePageResult,
  StartIngestionInput,
  TimeIndex,
  WikiEdgeRecord,
  WikiIngestionLogRecord,
  WikiPageRecord,
  WikiPageType,
  WikiPageVersionRecord,
  WikiSourceKind,
  WikiSourceRecord,
  WikiSourceRefRecord,
} from "./wiki-types";

/* ── Helpers ────────────────────────────────────────────────────── */

function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function requireIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the wiki store");
  return db;
}

function normalizePage(row: typeof wikiPagesTable.$inferSelect): WikiPageRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    type: row.type as WikiPageType,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    frontmatter: (row.frontmatter as Frontmatter | null) ?? ({} as Frontmatter),
    perspective: (row.perspective as Perspective | null) ?? {},
    confidence: row.confidence,
    timeIndex: (row.timeIndex as TimeIndex | null) ?? null,
    knowsFuture: row.knowsFuture,
    contradictions: (row.contradictions as Contradiction[] | null) ?? [],
    version: row.version,
    lastCompiledAt: toIso(row.lastCompiledAt),
    createdAt: requireIso(row.createdAt),
    updatedAt: requireIso(row.updatedAt),
  };
}

function normalizeVersion(
  row: typeof wikiPageVersionsTable.$inferSelect,
): WikiPageVersionRecord {
  return {
    id: row.id,
    pageId: row.pageId,
    version: row.version,
    title: row.title,
    summary: row.summary,
    body: row.body,
    frontmatter: (row.frontmatter as Frontmatter | null) ?? ({} as Frontmatter),
    perspective: (row.perspective as Perspective | null) ?? {},
    confidence: row.confidence,
    timeIndex: (row.timeIndex as TimeIndex | null) ?? null,
    authorKind: row.authorKind as WikiPageVersionRecord["authorKind"],
    authorId: row.authorId,
    note: row.note,
    createdAt: requireIso(row.createdAt),
  };
}

function normalizeEdge(row: typeof wikiEdgesTable.$inferSelect): WikiEdgeRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    fromPageId: row.fromPageId,
    toPageId: row.toPageId,
    kind: row.kind as EdgeKind,
    strength: row.strength,
    lastSeenAt: requireIso(row.lastSeenAt),
    createdAt: requireIso(row.createdAt),
  };
}

function normalizeSource(
  row: typeof wikiSourcesTable.$inferSelect,
): WikiSourceRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    title: row.title,
    kind: row.kind as WikiSourceKind,
    content: row.content,
    contentHash: row.contentHash,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    createdAt: requireIso(row.createdAt),
    updatedAt: requireIso(row.updatedAt),
  };
}

function normalizeSourceRef(
  row: typeof wikiSourceRefsTable.$inferSelect,
): WikiSourceRefRecord {
  return {
    id: row.id,
    pageId: row.pageId,
    sourceId: row.sourceId,
    passage: row.passage,
    quote: row.quote,
    relevanceNote: row.relevanceNote,
    createdAt: requireIso(row.createdAt),
  };
}

function normalizeIngestion(
  row: typeof wikiIngestionLogTable.$inferSelect,
): WikiIngestionLogRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    sourceId: row.sourceId,
    startedAt: requireIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    status: row.status as IngestionStatus,
    model: row.model,
    promptHash: row.promptHash,
    pagesCreated: row.pagesCreated,
    pagesUpdated: row.pagesUpdated,
    edgesAdded: row.edgesAdded,
    contradictionsFound: row.contradictionsFound,
    tokensUsed: row.tokensUsed,
    errorMessage: row.errorMessage,
    notes: row.notes,
  };
}

/* ── Edge derivation ────────────────────────────────────────────── */

/** A derived edge, pre-resolution to page IDs (target is still a slug). */
type DerivedEdge = {
  toSlug: string;
  kind: EdgeKind;
  strength: number;
};

/**
 * Derive the intended edges for a page from its body + frontmatter.
 * Returns deduped edges — if the same (toSlug, kind) shows up multiple times,
 * the higher strength wins.
 */
function deriveEdges(
  type: WikiPageType,
  body: string,
  frontmatter: Frontmatter,
  contradictions: Contradiction[],
): DerivedEdge[] {
  const out = new Map<string, DerivedEdge>();

  function push(edge: DerivedEdge) {
    if (!edge.toSlug) return;
    const key = `${edge.toSlug}::${edge.kind}`;
    const existing = out.get(key);
    if (!existing || existing.strength < edge.strength) out.set(key, edge);
  }

  // 1. All wikilinks in the body → mentions
  for (const slug of extractReferencedSlugs(body)) {
    push({ toSlug: slug, kind: "mentions", strength: 0.5 });
  }

  // 2. Structured edges from frontmatter, by page type
  if (type === "event") {
    const fm = frontmatter as EventFrontmatter;
    if (fm.where) push({ toSlug: fm.where, kind: "happens_at", strength: 1 });
    for (const p of fm.participants ?? []) {
      push({ toSlug: p, kind: "participates_in", strength: 1 });
    }
    for (const c of fm.causes ?? []) push({ toSlug: c, kind: "mentions", strength: 0.8 });
    for (const e of fm.effects ?? []) push({ toSlug: e, kind: "mentions", strength: 0.8 });
  } else if (type === "relationship") {
    const fm = frontmatter as RelationshipFrontmatter;
    if (fm.from) push({ toSlug: fm.from, kind: "relates_to", strength: 1 });
    if (fm.to) push({ toSlug: fm.to, kind: "relates_to", strength: 1 });
    for (const ev of fm.evolution ?? []) push({ toSlug: ev, kind: "mentions", strength: 0.7 });
  }

  // 3. Contradictions are edges too (they reference pageIds directly, not slugs,
  //    so they're handled separately in reconcileEdgesForPage — not here).
  void contradictions;

  return Array.from(out.values());
}

/**
 * Reconcile the edge set for a single page: derive intended edges, load
 * current edges, compute add/remove, apply. Returns counts.
 */
async function reconcileEdgesForPage(
  db: ReturnType<typeof requireDb>,
  page: WikiPageRecord,
  slugToId: Map<string, string>,
): Promise<{ added: number; removed: number }> {
  const derived = deriveEdges(page.type, page.body, page.frontmatter, page.contradictions);

  // Desired edge set (only those whose target slug resolves)
  const desired = new Map<string, DerivedEdge & { toPageId: string }>();
  for (const e of derived) {
    const toPageId = slugToId.get(e.toSlug);
    if (!toPageId) continue;
    if (toPageId === page.id) continue; // no self-edges
    desired.set(`${toPageId}::${e.kind}`, { ...e, toPageId });
  }

  // Contradictions reference pageIds directly
  for (const c of page.contradictions) {
    if (!c.otherPageId || c.otherPageId === page.id) continue;
    desired.set(`${c.otherPageId}::contradicts`, {
      toSlug: "",
      kind: "contradicts",
      strength: 1,
      toPageId: c.otherPageId,
    });
  }

  // Current edges for this page
  const existingRows = await db
    .select()
    .from(wikiEdgesTable)
    .where(eq(wikiEdgesTable.fromPageId, page.id));
  const existing = new Map(existingRows.map((r) => [`${r.toPageId}::${r.kind}`, r]));

  // Compute diff
  const toInsert: { toPageId: string; kind: EdgeKind; strength: number }[] = [];
  const toDelete: string[] = [];

  for (const [key, want] of desired) {
    if (!existing.has(key)) {
      toInsert.push({ toPageId: want.toPageId, kind: want.kind, strength: want.strength });
    }
  }
  for (const [key, have] of existing) {
    if (!desired.has(key)) toDelete.push(have.id);
  }

  // Apply
  if (toDelete.length > 0) {
    await db.delete(wikiEdgesTable).where(inArray(wikiEdgesTable.id, toDelete));
  }
  if (toInsert.length > 0) {
    const now = new Date();
    await db.insert(wikiEdgesTable).values(
      toInsert.map((e) => ({
        characterId: page.characterId,
        fromPageId: page.id,
        toPageId: e.toPageId,
        kind: e.kind,
        strength: e.strength,
        lastSeenAt: now,
        createdAt: now,
      })),
    );
  }

  return { added: toInsert.length, removed: toDelete.length };
}

/**
 * Decide whether a save is a material change from the existing row.
 * Cosmetic updates (e.g. touch lastCompiledAt only) skip the version bump.
 */
function isMaterialChange(existing: WikiPageRecord, input: Required<SavePageInput>): boolean {
  if (existing.title !== input.title) return true;
  if ((existing.summary ?? "") !== (input.summary ?? "")) return true;
  if (existing.body !== input.body) return true;
  if (existing.confidence !== input.confidence) return true;
  if (existing.knowsFuture !== input.knowsFuture) return true;
  if (JSON.stringify(existing.frontmatter) !== JSON.stringify(input.frontmatter)) return true;
  if (JSON.stringify(existing.perspective) !== JSON.stringify(input.perspective)) return true;
  if (JSON.stringify(existing.timeIndex) !== JSON.stringify(input.timeIndex)) return true;
  if (JSON.stringify(existing.contradictions) !== JSON.stringify(input.contradictions)) return true;
  return false;
}

/* ── Public interface ───────────────────────────────────────────── */

export interface WikiStore {
  // Pages
  savePage(input: SavePageInput): Promise<SavePageResult>;
  getPage(id: string): Promise<WikiPageRecord | null>;
  getPageBySlug(characterId: string, slug: string): Promise<WikiPageRecord | null>;
  listPages(characterId: string, filter?: { type?: WikiPageType }): Promise<WikiPageRecord[]>;
  removePage(id: string): Promise<boolean>;

  // Versions
  listPageVersions(pageId: string): Promise<WikiPageVersionRecord[]>;
  getPageVersion(pageId: string, version: number): Promise<WikiPageVersionRecord | null>;

  // Edges
  listOutgoing(pageId: string): Promise<WikiEdgeRecord[]>;
  listIncoming(pageId: string): Promise<WikiEdgeRecord[]>;
  listCharacterEdges(characterId: string): Promise<WikiEdgeRecord[]>;
  /**
   * Safety valve: wipe and rebuild every edge for a character, sourcing
   * edges from each page's current body + frontmatter + contradictions.
   */
  rebuildEdges(characterId: string): Promise<{ added: number; removed: number }>;

  // Sources
  createSource(input: CreateSourceInput): Promise<WikiSourceRecord>;
  getSource(id: string): Promise<WikiSourceRecord | null>;
  findSourceByHash(characterId: string, contentHash: string): Promise<WikiSourceRecord | null>;
  listSources(characterId: string): Promise<WikiSourceRecord[]>;
  removeSource(id: string): Promise<boolean>;

  // Source refs
  addSourceRefs(refs: CreateSourceRefInput[]): Promise<void>;
  clearSourceRefsForPage(pageId: string): Promise<void>;
  listSourceRefsForPage(pageId: string): Promise<WikiSourceRefRecord[]>;

  // Ingestion log
  startIngestion(input: StartIngestionInput): Promise<WikiIngestionLogRecord>;
  finishIngestion(
    id: string,
    result: FinishIngestionInput,
  ): Promise<WikiIngestionLogRecord | null>;
  listIngestionRuns(characterId: string, limit?: number): Promise<WikiIngestionLogRecord[]>;
}

/* ── Implementation ─────────────────────────────────────────────── */

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function neonStore(): WikiStore {
  return {
    /* ── Pages ───────────────────────────────────────────── */

    async savePage(input) {
      const db = requireDb();

      const normalized: Required<SavePageInput> = {
        characterId: input.characterId,
        type: input.type,
        slug: input.slug,
        title: input.title,
        summary: input.summary ?? null,
        body: input.body ?? "",
        frontmatter: input.frontmatter ?? ({} as Frontmatter),
        perspective: input.perspective ?? {},
        confidence: input.confidence ?? 0.5,
        timeIndex: input.timeIndex ?? null,
        knowsFuture: input.knowsFuture ?? false,
        contradictions: input.contradictions ?? [],
        authorKind: input.authorKind ?? "human",
        authorId: input.authorId ?? null,
        note: input.note ?? null,
      };

      const [existingRow] = await db
        .select()
        .from(wikiPagesTable)
        .where(
          and(
            eq(wikiPagesTable.characterId, normalized.characterId),
            eq(wikiPagesTable.slug, normalized.slug),
          ),
        )
        .limit(1);

      const now = new Date();
      let pageRow: typeof wikiPagesTable.$inferSelect;
      let created = false;
      let versionCreated = false;

      if (existingRow) {
        const existing = normalizePage(existingRow);
        const material = isMaterialChange(existing, normalized);
        const nextVersion = material ? existing.version + 1 : existing.version;

        const [updated] = await db
          .update(wikiPagesTable)
          .set({
            type: normalized.type,
            title: normalized.title,
            summary: normalized.summary,
            body: normalized.body,
            frontmatter: normalized.frontmatter,
            perspective: normalized.perspective,
            confidence: normalized.confidence,
            timeIndex: normalized.timeIndex,
            knowsFuture: normalized.knowsFuture,
            contradictions: normalized.contradictions,
            version: nextVersion,
            lastCompiledAt: now,
            updatedAt: now,
          })
          .where(eq(wikiPagesTable.id, existing.id))
          .returning();
        pageRow = updated;

        if (material) {
          await db.insert(wikiPageVersionsTable).values({
            pageId: existing.id,
            version: nextVersion,
            title: normalized.title,
            summary: normalized.summary,
            body: normalized.body,
            frontmatter: normalized.frontmatter,
            perspective: normalized.perspective,
            confidence: normalized.confidence,
            timeIndex: normalized.timeIndex,
            authorKind: normalized.authorKind,
            authorId: normalized.authorId,
            note: normalized.note,
            createdAt: now,
          });
          versionCreated = true;
        }
      } else {
        const [inserted] = await db
          .insert(wikiPagesTable)
          .values({
            characterId: normalized.characterId,
            type: normalized.type,
            slug: normalized.slug,
            title: normalized.title,
            summary: normalized.summary,
            body: normalized.body,
            frontmatter: normalized.frontmatter,
            perspective: normalized.perspective,
            confidence: normalized.confidence,
            timeIndex: normalized.timeIndex,
            knowsFuture: normalized.knowsFuture,
            contradictions: normalized.contradictions,
            version: 1,
            lastCompiledAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        pageRow = inserted;
        created = true;

        // Initial version snapshot
        await db.insert(wikiPageVersionsTable).values({
          pageId: pageRow.id,
          version: 1,
          title: normalized.title,
          summary: normalized.summary,
          body: normalized.body,
          frontmatter: normalized.frontmatter,
          perspective: normalized.perspective,
          confidence: normalized.confidence,
          timeIndex: normalized.timeIndex,
          authorKind: normalized.authorKind,
          authorId: normalized.authorId,
          note: normalized.note ?? "initial",
          createdAt: now,
        });
        versionCreated = true;
      }

      const page = normalizePage(pageRow);

      // Edge reconcile — read full slug→id index for this character
      const slugRows = await db
        .select({ id: wikiPagesTable.id, slug: wikiPagesTable.slug })
        .from(wikiPagesTable)
        .where(eq(wikiPagesTable.characterId, normalized.characterId));
      const slugToId = new Map(slugRows.map((r) => [r.slug, r.id]));

      const diff = await reconcileEdgesForPage(db, page, slugToId);

      return {
        page,
        created,
        versionCreated,
        edgesAdded: diff.added,
        edgesRemoved: diff.removed,
      };
    },

    async getPage(id) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(wikiPagesTable)
        .where(eq(wikiPagesTable.id, id))
        .limit(1);
      return row ? normalizePage(row) : null;
    },

    async getPageBySlug(characterId, slug) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(wikiPagesTable)
        .where(and(eq(wikiPagesTable.characterId, characterId), eq(wikiPagesTable.slug, slug)))
        .limit(1);
      return row ? normalizePage(row) : null;
    },

    async listPages(characterId, filter) {
      const db = requireDb();
      const whereClause = filter?.type
        ? and(
            eq(wikiPagesTable.characterId, characterId),
            eq(wikiPagesTable.type, filter.type),
          )
        : eq(wikiPagesTable.characterId, characterId);
      const rows = await db.select().from(wikiPagesTable).where(whereClause);
      return rows.map(normalizePage).sort((a, b) => a.title.localeCompare(b.title));
    },

    async removePage(id) {
      const db = requireDb();
      const result = await db.delete(wikiPagesTable).where(eq(wikiPagesTable.id, id)).returning();
      return result.length > 0;
    },

    /* ── Versions ────────────────────────────────────────── */

    async listPageVersions(pageId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiPageVersionsTable)
        .where(eq(wikiPageVersionsTable.pageId, pageId))
        .orderBy(desc(wikiPageVersionsTable.version));
      return rows.map(normalizeVersion);
    },

    async getPageVersion(pageId, version) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(wikiPageVersionsTable)
        .where(
          and(
            eq(wikiPageVersionsTable.pageId, pageId),
            eq(wikiPageVersionsTable.version, version),
          ),
        )
        .limit(1);
      return row ? normalizeVersion(row) : null;
    },

    /* ── Edges ───────────────────────────────────────────── */

    async listOutgoing(pageId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiEdgesTable)
        .where(eq(wikiEdgesTable.fromPageId, pageId));
      return rows.map(normalizeEdge);
    },

    async listIncoming(pageId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiEdgesTable)
        .where(eq(wikiEdgesTable.toPageId, pageId));
      return rows.map(normalizeEdge);
    },

    async listCharacterEdges(characterId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiEdgesTable)
        .where(eq(wikiEdgesTable.characterId, characterId));
      return rows.map(normalizeEdge);
    },

    async rebuildEdges(characterId) {
      const db = requireDb();

      // Snapshot current edge count (for the "removed" metric)
      const existingRows = await db
        .select({ id: wikiEdgesTable.id })
        .from(wikiEdgesTable)
        .where(eq(wikiEdgesTable.characterId, characterId));
      const existingCount = existingRows.length;

      // Wipe
      await db.delete(wikiEdgesTable).where(eq(wikiEdgesTable.characterId, characterId));

      // Load all pages for this character
      const pageRows = await db
        .select()
        .from(wikiPagesTable)
        .where(eq(wikiPagesTable.characterId, characterId));
      const pages = pageRows.map(normalizePage);
      const slugToId = new Map(pages.map((p) => [p.slug, p.id]));

      let added = 0;
      for (const page of pages) {
        const diff = await reconcileEdgesForPage(db, page, slugToId);
        added += diff.added;
      }

      return { added, removed: existingCount };
    },

    /* ── Sources ─────────────────────────────────────────── */

    async createSource(input) {
      const db = requireDb();
      const contentHash = await sha256Hex(input.content);
      const now = new Date();
      const [row] = await db
        .insert(wikiSourcesTable)
        .values({
          characterId: input.characterId,
          title: input.title,
          kind: input.kind,
          content: input.content,
          contentHash,
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return normalizeSource(row);
    },

    async getSource(id) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(wikiSourcesTable)
        .where(eq(wikiSourcesTable.id, id))
        .limit(1);
      return row ? normalizeSource(row) : null;
    },

    async findSourceByHash(characterId, contentHash) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(wikiSourcesTable)
        .where(
          and(
            eq(wikiSourcesTable.characterId, characterId),
            eq(wikiSourcesTable.contentHash, contentHash),
          ),
        )
        .limit(1);
      return row ? normalizeSource(row) : null;
    },

    async listSources(characterId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiSourcesTable)
        .where(eq(wikiSourcesTable.characterId, characterId))
        .orderBy(desc(wikiSourcesTable.createdAt));
      return rows.map(normalizeSource);
    },

    async removeSource(id) {
      const db = requireDb();
      const result = await db
        .delete(wikiSourcesTable)
        .where(eq(wikiSourcesTable.id, id))
        .returning();
      return result.length > 0;
    },

    /* ── Source refs ─────────────────────────────────────── */

    async addSourceRefs(refs) {
      if (refs.length === 0) return;
      const db = requireDb();
      const now = new Date();
      await db.insert(wikiSourceRefsTable).values(
        refs.map((r) => ({
          pageId: r.pageId,
          sourceId: r.sourceId,
          passage: r.passage ?? null,
          quote: r.quote ?? null,
          relevanceNote: r.relevanceNote ?? null,
          createdAt: now,
        })),
      );
    },

    async clearSourceRefsForPage(pageId) {
      const db = requireDb();
      await db.delete(wikiSourceRefsTable).where(eq(wikiSourceRefsTable.pageId, pageId));
    },

    async listSourceRefsForPage(pageId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiSourceRefsTable)
        .where(eq(wikiSourceRefsTable.pageId, pageId))
        .orderBy(desc(wikiSourceRefsTable.createdAt));
      return rows.map(normalizeSourceRef);
    },

    /* ── Ingestion log ───────────────────────────────────── */

    async startIngestion(input) {
      const db = requireDb();
      const [row] = await db
        .insert(wikiIngestionLogTable)
        .values({
          characterId: input.characterId,
          sourceId: input.sourceId ?? null,
          startedAt: new Date(),
          status: "running",
          model: input.model ?? null,
          promptHash: input.promptHash ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      return normalizeIngestion(row);
    },

    async finishIngestion(id, result) {
      const db = requireDb();
      const [row] = await db
        .update(wikiIngestionLogTable)
        .set({
          finishedAt: new Date(),
          status: result.status,
          pagesCreated: result.pagesCreated ?? 0,
          pagesUpdated: result.pagesUpdated ?? 0,
          edgesAdded: result.edgesAdded ?? 0,
          contradictionsFound: result.contradictionsFound ?? 0,
          tokensUsed: result.tokensUsed ?? 0,
          errorMessage: result.errorMessage ?? null,
        })
        .where(eq(wikiIngestionLogTable.id, id))
        .returning();
      return row ? normalizeIngestion(row) : null;
    },

    async listIngestionRuns(characterId, limit = 50) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(wikiIngestionLogTable)
        .where(eq(wikiIngestionLogTable.characterId, characterId))
        .orderBy(desc(wikiIngestionLogTable.startedAt))
        .limit(limit);
      return rows.map(normalizeIngestion);
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────── */

let _store: WikiStore | null = null;

export function getWikiStore(): WikiStore {
  if (!_store) _store = neonStore();
  return _store;
}
