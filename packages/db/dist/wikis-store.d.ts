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
import type { CharacterKnowledgeBindingRecord, CreateBindingInput, CreateWikiInput, UpdateBindingInput, UpdateWikiInput, WikiPageType, WikiRecord } from "./wiki-types";
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
export type WikiSummary = WikiRecord & {
    pageCount: number;
    edgeCount: number;
    sourceCount: number;
    ingestionCount: number;
    /** Number of characters bound to this wiki (any priority, active or not). */
    characterCount: number;
};
export interface WikisStore {
    listWikis(): Promise<WikiRecord[]>;
    listWikiSummaries(): Promise<WikiSummary[]>;
    getWikiById(id: string): Promise<WikiRecord | null>;
    getWikiBySlug(slug: string): Promise<WikiRecord | null>;
    createWiki(input: CreateWikiInput): Promise<WikiRecord>;
    updateWiki(id: string, input: UpdateWikiInput): Promise<WikiRecord | null>;
    deleteWiki(id: string): Promise<boolean>;
    listBindingsForCharacter(characterId: string): Promise<CharacterKnowledgeBindingRecord[]>;
    listBindingsForWiki(wikiId: string): Promise<CharacterKnowledgeBindingRecord[]>;
    getBinding(characterId: string, wikiId: string): Promise<CharacterKnowledgeBindingRecord | null>;
    createBinding(input: CreateBindingInput): Promise<CharacterKnowledgeBindingRecord>;
    updateBinding(id: string, input: UpdateBindingInput): Promise<CharacterKnowledgeBindingRecord | null>;
    deleteBinding(id: string): Promise<boolean>;
    /**
     * Convenience: list the wiki records bound to a character, ordered by
     * priority (primary → secondary → reference) then createdAt. Includes
     * inactive bindings; filter callers do their own pass.
     */
    listWikisForCharacter(characterId: string): Promise<Array<WikiRecord & {
        binding: CharacterKnowledgeBindingRecord;
    }>>;
    listPagesForWiki(wikiId: string): Promise<WikiPageSummary[]>;
    listSourcesForWiki(wikiId: string): Promise<WikiSourceSummary[]>;
    listIngestionsForWiki(wikiId: string, limit?: number): Promise<WikiIngestionSummary[]>;
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
    getIconDataForWiki(wikiId: string, limit?: number): Promise<KnowledgeGraphData>;
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
    edges: Array<{
        from: string;
        to: string;
        strength: number;
    }>;
};
export declare function getWikisStore(): WikisStore;
//# sourceMappingURL=wikis-store.d.ts.map