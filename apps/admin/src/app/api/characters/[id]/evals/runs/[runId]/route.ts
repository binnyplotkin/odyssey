import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/evals/runs/:runId
 *
 * Full run detail — summary + every probe result (response, scores,
 * judge rationale, mechanical-check failures). Powers the expanded
 * run card on the Evals page.
 *
 * 404 if the runId doesn't exist or belongs to a different character
 * (we explicitly check character match to prevent cross-character peek).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const run = await getEvalStore().getRunWithProbes(runId);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  // Defense against URL-tampering: the runId must belong to the character
  // in the URL. Otherwise a logged-in admin could read another character's
  // runs by guessing/peeking ids.
  if (run.characterId !== id) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  return NextResponse.json({ run });
}
