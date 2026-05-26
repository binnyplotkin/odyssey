import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type ForkDraftInput } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/evals/suites/:suiteId/fork
 *
 * Body: { version?: string }   (default = source.version + 0.1.0)
 *
 * Forks a published suite into a new editable draft. The partial unique
 * index on (character_id, slug) WHERE published_at IS NULL blocks two
 * drafts for the same slug — the UI should send the user to the existing
 * draft instead of forking a second one.
 *
 * Returns the new draft record. The UI immediately navigates to it.
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

  const source = await getEvalStore().getSuite(suiteId);
  if (!source || source.characterId !== id) {
    return NextResponse.json({ error: "suite not found" }, { status: 404 });
  }
  if (!source.publishedAt) {
    return NextResponse.json(
      { error: "cannot fork from an unpublished draft — finish or discard the existing draft first" },
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
    const draftInput: ForkDraftInput = { sourceId: suiteId };
    if (explicitVersion) draftInput.version = explicitVersion;
    const draft = await getEvalStore().forkDraft(draftInput);
    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "a draft for X already exists" → 409
    const status = msg.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
