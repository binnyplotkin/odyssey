import { getWikisStore, getWikiStore } from "@odyssey/db";
import { resolveWikiWithPrimaryCharacter } from "@/lib/wiki-route";
import { IconTestView } from "./icon-test-view";

const WIKI_ID = "9b97221d-b08e-49d2-bd1d-86d63fd1ec35";

export const dynamic = "force-dynamic";

export default async function IconsTestPage() {
  const wikis = getWikisStore();
  const wiki = await wikis.getWikiById(WIKI_ID);
  if (!wiki) {
    return (
      <div style={{ padding: "var(--space-32)", color: "#FFFFFF8C" }}>
        Wiki {WIKI_ID} not found.
      </div>
    );
  }

  const { character } = await resolveWikiWithPrimaryCharacter(WIKI_ID);
  const store = getWikiStore();

  const [iconData, pages, edges] = await Promise.all([
    wikis.getIconDataForWiki(WIKI_ID),
    store.listPages(character.id),
    store.listCharacterEdges(character.id),
  ]);

  // Type histogram + dominant type (used by procedural / layered variants).
  const typeCounts: Record<string, number> = {};
  for (const p of pages) typeCounts[p.type] = (typeCounts[p.type] ?? 0) + 1;
  const dominantType =
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "entity";

  // Degree distribution per page id.
  const degree: Record<string, number> = {};
  for (const e of edges) {
    degree[e.fromPageId] = (degree[e.fromPageId] ?? 0) + 1;
    degree[e.toPageId] = (degree[e.toPageId] ?? 0) + 1;
  }

  return (
    <IconTestView
      wikiId={WIKI_ID}
      wikiTitle={wiki.title}
      iconData={iconData}
      stats={{
        nodeCount: pages.length,
        edgeCount: edges.length,
        typeCounts,
        dominantType,
        degreeValues: Object.values(degree),
      }}
    />
  );
}
