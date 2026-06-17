import type { WikiEdgeRecord, WikiPageRecord } from "./wiki-types";

/**
 * In-memory per-wiki cache for the static knowledge graph (pages + edges) the
 * curator loads on every voice turn. Re-fetching a character's ~95 pages /
 * ~900 edges from Postgres per turn was ~460ms of pure plumbing (confirmed via
 * Sonar: server.curator 577ms → 117ms with this cache); the graph only changes
 * when a wiki is edited.
 *
 * Correctness model:
 *  - Explicit invalidation on every page/edge write is the source of truth
 *    (`invalidateWikiGraphCache`, called from the wiki-store write paths).
 *  - A TTL backstop self-heals any write path we miss, bounding staleness.
 *  - In-process only — fine for the single voice-server pipeline today; a
 *    multi-instance deploy needs shared invalidation (Redis/pubsub), since a
 *    write on one instance won't evict another instance's cache.
 *  - Kill switch: set WIKI_GRAPH_CACHE=0 to disable entirely (reads go direct).
 */

type Entry<T> = { value: T; loadedAt: number };

/** Backstop only; explicit invalidation is the primary freshness mechanism. */
const TTL_MS = 5 * 60_000;

const pageCache = new Map<string, Entry<WikiPageRecord[]>>();
const edgeCache = new Map<string, Entry<WikiEdgeRecord[]>>();

function enabled(): boolean {
  return process.env.WIKI_GRAPH_CACHE !== "0";
}

function fresh<T>(entry: Entry<T> | undefined): entry is Entry<T> {
  return entry !== undefined && Date.now() - entry.loadedAt < TTL_MS;
}

async function getOrLoad<T>(
  cache: Map<string, Entry<T>>,
  wikiId: string,
  load: () => Promise<T>,
): Promise<T> {
  if (!enabled()) return load();
  const hit = cache.get(wikiId);
  if (fresh(hit)) return hit.value;
  const value = await load();
  cache.set(wikiId, { value, loadedAt: Date.now() });
  return value;
}

/** Full per-wiki page list (no type filter), read-through cached. */
export function cachedPagesForWiki(
  wikiId: string,
  load: () => Promise<WikiPageRecord[]>,
): Promise<WikiPageRecord[]> {
  return getOrLoad(pageCache, wikiId, load);
}

/** Per-wiki edge list, read-through cached. */
export function cachedEdgesForWiki(
  wikiId: string,
  load: () => Promise<WikiEdgeRecord[]>,
): Promise<WikiEdgeRecord[]> {
  return getOrLoad(edgeCache, wikiId, load);
}

/**
 * Drop cached graph data. Pass a `wikiId` to evict one wiki; omit to clear all
 * (the safe default for writes whose affected wiki isn't cheaply known). Call
 * from every path that mutates wiki pages or edges.
 */
export function invalidateWikiGraphCache(wikiId?: string): void {
  if (wikiId === undefined) {
    pageCache.clear();
    edgeCache.clear();
    return;
  }
  pageCache.delete(wikiId);
  edgeCache.delete(wikiId);
}
