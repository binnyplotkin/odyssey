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
import type { CreateSourceInput, CreateSourceRefInput, FinishIngestionInput, SavePageHooks, SavePageInput, SavePageResult, StartIngestionInput, WikiEdgeRecord, WikiIngestionEventRecord, WikiIngestionLogRecord, WikiPageRecord, WikiPageType, WikiPageVersionRecord, WikiSourceRecord, WikiSourceRefRecord } from "./wiki-types";
/** Source text for embedding a page. Single function so backfill, savePage,
 * and any future re-embed flow always agree on what gets vectorized. */
export declare function wikiEmbeddingSource(input: {
    title: string;
    summary?: string | null;
    body?: string;
}): string;
export interface WikiStore {
    savePage(input: SavePageInput, hooks?: SavePageHooks): Promise<SavePageResult>;
    savePageEmbeddings(embeddings: Array<{
        pageId: string;
        embedding: number[];
        embeddingModel: string;
    }>): Promise<{
        updated: number;
    }>;
    getPage(id: string): Promise<WikiPageRecord | null>;
    getPageBySlug(characterId: string, slug: string): Promise<WikiPageRecord | null>;
    getPageByWikiSlug(wikiId: string, slug: string): Promise<WikiPageRecord | null>;
    listPages(characterId: string, filter?: {
        type?: WikiPageType;
    }): Promise<WikiPageRecord[]>;
    listPagesForWiki(wikiId: string, filter?: {
        type?: WikiPageType;
    }): Promise<WikiPageRecord[]>;
    removePage(id: string): Promise<boolean>;
    /**
     * Vector-search pages by cosine similarity to the supplied query embedding.
     * Returns the top hits above `minSimilarity` (default 0.5), capped by
     * `topK` (default 5). The HNSW index on wiki_pages.embedding makes this
     * sub-10ms for hundreds of pages.
     */
    searchPagesByEmbedding(characterId: string, queryEmbedding: number[], options?: {
        topK?: number;
        minSimilarity?: number;
    }): Promise<Array<{
        pageId: string;
        slug: string;
        title: string;
        similarity: number;
    }>>;
    searchPagesByEmbeddingForWiki(wikiId: string, queryEmbedding: number[], options?: {
        topK?: number;
        minSimilarity?: number;
    }): Promise<Array<{
        pageId: string;
        slug: string;
        title: string;
        similarity: number;
    }>>;
    searchPagesByEmbeddingForWikis(wikiIds: string[], queryEmbedding: number[], options?: {
        topK?: number;
        minSimilarity?: number;
    }): Promise<Array<{
        pageId: string;
        slug: string;
        title: string;
        similarity: number;
    }>>;
    listPageVersions(pageId: string): Promise<WikiPageVersionRecord[]>;
    getPageVersion(pageId: string, version: number): Promise<WikiPageVersionRecord | null>;
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
    getPriorPageVersion(pageId: string, version: number): Promise<WikiPageVersionRecord | null>;
    listOutgoing(pageId: string): Promise<WikiEdgeRecord[]>;
    listIncoming(pageId: string): Promise<WikiEdgeRecord[]>;
    listCharacterEdges(characterId: string): Promise<WikiEdgeRecord[]>;
    listWikiEdges(wikiId: string): Promise<WikiEdgeRecord[]>;
    /**
     * Reconcile edges for selected pages in a wiki using a complete wiki-level
     * slug index. Useful after parallel page writes, where early saves may
     * reference pages that did not exist yet.
     */
    reconcileEdgesForWikiPages(wikiId: string, pageIds: string[]): Promise<{
        added: number;
        removed: number;
    }>;
    /**
     * Safety valve: wipe and rebuild every edge for a character, sourcing
     * edges from each page's current body + frontmatter + contradictions.
     */
    rebuildEdges(characterId: string): Promise<{
        added: number;
        removed: number;
    }>;
    /**
     * Persist cached 2D coordinates for the Knowledge view. Stamps
     * `layoutComputedAt` on every row written. Callers compute via
     * `computeKnowledgeLayout()` in the admin package. Missing page IDs in
     * the input are silently ignored (page may have been deleted between
     * compute and save).
     */
    saveLayout(characterId: string, points: Array<{
        id: string;
        x: number;
        y: number;
    }>): Promise<{
        updated: number;
    }>;
    saveLayoutForWiki(wikiId: string, points: Array<{
        id: string;
        x: number;
        y: number;
    }>): Promise<{
        updated: number;
    }>;
    createSource(input: CreateSourceInput): Promise<WikiSourceRecord>;
    getSource(id: string): Promise<WikiSourceRecord | null>;
    findSourceByHash(characterId: string, contentHash: string): Promise<WikiSourceRecord | null>;
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
    addSourceRefs(refs: CreateSourceRefInput[]): Promise<void>;
    clearSourceRefsForPage(pageId: string): Promise<void>;
    listSourceRefsForPage(pageId: string): Promise<WikiSourceRefRecord[]>;
    /** Every source ref for every page in this character — one JOIN, so cheap. */
    listSourceRefsForCharacter(characterId: string): Promise<WikiSourceRefRecord[]>;
    /** Every source ref for every page in this wiki — one JOIN, so cheap. */
    listSourceRefsForWiki(wikiId: string): Promise<WikiSourceRefRecord[]>;
    startIngestion(input: StartIngestionInput): Promise<WikiIngestionLogRecord>;
    getIngestionRun(id: string): Promise<WikiIngestionLogRecord | null>;
    claimNextQueuedIngestion(workerId: string): Promise<WikiIngestionLogRecord | null>;
    touchIngestionRun(id: string, workerId: string): Promise<void>;
    finishIngestion(id: string, result: FinishIngestionInput): Promise<WikiIngestionLogRecord | null>;
    listIngestionRuns(characterId: string, limit?: number): Promise<WikiIngestionLogRecord[]>;
    listIngestionRunsForWiki(wikiId: string, limit?: number): Promise<WikiIngestionLogRecord[]>;
    appendIngestionEvent(runId: string, payload: unknown): Promise<WikiIngestionEventRecord>;
    listIngestionEvents(runId: string, options?: {
        afterSeq?: number;
        limit?: number;
    }): Promise<WikiIngestionEventRecord[]>;
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
export declare function getWikiStore(): WikiStore;
//# sourceMappingURL=wiki-store.d.ts.map