import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/evals/suites
 *
 * Lists every published probe suite for this character (all versions of
 * all slugs). Read-only for v1 — authoring still happens in TS, the
 * seed script publishes the active version. The page uses this to fill
 * the suite picker in the "Launch new eval" right rail.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const suites = await getEvalStore().listSuites(id);
  // Don't ship the full probes jsonb in the list response — it can be
  // several KB per suite. The page renders id / version / probe-count
  // for picker purposes; full probe definitions are fetched only when
  // an author opens a specific suite.
  const slim = suites.map((s) => ({
    id: s.id,
    slug: s.slug,
    version: s.version,
    probeCount: (s.probes as unknown[]).length,
    notes: s.notes,
    releaseNotes: s.releaseNotes,
    publishedAt: s.publishedAt,
    forkedFromId: s.forkedFromId,
    createdAt: s.createdAt,
  }));
  return NextResponse.json({ suites: slim });
}
