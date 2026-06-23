import { NextRequest } from "next/server";
import { getWikiStore, getWikisStore } from "@odyssey/db";
import { parseSourceMetadataFilters } from "@/lib/source-metadata-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) {
    return jsonError(404, "wiki not found");
  }

  const filters = parseSourceMetadataFilters(req.nextUrl.searchParams);
  const sources = await getWikiStore().listSourcesForWiki(wiki.id, filters);

  return Response.json(
    {
      wikiId: wiki.id,
      filters,
      sources,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}
