import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    — read full suite (any state)
 * PATCH  — mutate a draft (probes / releaseNotes). Rejects if published.
 * DELETE — discard a draft. Rejects if published.
 */

async function loadOrNotFound(id: string, suiteId: string) {
  const character = await getCharacterStore().getById(id);
  if (!character) {
    return { error: NextResponse.json({ error: "character not found" }, { status: 404 }) };
  }
  const suite = await getEvalStore().getSuite(suiteId);
  if (!suite || suite.characterId !== id) {
    // Cross-character peek defense — same pattern as runs/[runId] + sweeps/[sweepId].
    return { error: NextResponse.json({ error: "suite not found" }, { status: 404 }) };
  }
  return { suite };
}

/**
 * GET /api/characters/:id/evals/suites/:suiteId
 *
 * Full suite detail — includes the entire probes jsonb (input, rubric,
 * expectations, passThreshold for every probe). Counterpart to the slim
 * list response from `GET /suites`; the page lazy-loads this only when an
 * author drills into a specific suite, so we don't pay the bandwidth on
 * every page render.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; suiteId: string }> },
) {
  const { id, suiteId } = await ctx.params;
  const res = await loadOrNotFound(id, suiteId);
  if ("error" in res) return res.error;
  return NextResponse.json({ suite: res.suite });
}

/**
 * PATCH /api/characters/:id/evals/suites/:suiteId
 *
 * Body: { probes?, releaseNotes? }
 *
 * Only writeable on drafts (publishedAt IS NULL). The UI sends a full
 * `probes` array on every save — diffing client-side would be possible
 * but the array is small enough (≤ 100 probes) that round-tripping
 * the whole thing is simpler.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; suiteId: string }> },
) {
  const { id, suiteId } = await ctx.params;
  const res = await loadOrNotFound(id, suiteId);
  if ("error" in res) return res.error;

  let body: { probes?: unknown; releaseNotes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: { probes?: unknown[]; releaseNotes?: string | null } = {};
  if (body.probes !== undefined) {
    if (!Array.isArray(body.probes)) {
      return NextResponse.json({ error: "probes must be an array" }, { status: 400 });
    }
    patch.probes = body.probes;
  }
  if (body.releaseNotes !== undefined) {
    if (body.releaseNotes !== null && typeof body.releaseNotes !== "string") {
      return NextResponse.json({ error: "releaseNotes must be a string or null" }, { status: 400 });
    }
    patch.releaseNotes = body.releaseNotes;
  }

  try {
    const updated = await getEvalStore().updateDraft(suiteId, patch);
    return NextResponse.json({ suite: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The store throws on "published and immutable" — surface as 409 Conflict.
    const status = msg.includes("published and immutable") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

/**
 * DELETE /api/characters/:id/evals/suites/:suiteId
 *
 * Discards a draft. Hard-fails on published suites (historical runs FK to
 * them; the right path is forking a new draft and editing instead).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; suiteId: string }> },
) {
  const { id, suiteId } = await ctx.params;
  const res = await loadOrNotFound(id, suiteId);
  if ("error" in res) return res.error;

  try {
    await getEvalStore().deleteDraft(suiteId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("cannot delete a published") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
