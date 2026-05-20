import { NextResponse } from "next/server";
import { getWikiStore, getWikisStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/wiki/[id]/run-diff?run=<runId>&page=<pageId>
 *
 * Returns the page version produced by `runId` for `pageId`, plus the
 * version immediately before it (or null if this run created the page).
 * The drawer skeleton uses this to drive the chrome and placeholder
 * sections; the field-level diff renderer is wired in a follow-up.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: wikiId } = await params;
  const url = new URL(request.url);
  const runId = url.searchParams.get("run");
  const pageId = url.searchParams.get("page");

  if (!runId || !pageId) {
    return NextResponse.json(
      { error: "run and page query params are required" },
      { status: 400 },
    );
  }

  const wiki = await getWikisStore().getWikiById(wikiId);
  if (!wiki) {
    return NextResponse.json({ error: "wiki not found" }, { status: 404 });
  }

  const store = getWikiStore();
  const versionsForRun = await store.listPageVersionsByRun(runId);
  const current = versionsForRun.find((v) => v.pageId === pageId) ?? null;

  if (!current) {
    return NextResponse.json({ error: "no version for that page in this run" }, {
      status: 404,
    });
  }

  const prior = await store.getPriorPageVersion(pageId, current.version);
  const page = await store.getPage(pageId);

  return NextResponse.json({
    page,
    current,
    prior,
    isNew: prior === null,
  });
}
