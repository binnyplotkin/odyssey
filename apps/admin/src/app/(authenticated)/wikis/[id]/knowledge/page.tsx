import { notFound } from "next/navigation";
import { getWikiStore, getWikisStore, type WikiPageRecord } from "@odyssey/db";
import {
  computeKnowledgeLayout,
  type LayoutEdge,
  type LayoutInput,
  type LayoutPoint,
} from "@/lib/kg-layout";
import { WikiKnowledgeView } from "./wiki-knowledge-view";

export const dynamic = "force-dynamic";

function isDegenerate(pages: WikiPageRecord[]): boolean {
  if (pages.length < 2) return false;
  const firstX = pages[0].layoutX!;
  const firstY = pages[0].layoutY!;
  for (let i = 1; i < pages.length; i++) {
    if (Math.abs(pages[i].layoutX! - firstX) > 1e-5) return false;
    if (Math.abs(pages[i].layoutY! - firstY) > 1e-5) return false;
  }
  return true;
}

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ focus?: string }>;

export default async function KnowledgeTab({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { focus } = await searchParams;

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) notFound();
  const routeBase = `/wikis/${wiki.id}`;

  const store = getWikiStore();
  const [pages, edges, sources, sourceRefs] = await Promise.all([
    store.listPagesForWiki(wiki.id),
    store.listWikiEdges(wiki.id),
    store.listSourcesForWiki(wiki.id),
    store.listSourceRefsForWiki(wiki.id),
  ]);

  // Join source refs to their parent source so the panel can show titles
  // + kinds without a second round-trip.
  const sourceById = new Map(sources.map((s) => [s.id, s] as const));
  const refsByPageId = new Map<
    string,
    Array<{
      refId: string;
      sourceId: string;
      title: string;
      kind: string;
      passage: string | null;
      quote: string | null;
      relevanceNote: string | null;
    }>
  >();
  for (const r of sourceRefs) {
    const src = sourceById.get(r.sourceId);
    if (!src) continue;
    const list = refsByPageId.get(r.pageId) ?? [];
    list.push({
      refId: r.id,
      sourceId: r.sourceId,
      title: src.title,
      kind: src.kind,
      passage: r.passage,
      quote: r.quote,
      relevanceNote: r.relevanceNote,
    });
    refsByPageId.set(r.pageId, list);
  }

  const layoutInputs: LayoutInput[] = pages.map((p) => ({
    id: p.id,
    slug: p.slug,
    embedding: p.embedding,
    type: p.type,
    seed:
      p.layoutX != null && p.layoutY != null
        ? { x: p.layoutX, y: p.layoutY }
        : null,
  }));

  const layoutEdges: LayoutEdge[] = edges.map((e) => ({
    fromId: e.fromPageId,
    toId: e.toPageId,
    kind: e.kind,
    strength: e.strength,
  }));

  // Use the DB cache when it's fresh and non-degenerate; otherwise
  // recompute and persist so subsequent loads stay snappy.
  const allCached =
    pages.length > 0 &&
    pages.every((p) => p.layoutX != null && p.layoutY != null);
  const cachedDegenerate = allCached && pages.length > 1 && isDegenerate(pages);

  let layout: LayoutPoint[];
  if (allCached && !cachedDegenerate) {
    layout = pages.map((p) => ({ id: p.id, x: p.layoutX!, y: p.layoutY! }));
  } else {
    layout = computeKnowledgeLayout(layoutInputs, layoutEdges);
    if (layout.length > 0) {
      await store.saveLayoutForWiki(wiki.id, layout);
    }
  }

  const embeddedCount = pages.reduce((n, p) => n + (p.embedding ? 1 : 0), 0);

  return (
    <WikiKnowledgeView
      wikiId={id}
      pages={pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        type: p.type,
        title: p.title,
        summary: p.summary,
        body: p.body,
        frontmatter: p.frontmatter as Record<string, unknown>,
        confidence: p.confidence,
        timeIndex: p.timeIndex,
        perspective: p.perspective,
        contradictions: p.contradictions,
        knowsFuture: p.knowsFuture,
        sources: refsByPageId.get(p.id) ?? [],
        updatedAt: p.updatedAt,
      }))}
      edges={edges.map((e) => ({
        fromPageId: e.fromPageId,
        toPageId: e.toPageId,
        kind: e.kind,
        strength: e.strength,
      }))}
      layout={layout}
      embeddedCount={embeddedCount}
      totalCount={pages.length}
      initialFocusSlug={focus ?? null}
      routeBase={routeBase}
    />
  );
}
