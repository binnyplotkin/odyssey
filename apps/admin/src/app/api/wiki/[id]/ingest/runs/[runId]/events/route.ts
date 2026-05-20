import { NextRequest } from "next/server";
import { getWikiStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await ctx.params;
  const afterRaw = req.nextUrl.searchParams.get("after");
  const afterSeq = afterRaw ? Number(afterRaw) : 0;
  if (!Number.isFinite(afterSeq) || afterSeq < 0) {
    return jsonError(400, "invalid after cursor");
  }

  const wiki = getWikiStore();
  const run = await wiki.getIngestionRun(runId);
  if (!run || run.wikiId !== id) return jsonError(404, "run not found");

  const events = await wiki.listIngestionEvents(runId, {
    afterSeq,
    limit: 500,
  });

  return Response.json(
    {
      run,
      events,
      latestSeq: events.at(-1)?.seq ?? afterSeq,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
