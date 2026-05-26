import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/evals/suites/:suiteId/publish
 *
 * Body: { version?: string }   (defaults to whatever version the draft
 *                               carries; UI can override during publish)
 *
 * Flips publishedAt = now() on the draft and locks the version. After
 * this, the row is immutable — future edits require forking a new draft.
 *
 * Returns 200 with the published record, OR 409 if the version conflicts
 * with an existing published row.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; suiteId: string }> },
) {
  const { id, suiteId } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const draft = await getEvalStore().getSuite(suiteId);
  if (!draft || draft.characterId !== id) {
    return NextResponse.json({ error: "suite not found" }, { status: 404 });
  }
  if (draft.publishedAt) {
    return NextResponse.json(
      { error: `suite is already published (${draft.publishedAt})` },
      { status: 409 },
    );
  }

  let body: { version?: unknown } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const explicitVersion = typeof body.version === "string" ? body.version : undefined;

  try {
    const published = await getEvalStore().publishDraft(
      suiteId,
      explicitVersion ? { version: explicitVersion } : undefined,
    );
    return NextResponse.json({ suite: published });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("already exists") || msg.includes("already published") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
