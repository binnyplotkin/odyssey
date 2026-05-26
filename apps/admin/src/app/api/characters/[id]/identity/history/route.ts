import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type CharacterIdentity } from "@odyssey/db";
import { hashShape } from "@/lib/harness-shape-hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/identity/history
 *
 * Reconstructs the L01 Identity timeline from `eval_runs.characterSnapshot`.
 * Same pattern as the L04 brain-model history endpoint, just keyed on
 * `identity` instead of `brainModel`. Each distinct shape (hashed via
 * `stableStringify` below) becomes one entry; the snapshot's identity
 * field is surfaced verbatim so the client can POST it back as a revert.
 *
 * Why not use `configHash`? configHash also folds in voiceStyle,
 * brainModel, and directive — two runs with identical L01 but different
 * L04 would land in different config buckets even though L01 was the
 * same. This endpoint hashes only the L01 field so the timeline reflects
 * L01 changes specifically.
 *
 * Why no dedicated character_identity_versions table? Same reason as
 * L04: in practice every identity change the author cares about
 * reverting to has been validated against an eval. Configs they made
 * without running an eval are unrecorded here, but those are typically
 * experiments abandoned before validation. When that cost/benefit
 * flips, this endpoint can swap to a dedicated table without changing
 * the client.
 *
 * Returns: { entries: Array<HistoryEntry> }, sorted by lastSeenAt DESC.
 */

type HistoryEntry = {
  /** Stable hash of just the identity shape — used as the React key + revert id. */
  identityHash: string;
  identity: CharacterIdentity | null;
  firstSeenAt: string;
  lastSeenAt: string;
  runCount: number;
  isCurrent: boolean;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const character = await getCharacterStore().getById(id);
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const runs = await getEvalStore().listRuns({ characterId: id, limit: 200 });

  const grouped = new Map<string, { entries: typeof runs; identity: CharacterIdentity | null }>();
  for (const run of runs) {
    const snap = run.characterSnapshot as { identity?: CharacterIdentity | null } | null;
    const identity = snap?.identity ?? null;
    const hash = hashShape(identity);
    const existing = grouped.get(hash);
    if (existing) {
      existing.entries.push(run);
    } else {
      grouped.set(hash, { entries: [run], identity });
    }
  }

  const currentHash = hashShape(character.identity);

  const entries: HistoryEntry[] = Array.from(grouped.entries()).map(([hash, g]) => {
    const starts = g.entries.map((r) => r.startedAt).sort();
    return {
      identityHash: hash,
      identity: g.identity,
      firstSeenAt: starts[0],
      lastSeenAt: starts[starts.length - 1],
      runCount: g.entries.length,
      isCurrent: hash === currentHash,
    };
  });

  entries.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return NextResponse.json({ entries });
}

