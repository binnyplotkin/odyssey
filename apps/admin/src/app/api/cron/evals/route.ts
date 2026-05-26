import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";
import { launchEvalRunInBackground } from "@odyssey/evals";
import { loadLatestSuite } from "@/lib/eval-suites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/evals
 *
 * For each character that has a published suite, kick off a single eval run
 * against the saved production preset (no override). Designed for a nightly
 * cron job — daily ~$0.31/char trend line that catches upstream model
 * regressions cheaply.
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header. Set the
 * secret in env (process.env.CRON_SECRET) and pass it from your scheduler.
 *
 * Returns a manifest of every run kicked off so the caller can record
 * the launched run ids in their own logs.
 */
export async function POST(req: NextRequest) {
  // ── Auth ──
  // Cron endpoints bypass the admin session middleware (they're machine-to-
  // machine), so we require an explicit shared secret instead. Fail closed
  // if no secret is configured — better to have nothing run than to leave
  // the endpoint world-callable.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Body ──
  // Optional: { characterIds?: string[], suiteSlug?: string }
  // Defaults: every character that has a published suite, suiteSlug = the
  // character's slug (the convention seeded by `seed-<slug>-eval-suite.ts`).
  let body: { characterIds?: string[]; suiteSlug?: string } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as typeof body;
  } catch {
    // tolerate empty body / malformed JSON; treat as defaults
    body = {};
  }

  const characters = await getCharacterStore().list();
  const targets = body.characterIds
    ? characters.filter((c) => body.characterIds!.includes(c.id))
    : characters;

  const launched: Array<{ characterId: string; characterSlug: string; runId: string }> = [];
  const skipped: Array<{ characterId: string; characterSlug: string; reason: string }> = [];

  for (const character of targets) {
    const suiteSlug = body.suiteSlug ?? character.slug;
    try {
      const suite = await loadLatestSuite(character.id, suiteSlug);
      if (!suite) {
        skipped.push({
          characterId: character.id,
          characterSlug: character.slug,
          reason: `no published suite "${suiteSlug}"`,
        });
        continue;
      }
      const { runId, promise } = await launchEvalRunInBackground({
        characterId: character.id,
        suite,
      });
      void promise;
      launched.push({ characterId: character.id, characterSlug: character.slug, runId });
    } catch (err) {
      skipped.push({
        characterId: character.id,
        characterSlug: character.slug,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    launched,
    skipped,
    summary: `kicked off ${launched.length} run(s) · skipped ${skipped.length}`,
  });
}

/**
 * GET /api/cron/evals
 *
 * Read-only health check — returns "which characters would this run for"
 * without actually launching anything. Useful for verifying the cron
 * configuration matches expectations before turning the cron on.
 *
 * Same auth gate as POST.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = getEvalStore();
  const characters = await getCharacterStore().list();
  const plan: Array<{
    characterId: string;
    characterSlug: string;
    suite: { id: string; slug: string; version: string; probeCount: number } | null;
  }> = [];

  for (const character of characters) {
    const suite = await store.getLatestSuiteBySlug(character.id, character.slug);
    plan.push({
      characterId: character.id,
      characterSlug: character.slug,
      suite: suite
        ? {
            id: suite.id,
            slug: suite.slug,
            version: suite.version,
            probeCount: (suite.probes as unknown[]).length,
          }
        : null,
    });
  }

  return NextResponse.json({ plan });
}
