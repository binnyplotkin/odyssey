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

import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  wikiEdgesTable,
  wikiIngestionEventsTable,
  wikiIngestionLogTable,
  wikiPagesTable,
  wikiPageVersionsTable,
  wikiSourceRefsTable,
  wikiSourcesTable,
  characterKnowledgeBindingsTable,
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
  SavePageHooks,
  SavePageInput,
  SavePageResult,
  StartIngestionInput,
  TimeIndex,
  WikiEdgeRecord,
  WikiIngestionEventRecord,
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

function column(row: object, camel: string, snake: string): unknown {
  const record = row as Record<string, unknown>;
  return record[camel] ?? record[snake];
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function nullableIso(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value as Date | string | null);
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the wiki store");
  return db;
}

/**
 * Identify the orphan page IDs for a given source (pages whose only
 * provenance is this source) and the edges that would cascade off them.
 * Shared between the real purge and the preview.
 */
async function collectPurgeImpact(sourceId: string): Promise<{
  orphanPageIds: string[];
  edgeCount: number;
}> {
  const db = requireDb();

  const targetRefs = await retryRead(() =>
    db
      .select({ pageId: wikiSourceRefsTable.pageId })
      .from(wikiSourceRefsTable)
      .where(eq(wikiSourceRefsTable.sourceId, sourceId)),
  );
  const candidatePageIds = Array.from(new Set(targetRefs.map((r) => r.pageId)));

  if (candidatePageIds.length === 0) {
    return { orphanPageIds: [], edgeCount: 0 };
  }

  const allRefs = await retryRead(() =>
    db
      .select({
        pageId: wikiSourceRefsTable.pageId,
        sourceId: wikiSourceRefsTable.sourceId,
      })
      .from(wikiSourceRefsTable)
      .where(inArray(wikiSourceRefsTable.pageId, candidatePageIds)),
  );
  const sourceIdsByPage = new Map<string, Set<string>>();
  for (const r of allRefs) {
    const set = sourceIdsByPage.get(r.pageId) ?? new Set<string>();
    set.add(r.sourceId);
    sourceIdsByPage.set(r.pageId, set);
  }
  const orphanPageIds = candidatePageIds.filter(
    (id) => (sourceIdsByPage.get(id)?.size ?? 0) === 1,
  );

  if (orphanPageIds.length === 0) {
    return { orphanPageIds, edgeCount: 0 };
  }

  const edgeRows = await retryRead(() =>
    db
      .select({ id: wikiEdgesTable.id })
      .from(wikiEdgesTable)
      .where(
        or(
          inArray(wikiEdgesTable.fromPageId, orphanPageIds),
          inArray(wikiEdgesTable.toPageId, orphanPageIds),
        ),
      ),
  );

  return { orphanPageIds, edgeCount: edgeRows.length };
}

async function previewPurgeSourceImpl(sourceId: string): Promise<{
  pagesRemoved: number;
  edgesRemoved: number;
}> {
  const { orphanPageIds, edgeCount } = await collectPurgeImpact(sourceId);
  return { pagesRemoved: orphanPageIds.length, edgesRemoved: edgeCount };
}

/**
 * Delete a source plus any pages whose *only* provenance was this source.
 * Shared by `purgeSource` (direct) and `purgeIngestionRun` (indirect).
 */
async function purgeSourceImpl(sourceId: string): Promise<{
  sourceRemoved: number;
  pagesRemoved: number;
  edgesRemoved: number;
}> {
  const db = requireDb();
  const { orphanPageIds, edgeCount } = await collectPurgeImpact(sourceId);

  if (orphanPageIds.length > 0) {
    await db
      .delete(wikiPagesTable)
      .where(inArray(wikiPagesTable.id, orphanPageIds));
  }

  const sourceResult = await db
    .delete(wikiSourcesTable)
    .where(eq(wikiSourcesTable.id, sourceId))
    .returning({ id: wikiSourcesTable.id });

  return {
    sourceRemoved: sourceResult.length,
    pagesRemoved: orphanPageIds.length,
    edgesRemoved: edgeCount,
  };
}

/**
 * Coerce a pgvector column value into a JS `number[]`.
 *
 * Neon's serverless driver returns the `vector` column as the raw Postgres
 * literal `"[0.1,0.2,…]"` — a string. Drizzle's `vector()` type doesn't
 * un-stringify it on read, so blindly casting to `number[]` lands you with
 * a string that downstream consumers (e.g. cosineSimilarity loops, semantic
 * layout) iterate character-by-character and produce NaN from.
 *
 * This parser accepts either form: an actual array of numbers (in case a
 * future driver upgrade hands us one) or the textual literal. Anything else
 * — including arrays with non-numeric entries — falls back to null so the
 * caller can treat the page as "not embedded" cleanly.
 */
function parseEmbedding(value: unknown): number[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === "number" && Number.isFinite(v))
      ? (value as number[])
      : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return [];
  const parts = inner.split(",");
  const out: number[] = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

function normalizePage(
  row: typeof wikiPagesTable.$inferSelect,
): WikiPageRecord {
  return {
    id: row.id,
    characterId: row.characterId ?? "",
    wikiId: row.wikiId ?? null,
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
    embedding: parseEmbedding(row.embedding),
    embeddingModel: row.embeddingModel ?? null,
    embeddedAt: toIso(row.embeddedAt),
    layoutX: row.layoutX ?? null,
    layoutY: row.layoutY ?? null,
    layoutComputedAt: toIso(row.layoutComputedAt),
    createdAt: requireIso(row.createdAt),
    updatedAt: requireIso(row.updatedAt),
  };
}

/** Source text for embedding a page. Single function so backfill, savePage,
 * and any future re-embed flow always agree on what gets vectorized. */
export function wikiEmbeddingSource(input: {
  title: string;
  summary?: string | null;
  body?: string;
}): string {
  return [input.title, input.summary ?? "", input.body ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
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

function normalizeEdge(
  row: typeof wikiEdgesTable.$inferSelect,
): WikiEdgeRecord {
  return {
    id: row.id,
    characterId: row.characterId ?? "",
    wikiId: row.wikiId ?? null,
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
    characterId: row.characterId ?? "",
    wikiId: row.wikiId ?? null,
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
  const startedAt = column(row, "startedAt", "started_at");
  return {
    id: row.id,
    characterId: nullableString(column(row, "characterId", "character_id")) ?? "",
    wikiId: nullableString(column(row, "wikiId", "wiki_id")),
    sourceId: nullableString(column(row, "sourceId", "source_id")),
    startedAt: requireIso(startedAt as Date | string),
    finishedAt: nullableIso(column(row, "finishedAt", "finished_at")),
    status: String(column(row, "status", "status")) as IngestionStatus,
    model: nullableString(column(row, "model", "model")),
    promptHash: nullableString(column(row, "promptHash", "prompt_hash")),
    pagesCreated: Number(column(row, "pagesCreated", "pages_created") ?? 0),
    pagesUpdated: Number(column(row, "pagesUpdated", "pages_updated") ?? 0),
    edgesAdded: Number(column(row, "edgesAdded", "edges_added") ?? 0),
    contradictionsFound: Number(column(row, "contradictionsFound", "contradictions_found") ?? 0),
    tokensUsed: Number(column(row, "tokensUsed", "tokens_used") ?? 0),
    errorMessage: nullableString(column(row, "errorMessage", "error_message")),
    notes: nullableString(column(row, "notes", "notes")),
    workerId: nullableString(column(row, "workerId", "worker_id")),
    claimedAt: nullableIso(column(row, "claimedAt", "claimed_at")),
    heartbeatAt: nullableIso(column(row, "heartbeatAt", "heartbeat_at")),
  };
}

function normalizeIngestionEvent(
  row: typeof wikiIngestionEventsTable.$inferSelect,
): WikiIngestionEventRecord {
  const createdAt = column(row, "createdAt", "created_at");
  return {
    id: row.id,
    runId: String(column(row, "runId", "run_id")),
    seq: Number(column(row, "seq", "seq")),
    type: String(column(row, "type", "type")),
    payload: column(row, "payload", "payload"),
    createdAt: requireIso(createdAt as Date | string),
  };
}

/* ── Edge derivation ────────────────────────────────────────────── */

/** A derived edge, pre-resolution to page IDs (target is still a slug). */
type DerivedEdge = {
  toSlug: string;
  kind: EdgeKind;
  strength: number;
};

type PageScope =
  | { kind: "wiki"; wikiId: string; characterId: string | null }
  | { kind: "character"; characterId: string; wikiId: string | null };

type NormalizedSavePageInput = Omit<
  Required<SavePageInput>,
  "characterId" | "wikiId"
> & {
  characterId: string | null;
  wikiId: string | null;
};

function resolvePageScope(input: {
  characterId?: string | null;
  wikiId?: string | null;
}): PageScope {
  if (input.wikiId) {
    return {
      kind: "wiki",
      wikiId: input.wikiId,
      characterId: input.characterId ?? null,
    };
  }
  if (input.characterId) {
    return {
      kind: "character",
      characterId: input.characterId,
      wikiId: input.wikiId ?? null,
    };
  }
  throw new Error("savePage requires either wikiId or characterId");
}

function scopeWhere(scope: PageScope) {
  return scope.kind === "wiki"
    ? eq(wikiPagesTable.wikiId, scope.wikiId)
    : eq(wikiPagesTable.characterId, scope.characterId);
}

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
    for (const c of fm.causes ?? [])
      push({ toSlug: c, kind: "mentions", strength: 0.8 });
    for (const e of fm.effects ?? [])
      push({ toSlug: e, kind: "mentions", strength: 0.8 });
  } else if (type === "relationship") {
    const fm = frontmatter as RelationshipFrontmatter;
    if (fm.from) push({ toSlug: fm.from, kind: "relates_to", strength: 1 });
    if (fm.to) push({ toSlug: fm.to, kind: "relates_to", strength: 1 });
    for (const ev of fm.evolution ?? [])
      push({ toSlug: ev, kind: "mentions", strength: 0.7 });
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
  const derived = deriveEdges(
    page.type,
    page.body,
    page.frontmatter,
    page.contradictions,
  );

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
  const existingRows = await retryRead(() =>
    db
      .select()
      .from(wikiEdgesTable)
      .where(eq(wikiEdgesTable.fromPageId, page.id)),
  );
  const existing = new Map(
    existingRows.map((r) => [`${r.toPageId}::${r.kind}`, r]),
  );

  // Compute diff
  const toInsert: { toPageId: string; kind: EdgeKind; strength: number }[] = [];
  const toDelete: string[] = [];

  for (const [key, want] of desired) {
    if (!existing.has(key)) {
      toInsert.push({
        toPageId: want.toPageId,
        kind: want.kind,
        strength: want.strength,
      });
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
    const legacyCharacterId =
      page.characterId || (await resolveLegacyEdgeCharacterId(db, page.wikiId));
    await db.insert(wikiEdgesTable).values(
      toInsert.map((e) => ({
        characterId: legacyCharacterId,
        wikiId: page.wikiId,
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

async function resolveLegacyEdgeCharacterId(
  db: ReturnType<typeof requireDb>,
  wikiId: string | null,
): Promise<string | null> {
  if (!wikiId) return null;
  const [binding] = await retryRead(() =>
    db
      .select({ characterId: characterKnowledgeBindingsTable.characterId })
      .from(characterKnowledgeBindingsTable)
      .where(
        and(
          eq(characterKnowledgeBindingsTable.wikiId, wikiId),
          eq(characterKnowledgeBindingsTable.isActive, true),
        ),
      )
      .orderBy(desc(characterKnowledgeBindingsTable.createdAt))
      .limit(1),
  );
  return binding?.characterId ?? null;
}

/**
 * Decide whether a save is a material change from the existing row.
 * Cosmetic updates (e.g. touch lastCompiledAt only) skip the version bump.
 */
function isMaterialChange(
  existing: WikiPageRecord,
  input: NormalizedSavePageInput,
): boolean {
  if (existing.title !== input.title) return true;
  if ((existing.summary ?? "") !== (input.summary ?? "")) return true;
  if (existing.body !== input.body) return true;
  if (existing.confidence !== input.confidence) return true;
  if (existing.knowsFuture !== input.knowsFuture) return true;
  if (
    JSON.stringify(existing.frontmatter) !== JSON.stringify(input.frontmatter)
  )
    return true;
  if (
    JSON.stringify(existing.perspective) !== JSON.stringify(input.perspective)
  )
    return true;
  if (JSON.stringify(existing.timeIndex) !== JSON.stringify(input.timeIndex))
    return true;
  if (
    JSON.stringify(existing.contradictions) !==
    JSON.stringify(input.contradictions)
  )
    return true;
  return false;
}

/* ── Public interface ───────────────────────────────────────────── */

export interface WikiStore {
  // Pages
  savePage(
    input: SavePageInput,
    hooks?: SavePageHooks,
  ): Promise<SavePageResult>;
  savePageEmbeddings(
    embeddings: Array<{
      pageId: string;
      embedding: number[];
      embeddingModel: string;
    }>,
  ): Promise<{ updated: number }>;
  getPage(id: string): Promise<WikiPageRecord | null>;
  getPageBySlug(
    characterId: string,
    slug: string,
  ): Promise<WikiPageRecord | null>;
  getPageByWikiSlug(
    wikiId: string,
    slug: string,
  ): Promise<WikiPageRecord | null>;
  listPages(
    characterId: string,
    filter?: { type?: WikiPageType },
  ): Promise<WikiPageRecord[]>;
  listPagesForWiki(
    wikiId: string,
    filter?: { type?: WikiPageType },
  ): Promise<WikiPageRecord[]>;
  removePage(id: string): Promise<boolean>;
  /**
   * Vector-search pages by cosine similarity to the supplied query embedding.
   * Returns the top hits above `minSimilarity` (default 0.5), capped by
   * `topK` (default 5). The HNSW index on wiki_pages.embedding makes this
   * sub-10ms for hundreds of pages.
   */
  searchPagesByEmbedding(
    characterId: string,
    queryEmbedding: number[],
    options?: { topK?: number; minSimilarity?: number },
  ): Promise<
    Array<{ pageId: string; slug: string; title: string; similarity: number }>
  >;
  searchPagesByEmbeddingForWiki(
    wikiId: string,
    queryEmbedding: number[],
    options?: { topK?: number; minSimilarity?: number },
  ): Promise<
    Array<{ pageId: string; slug: string; title: string; similarity: number }>
  >;
  searchPagesByEmbeddingForWikis(
    wikiIds: string[],
    queryEmbedding: number[],
    options?: { topK?: number; minSimilarity?: number },
  ): Promise<
    Array<{ pageId: string; slug: string; title: string; similarity: number }>
  >;

  // Versions
  listPageVersions(pageId: string): Promise<WikiPageVersionRecord[]>;
  getPageVersion(
    pageId: string,
    version: number,
  ): Promise<WikiPageVersionRecord | null>;
  /**
   * All page versions written by a single ingestion run. Matches on
   * `author_kind = 'llm' AND author_id = runId`, which is how the
   * ingestion pipeline tags every snapshot it writes
   * (packages/wiki-ingest/src/pipeline.ts).
   */
  listPageVersionsByRun(runId: string): Promise<WikiPageVersionRecord[]>;
  /**
   * The version immediately before `version` for the same page, or null
   * if `version` is the first. Used as the "left side" of a diff.
   */
  getPriorPageVersion(
    pageId: string,
    version: number,
  ): Promise<WikiPageVersionRecord | null>;

  // Edges
  listOutgoing(pageId: string): Promise<WikiEdgeRecord[]>;
  listIncoming(pageId: string): Promise<WikiEdgeRecord[]>;
  listCharacterEdges(characterId: string): Promise<WikiEdgeRecord[]>;
  listWikiEdges(wikiId: string): Promise<WikiEdgeRecord[]>;
  /**
   * Reconcile edges for selected pages in a wiki using a complete wiki-level
   * slug index. Useful after parallel page writes, where early saves may
   * reference pages that did not exist yet.
   */
  reconcileEdgesForWikiPages(
    wikiId: string,
    pageIds: string[],
  ): Promise<{ added: number; removed: number }>;
  /**
   * Safety valve: wipe and rebuild every edge for a character, sourcing
   * edges from each page's current body + frontmatter + contradictions.
   */
  rebuildEdges(
    characterId: string,
  ): Promise<{ added: number; removed: number }>;

  /**
   * Persist cached 2D coordinates for the Knowledge view. Stamps
   * `layoutComputedAt` on every row written. Callers compute via
   * `computeKnowledgeLayout()` in the admin package. Missing page IDs in
   * the input are silently ignored (page may have been deleted between
   * compute and save).
   */
  saveLayout(
    characterId: string,
    points: Array<{ id: string; x: number; y: number }>,
  ): Promise<{ updated: number }>;
  saveLayoutForWiki(
    wikiId: string,
    points: Array<{ id: string; x: number; y: number }>,
  ): Promise<{ updated: number }>;

  // Sources
  createSource(input: CreateSourceInput): Promise<WikiSourceRecord>;
  getSource(id: string): Promise<WikiSourceRecord | null>;
  findSourceByHash(
    characterId: string,
    contentHash: string,
  ): Promise<WikiSourceRecord | null>;
  listSources(characterId: string): Promise<WikiSourceRecord[]>;
  listSourcesForWiki(wikiId: string): Promise<WikiSourceRecord[]>;
  removeSource(id: string): Promise<boolean>;
  /**
   * Delete a source and any pages whose *only* provenance was this source
   * (orphan cleanup). Pages that also reference other sources are kept —
   * they just lose their ref to this source via FK cascade. Edges cascade
   * off deleted pages. Ingestion-log rows referencing this source get their
   * `sourceId` nulled by FK `set null`.
   */
  purgeSource(id: string): Promise<{
    sourceRemoved: number;
    pagesRemoved: number;
    edgesRemoved: number;
  }>;
  /**
   * Read-only: counts what would be removed if `purgeSource(id)` ran now.
   * Used to power the confirm-modal's blast radius panel.
   */
  previewPurgeSource(id: string): Promise<{
    pagesRemoved: number;
    edgesRemoved: number;
  }>;

  // Source refs
  addSourceRefs(refs: CreateSourceRefInput[]): Promise<void>;
  clearSourceRefsForPage(pageId: string): Promise<void>;
  listSourceRefsForPage(pageId: string): Promise<WikiSourceRefRecord[]>;
  /** Every source ref for every page in this character — one JOIN, so cheap. */
  listSourceRefsForCharacter(
    characterId: string,
  ): Promise<WikiSourceRefRecord[]>;
  /** Every source ref for every page in this wiki — one JOIN, so cheap. */
  listSourceRefsForWiki(wikiId: string): Promise<WikiSourceRefRecord[]>;

  // Ingestion log
  startIngestion(input: StartIngestionInput): Promise<WikiIngestionLogRecord>;
  getIngestionRun(id: string): Promise<WikiIngestionLogRecord | null>;
  claimNextQueuedIngestion(
    workerId: string,
  ): Promise<WikiIngestionLogRecord | null>;
  touchIngestionRun(id: string, workerId: string): Promise<void>;
  finishIngestion(
    id: string,
    result: FinishIngestionInput,
  ): Promise<WikiIngestionLogRecord | null>;
  listIngestionRuns(
    characterId: string,
    limit?: number,
  ): Promise<WikiIngestionLogRecord[]>;
  listIngestionRunsForWiki(
    wikiId: string,
    limit?: number,
  ): Promise<WikiIngestionLogRecord[]>;
  appendIngestionEvent(
    runId: string,
    payload: unknown,
  ): Promise<WikiIngestionEventRecord>;
  listIngestionEvents(
    runId: string,
    options?: { afterSeq?: number; limit?: number },
  ): Promise<WikiIngestionEventRecord[]>;
  /**
   * Purge a single ingestion run: deletes the run row, and (if the run's
   * source is not used by another run) purges that source + orphan pages.
   */
  purgeIngestionRun(runId: string): Promise<{
    runRemoved: number;
    sourceRemoved: number;
    pagesRemoved: number;
    edgesRemoved: number;
  }>;

  /**
   * Wipe all ingested data for a character (pages, edges, sources, runs) while
   * keeping the character row itself. `wiki_page_versions` and
   * `wiki_source_refs` cascade off pages/sources automatically.
   */
  resetCharacterData(characterId: string): Promise<{
    pagesRemoved: number;
    edgesRemoved: number;
    sourcesRemoved: number;
    runsRemoved: number;
  }>;
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

    async savePage(input, hooks) {
      const db = requireDb();
      const scope = resolvePageScope(input);

      const normalized: NormalizedSavePageInput = {
        characterId: input.characterId ?? null,
        wikiId: input.wikiId ?? null,
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

      // The initial existence check is the only read in savePage. The
      // subsequent UPDATE/INSERT must not be retried (double-apply risk),
      // but the lookup is safe to retry on Neon's transient socket drops.
      const [existingRow] = await retryRead(() =>
        db
          .select()
          .from(wikiPagesTable)
          .where(
            and(scopeWhere(scope), eq(wikiPagesTable.slug, normalized.slug)),
          )
          .limit(1),
      );

      const now = new Date();
      let pageRow: typeof wikiPagesTable.$inferSelect;
      let created = false;
      let versionCreated = false;

      // If the caller wired an `embed` hook AND the textual content is about
      // to materially change (or this is a new page), compute an embedding
      // before the DB write so it lands in the same UPDATE/INSERT. Failures
      // are swallowed — a page without an embedding is still functional, it
      // just misses the wiki-curator's semantic-seed pass.
      const computeEmbedding = async (
        shouldEmbed: boolean,
      ): Promise<{
        embedding: number[];
        embeddingModel: string;
        embeddedAt: Date;
      } | null> => {
        if (!shouldEmbed || !hooks?.embed) return null;
        try {
          const vec = await hooks.embed(wikiEmbeddingSource(normalized));
          if (!vec) return null;
          return {
            embedding: vec,
            embeddingModel: hooks.embeddingModel ?? "unspecified",
            embeddedAt: now,
          };
        } catch (error) {
          console.error(
            "[wiki-store] embed hook failed; saving page without embedding",
            error,
          );
          return null;
        }
      };

      if (existingRow) {
        const existing = normalizePage(existingRow);
        const material = isMaterialChange(existing, normalized);
        const nextVersion = material ? existing.version + 1 : existing.version;
        const embeddingFields = await computeEmbedding(material);

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
            ...(embeddingFields ?? {}),
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
        const embeddingFields = await computeEmbedding(true);
        const [inserted] = await db
          .insert(wikiPagesTable)
          .values({
            characterId: normalized.characterId,
            wikiId: normalized.wikiId,
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
            ...(embeddingFields ?? {}),
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

      // Edge reconcile — read full slug→id index for this page's scope.
      const slugRows = await retryRead(() =>
        db
          .select({ id: wikiPagesTable.id, slug: wikiPagesTable.slug })
          .from(wikiPagesTable)
          .where(scopeWhere(scope)),
      );
      const slugToId = new Map(slugRows.map((r) => [r.slug, r.id]));

      const diff = await reconcileEdgesForPage(db, page, slugToId);

      // Layout recompute fires after the page write + edge reconcile when
      // the textual content materially changed (or the page is new). It's
      // a hook because the layout algorithm lives in the admin app — we
      // call it best-effort and swallow errors so a stale layout never
      // blocks the underlying save.
      if (
        (versionCreated || created) &&
        hooks?.recomputeWikiLayout &&
        normalized.wikiId
      ) {
        try {
          await hooks.recomputeWikiLayout(normalized.wikiId);
        } catch (error) {
          console.error(
            "[wiki-store] recomputeWikiLayout hook failed; layout left stale",
            error,
          );
        }
      } else if (
        (versionCreated || created) &&
        hooks?.recomputeLayout &&
        normalized.characterId
      ) {
        try {
          await hooks.recomputeLayout(normalized.characterId);
        } catch (error) {
          console.error(
            "[wiki-store] recomputeLayout hook failed; layout left stale",
            error,
          );
        }
      }

      return {
        page,
        created,
        versionCreated,
        edgesAdded: diff.added,
        edgesRemoved: diff.removed,
      };
    },

    async savePageEmbeddings(embeddings) {
      if (embeddings.length === 0) return { updated: 0 };
      const db = requireDb();
      const now = new Date();
      let updated = 0;
      for (const item of embeddings) {
        const rows = await db
          .update(wikiPagesTable)
          .set({
            embedding: item.embedding,
            embeddingModel: item.embeddingModel,
            embeddedAt: now,
            updatedAt: now,
          })
          .where(eq(wikiPagesTable.id, item.pageId))
          .returning({ id: wikiPagesTable.id });
        updated += rows.length;
      }
      return { updated };
    },

    async getPage(id) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiPagesTable)
          .where(eq(wikiPagesTable.id, id))
          .limit(1),
      );
      return row ? normalizePage(row) : null;
    },

    async getPageBySlug(characterId, slug) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiPagesTable)
          .where(
            and(
              eq(wikiPagesTable.characterId, characterId),
              eq(wikiPagesTable.slug, slug),
            ),
          )
          .limit(1),
      );
      return row ? normalizePage(row) : null;
    },

    async getPageByWikiSlug(wikiId, slug) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiPagesTable)
          .where(
            and(
              eq(wikiPagesTable.wikiId, wikiId),
              eq(wikiPagesTable.slug, slug),
            ),
          )
          .limit(1),
      );
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
      const rows = await retryRead(() =>
        db.select().from(wikiPagesTable).where(whereClause),
      );
      return rows
        .map(normalizePage)
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async listPagesForWiki(wikiId, filter) {
      const db = requireDb();
      const whereClause = filter?.type
        ? and(
            eq(wikiPagesTable.wikiId, wikiId),
            eq(wikiPagesTable.type, filter.type),
          )
        : eq(wikiPagesTable.wikiId, wikiId);
      const rows = await retryRead(() =>
        db.select().from(wikiPagesTable).where(whereClause),
      );
      return rows
        .map(normalizePage)
        .sort((a, b) => a.title.localeCompare(b.title));
    },

    async searchPagesByEmbedding(characterId, queryEmbedding, options) {
      const db = requireDb();
      const topK = options?.topK ?? 5;
      const minSimilarity = options?.minSimilarity ?? 0.5;
      // pgvector cosine distance is `<=>` (range 0..2 for normalized vectors).
      // similarity = 1 - distance. ORDER BY distance ASC + filter by similarity
      // floor in JS so the optimizer can use the HNSW index for the sort.
      const vectorLiteral = `[${queryEmbedding.join(",")}]`;
      const rows = await retryRead(() =>
        db.execute<{
          id: string;
          slug: string;
          title: string;
          similarity: number;
        }>(
          sql`
            SELECT id, slug, title,
                   1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
            FROM wiki_pages
            WHERE character_id = ${characterId} AND embedding IS NOT NULL
            ORDER BY embedding <=> ${vectorLiteral}::vector
            LIMIT ${topK}
          `,
        ),
      );
      // Drizzle's `execute` returns the driver-shaped rows (Neon: { rows: [...] }).
      // Normalize across the two shapes we see in this codebase.
      const list = (
        Array.isArray(rows) ? rows : ((rows as { rows: unknown[] }).rows ?? [])
      ) as Array<{
        id: string;
        slug: string;
        title: string;
        similarity: number | string;
      }>;
      return list
        .map((r) => ({
          pageId: r.id,
          slug: r.slug,
          title: r.title,
          similarity:
            typeof r.similarity === "string"
              ? Number(r.similarity)
              : r.similarity,
        }))
        .filter(
          (r) => Number.isFinite(r.similarity) && r.similarity >= minSimilarity,
        );
    },

    async searchPagesByEmbeddingForWiki(wikiId, queryEmbedding, options) {
      return this.searchPagesByEmbeddingForWikis(
        [wikiId],
        queryEmbedding,
        options,
      );
    },

    async searchPagesByEmbeddingForWikis(wikiIds, queryEmbedding, options) {
      if (wikiIds.length === 0) return [];
      const db = requireDb();
      const topK = options?.topK ?? 5;
      const minSimilarity = options?.minSimilarity ?? 0.5;
      const vectorLiteral = `[${queryEmbedding.join(",")}]`;
      const wikiIdValues = wikiIds.map((id) => sql`${id}`);
      const rows = await retryRead(() =>
        db.execute<{
          id: string;
          slug: string;
          title: string;
          similarity: number;
        }>(
          sql`
            SELECT id, slug, title,
                   1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
            FROM wiki_pages
            WHERE wiki_id IN (${sql.join(wikiIdValues, sql`, `)}) AND embedding IS NOT NULL
            ORDER BY embedding <=> ${vectorLiteral}::vector
            LIMIT ${topK}
          `,
        ),
      );
      const list = (
        Array.isArray(rows) ? rows : ((rows as { rows: unknown[] }).rows ?? [])
      ) as Array<{
        id: string;
        slug: string;
        title: string;
        similarity: number | string;
      }>;
      return list
        .map((r) => ({
          pageId: r.id,
          slug: r.slug,
          title: r.title,
          similarity:
            typeof r.similarity === "string"
              ? Number(r.similarity)
              : r.similarity,
        }))
        .filter(
          (r) => Number.isFinite(r.similarity) && r.similarity >= minSimilarity,
        );
    },

    async removePage(id) {
      const db = requireDb();
      const result = await db
        .delete(wikiPagesTable)
        .where(eq(wikiPagesTable.id, id))
        .returning();
      return result.length > 0;
    },

    /* ── Versions ────────────────────────────────────────── */

    async listPageVersions(pageId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiPageVersionsTable)
          .where(eq(wikiPageVersionsTable.pageId, pageId))
          .orderBy(desc(wikiPageVersionsTable.version)),
      );
      return rows.map(normalizeVersion);
    },

    async getPageVersion(pageId, version) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiPageVersionsTable)
          .where(
            and(
              eq(wikiPageVersionsTable.pageId, pageId),
              eq(wikiPageVersionsTable.version, version),
            ),
          )
          .limit(1),
      );
      return row ? normalizeVersion(row) : null;
    },

    async listPageVersionsByRun(runId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiPageVersionsTable)
          .where(
            and(
              eq(wikiPageVersionsTable.authorKind, "llm"),
              eq(wikiPageVersionsTable.authorId, runId),
            ),
          )
          .orderBy(desc(wikiPageVersionsTable.createdAt)),
      );
      return rows.map(normalizeVersion);
    },

    async getPriorPageVersion(pageId, version) {
      if (version <= 1) return null;
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiPageVersionsTable)
          .where(
            and(
              eq(wikiPageVersionsTable.pageId, pageId),
              lt(wikiPageVersionsTable.version, version),
            ),
          )
          .orderBy(desc(wikiPageVersionsTable.version))
          .limit(1),
      );
      return row ? normalizeVersion(row) : null;
    },

    /* ── Edges ───────────────────────────────────────────── */

    async listOutgoing(pageId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.fromPageId, pageId)),
      );
      return rows.map(normalizeEdge);
    },

    async listIncoming(pageId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.toPageId, pageId)),
      );
      return rows.map(normalizeEdge);
    },

    async listCharacterEdges(characterId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.characterId, characterId)),
      );
      return rows.map(normalizeEdge);
    },

    async listWikiEdges(wikiId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.wikiId, wikiId)),
      );
      return rows.map(normalizeEdge);
    },

    async reconcileEdgesForWikiPages(wikiId, pageIds) {
      if (pageIds.length === 0) return { added: 0, removed: 0 };
      const db = requireDb();
      const uniquePageIds = Array.from(new Set(pageIds));
      const [pageRows, slugRows] = await Promise.all([
        retryRead(() =>
          db
            .select()
            .from(wikiPagesTable)
            .where(
              and(
                eq(wikiPagesTable.wikiId, wikiId),
                inArray(wikiPagesTable.id, uniquePageIds),
              ),
            ),
        ),
        retryRead(() =>
          db
            .select({ id: wikiPagesTable.id, slug: wikiPagesTable.slug })
            .from(wikiPagesTable)
            .where(eq(wikiPagesTable.wikiId, wikiId)),
        ),
      ]);

      const slugToId = new Map(slugRows.map((r) => [r.slug, r.id]));
      let added = 0;
      let removed = 0;
      for (const page of pageRows.map(normalizePage)) {
        const diff = await reconcileEdgesForPage(db, page, slugToId);
        added += diff.added;
        removed += diff.removed;
      }

      return { added, removed };
    },

    async rebuildEdges(characterId) {
      const db = requireDb();

      // Snapshot current edge count (for the "removed" metric)
      const existingRows = await retryRead(() =>
        db
          .select({ id: wikiEdgesTable.id })
          .from(wikiEdgesTable)
          .where(eq(wikiEdgesTable.characterId, characterId)),
      );
      const existingCount = existingRows.length;

      // Wipe
      await db
        .delete(wikiEdgesTable)
        .where(eq(wikiEdgesTable.characterId, characterId));

      // Load all pages for this character
      const pageRows = await retryRead(() =>
        db
          .select()
          .from(wikiPagesTable)
          .where(eq(wikiPagesTable.characterId, characterId)),
      );
      const pages = pageRows.map(normalizePage);
      const slugToId = new Map(pages.map((p) => [p.slug, p.id]));

      let added = 0;
      for (const page of pages) {
        const diff = await reconcileEdgesForPage(db, page, slugToId);
        added += diff.added;
      }

      return { added, removed: existingCount };
    },

    async saveLayout(characterId, points) {
      if (points.length === 0) return { updated: 0 };
      const db = requireDb();
      // Bulk update via a VALUES row-set + UPDATE FROM. Single round-trip
      // regardless of N. Explicit ::text/::real casts so the unknown literal
      // types resolve cleanly for the join + assignment.
      const rows = points.map(
        (p) => sql`(${p.id}::text, ${p.x}::real, ${p.y}::real)`,
      );
      const result = await db.execute(sql`
        UPDATE wiki_pages
        SET layout_x = d.x, layout_y = d.y, layout_computed_at = NOW()
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS d(id, x, y)
        WHERE wiki_pages.id = d.id AND wiki_pages.character_id = ${characterId}
      `);
      return {
        updated: (result as { rowCount?: number }).rowCount ?? points.length,
      };
    },

    async saveLayoutForWiki(wikiId, points) {
      if (points.length === 0) return { updated: 0 };
      const db = requireDb();
      const rows = points.map(
        (p) => sql`(${p.id}::text, ${p.x}::real, ${p.y}::real)`,
      );
      const result = await db.execute(sql`
        UPDATE wiki_pages
        SET layout_x = d.x, layout_y = d.y, layout_computed_at = NOW()
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS d(id, x, y)
        WHERE wiki_pages.id = d.id AND wiki_pages.wiki_id = ${wikiId}
      `);
      return {
        updated: (result as { rowCount?: number }).rowCount ?? points.length,
      };
    },

    /* ── Sources ─────────────────────────────────────────── */

    async createSource(input) {
      if (!input.wikiId && !input.characterId) {
        throw new Error("createSource requires either wikiId or characterId");
      }
      const db = requireDb();
      const contentHash = await sha256Hex(input.content);
      const now = new Date();
      const [row] = await db
        .insert(wikiSourcesTable)
        .values({
          characterId: input.characterId ?? null,
          wikiId: input.wikiId ?? null,
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
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiSourcesTable)
          .where(eq(wikiSourcesTable.id, id))
          .limit(1),
      );
      return row ? normalizeSource(row) : null;
    },

    async findSourceByHash(characterId, contentHash) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiSourcesTable)
          .where(
            and(
              eq(wikiSourcesTable.characterId, characterId),
              eq(wikiSourcesTable.contentHash, contentHash),
            ),
          )
          .limit(1),
      );
      return row ? normalizeSource(row) : null;
    },

    async listSources(characterId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiSourcesTable)
          .where(eq(wikiSourcesTable.characterId, characterId))
          .orderBy(desc(wikiSourcesTable.createdAt)),
      );
      return rows.map(normalizeSource);
    },

    async listSourcesForWiki(wikiId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiSourcesTable)
          .where(eq(wikiSourcesTable.wikiId, wikiId))
          .orderBy(desc(wikiSourcesTable.createdAt)),
      );
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

    async purgeSource(id) {
      return purgeSourceImpl(id);
    },

    async previewPurgeSource(id) {
      return previewPurgeSourceImpl(id);
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
      await db
        .delete(wikiSourceRefsTable)
        .where(eq(wikiSourceRefsTable.pageId, pageId));
    },

    async listSourceRefsForPage(pageId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiSourceRefsTable)
          .where(eq(wikiSourceRefsTable.pageId, pageId))
          .orderBy(desc(wikiSourceRefsTable.createdAt)),
      );
      return rows.map(normalizeSourceRef);
    },

    async listSourceRefsForCharacter(characterId) {
      const db = requireDb();
      // JOIN wiki_source_refs → wiki_pages, filter by characterId. Single
      // round-trip instead of N calls to listSourceRefsForPage.
      const rows = await retryRead(() =>
        db
          .select({
            id: wikiSourceRefsTable.id,
            pageId: wikiSourceRefsTable.pageId,
            sourceId: wikiSourceRefsTable.sourceId,
            passage: wikiSourceRefsTable.passage,
            quote: wikiSourceRefsTable.quote,
            relevanceNote: wikiSourceRefsTable.relevanceNote,
            createdAt: wikiSourceRefsTable.createdAt,
          })
          .from(wikiSourceRefsTable)
          .innerJoin(
            wikiPagesTable,
            eq(wikiSourceRefsTable.pageId, wikiPagesTable.id),
          )
          .where(eq(wikiPagesTable.characterId, characterId))
          .orderBy(desc(wikiSourceRefsTable.createdAt)),
      );
      return rows.map((r) => ({
        id: r.id,
        pageId: r.pageId,
        sourceId: r.sourceId,
        passage: r.passage,
        quote: r.quote,
        relevanceNote: r.relevanceNote,
        createdAt: requireIso(r.createdAt),
      }));
    },

    async listSourceRefsForWiki(wikiId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select({
            id: wikiSourceRefsTable.id,
            pageId: wikiSourceRefsTable.pageId,
            sourceId: wikiSourceRefsTable.sourceId,
            passage: wikiSourceRefsTable.passage,
            quote: wikiSourceRefsTable.quote,
            relevanceNote: wikiSourceRefsTable.relevanceNote,
            createdAt: wikiSourceRefsTable.createdAt,
          })
          .from(wikiSourceRefsTable)
          .innerJoin(
            wikiPagesTable,
            eq(wikiSourceRefsTable.pageId, wikiPagesTable.id),
          )
          .where(eq(wikiPagesTable.wikiId, wikiId))
          .orderBy(desc(wikiSourceRefsTable.createdAt)),
      );
      return rows.map((r) => ({
        id: r.id,
        pageId: r.pageId,
        sourceId: r.sourceId,
        passage: r.passage,
        quote: r.quote,
        relevanceNote: r.relevanceNote,
        createdAt: requireIso(r.createdAt),
      }));
    },

    /* ── Ingestion log ───────────────────────────────────── */

    async startIngestion(input) {
      if (!input.wikiId && !input.characterId) {
        throw new Error("startIngestion requires either wikiId or characterId");
      }
      const db = requireDb();
      const [row] = await db
        .insert(wikiIngestionLogTable)
        .values({
          characterId: input.characterId ?? null,
          wikiId: input.wikiId ?? null,
          sourceId: input.sourceId ?? null,
          startedAt: new Date(),
          status: input.status ?? "running",
          model: input.model ?? null,
          promptHash: input.promptHash ?? null,
          notes: input.notes ?? null,
          heartbeatAt: new Date(),
        })
        .returning();
      return normalizeIngestion(row);
    },

    async getIngestionRun(id) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(wikiIngestionLogTable)
          .where(eq(wikiIngestionLogTable.id, id))
          .limit(1),
      );
      return row ? normalizeIngestion(row) : null;
    },

    async claimNextQueuedIngestion(workerId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db.execute<typeof wikiIngestionLogTable.$inferSelect>(sql`
          WITH candidate AS (
            SELECT id
            FROM wiki_ingestion_log
            WHERE status = 'queued'
               OR (
                 status = 'running'
                 AND heartbeat_at IS NOT NULL
                 AND heartbeat_at < NOW() - INTERVAL '10 minutes'
               )
            ORDER BY started_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE wiki_ingestion_log l
          SET status = 'running',
              worker_id = ${workerId},
              claimed_at = NOW(),
              heartbeat_at = NOW(),
              error_message = NULL
          FROM candidate
          WHERE l.id = candidate.id
          RETURNING
            l.id,
            l.character_id AS "characterId",
            l.wiki_id AS "wikiId",
            l.source_id AS "sourceId",
            l.started_at AS "startedAt",
            l.finished_at AS "finishedAt",
            l.status,
            l.model,
            l.prompt_hash AS "promptHash",
            l.pages_created AS "pagesCreated",
            l.pages_updated AS "pagesUpdated",
            l.edges_added AS "edgesAdded",
            l.contradictions_found AS "contradictionsFound",
            l.tokens_used AS "tokensUsed",
            l.error_message AS "errorMessage",
            l.notes,
            l.worker_id AS "workerId",
            l.claimed_at AS "claimedAt",
            l.heartbeat_at AS "heartbeatAt"
        `),
      );
      const list = (
        Array.isArray(rows) ? rows : ((rows as { rows: unknown[] }).rows ?? [])
      ) as Array<typeof wikiIngestionLogTable.$inferSelect>;
      return list[0] ? normalizeIngestion(list[0]) : null;
    },

    async touchIngestionRun(id, workerId) {
      const db = requireDb();
      await db
        .update(wikiIngestionLogTable)
        .set({ heartbeatAt: new Date() })
        .where(
          and(
            eq(wikiIngestionLogTable.id, id),
            eq(wikiIngestionLogTable.workerId, workerId),
          ),
        );
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
          heartbeatAt: new Date(),
        })
        .where(eq(wikiIngestionLogTable.id, id))
        .returning();
      return row ? normalizeIngestion(row) : null;
    },

    async listIngestionRuns(characterId, limit = 50) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiIngestionLogTable)
          .where(eq(wikiIngestionLogTable.characterId, characterId))
          .orderBy(desc(wikiIngestionLogTable.startedAt))
          .limit(limit),
      );
      return rows.map(normalizeIngestion);
    },

    async listIngestionRunsForWiki(wikiId, limit = 50) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiIngestionLogTable)
          .where(eq(wikiIngestionLogTable.wikiId, wikiId))
          .orderBy(desc(wikiIngestionLogTable.startedAt))
          .limit(limit),
      );
      return rows.map(normalizeIngestion);
    },

    async appendIngestionEvent(runId, payload) {
      const db = requireDb();
      const id = crypto.randomUUID();
      const eventType =
        typeof payload === "object" &&
        payload !== null &&
        "type" in payload &&
        typeof (payload as { type?: unknown }).type === "string"
          ? (payload as { type: string }).type
          : "event";

      const rows = await db.execute<
        typeof wikiIngestionEventsTable.$inferSelect
      >(sql`
        INSERT INTO wiki_ingestion_events (id, run_id, seq, type, payload, created_at)
        VALUES (
          ${id},
          ${runId},
          COALESCE((SELECT MAX(seq) + 1 FROM wiki_ingestion_events WHERE run_id = ${runId}), 1),
          ${eventType},
          ${JSON.stringify(payload)}::jsonb,
          NOW()
        )
        RETURNING
          id,
          run_id AS "runId",
          seq,
          type,
          payload,
          created_at AS "createdAt"
      `);
      const list = (
        Array.isArray(rows) ? rows : ((rows as { rows: unknown[] }).rows ?? [])
      ) as Array<typeof wikiIngestionEventsTable.$inferSelect>;
      return normalizeIngestionEvent(list[0]);
    },

    async listIngestionEvents(runId, options) {
      const db = requireDb();
      const afterSeq = options?.afterSeq ?? 0;
      const limit = options?.limit ?? 500;
      const rows = await retryRead(() =>
        db
          .select()
          .from(wikiIngestionEventsTable)
          .where(
            and(
              eq(wikiIngestionEventsTable.runId, runId),
              sql`${wikiIngestionEventsTable.seq} > ${afterSeq}`,
            ),
          )
          .orderBy(wikiIngestionEventsTable.seq)
          .limit(limit),
      );
      return rows.map(normalizeIngestionEvent);
    },

    async purgeIngestionRun(runId) {
      const db = requireDb();
      const [run] = await retryRead(() =>
        db
          .select()
          .from(wikiIngestionLogTable)
          .where(eq(wikiIngestionLogTable.id, runId))
          .limit(1),
      );
      if (!run) {
        return {
          runRemoved: 0,
          sourceRemoved: 0,
          pagesRemoved: 0,
          edgesRemoved: 0,
        };
      }

      let purge = { sourceRemoved: 0, pagesRemoved: 0, edgesRemoved: 0 };
      const sourceId = run.sourceId;
      if (sourceId) {
        // Keep the source if other runs still reference it — those runs would
        // otherwise turn into "(deleted source)" rows. Purging is only safe
        // when this run is the source's sole owner.
        const otherRuns = await retryRead(() =>
          db
            .select({ id: wikiIngestionLogTable.id })
            .from(wikiIngestionLogTable)
            .where(eq(wikiIngestionLogTable.sourceId, sourceId)),
        );
        const hasOtherOwner = otherRuns.some((r) => r.id !== runId);
        if (!hasOtherOwner) {
          purge = await purgeSourceImpl(sourceId);
        }
      }

      await db
        .delete(wikiIngestionLogTable)
        .where(eq(wikiIngestionLogTable.id, runId));
      return { runRemoved: 1, ...purge };
    },

    async resetCharacterData(characterId) {
      const db = requireDb();
      const [edges, pages, sources, runs] = await Promise.all([
        db
          .delete(wikiEdgesTable)
          .where(eq(wikiEdgesTable.characterId, characterId))
          .returning({ id: wikiEdgesTable.id }),
        db
          .delete(wikiPagesTable)
          .where(eq(wikiPagesTable.characterId, characterId))
          .returning({ id: wikiPagesTable.id }),
        db
          .delete(wikiSourcesTable)
          .where(eq(wikiSourcesTable.characterId, characterId))
          .returning({ id: wikiSourcesTable.id }),
        db
          .delete(wikiIngestionLogTable)
          .where(eq(wikiIngestionLogTable.characterId, characterId))
          .returning({ id: wikiIngestionLogTable.id }),
      ]);
      return {
        pagesRemoved: pages.length,
        edgesRemoved: edges.length,
        sourcesRemoved: sources.length,
        runsRemoved: runs.length,
      };
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────── */

let _store: WikiStore | null = null;

export function getWikiStore(): WikiStore {
  if (!_store) _store = neonStore();
  return _store;
}
