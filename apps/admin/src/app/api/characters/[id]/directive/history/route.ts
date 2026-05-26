import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type CharacterDirective } from "@odyssey/db";
import { hashShape } from "@/lib/harness-shape-hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/directive/history
 *
 * Reconstructs the L02 Directive timeline from `eval_runs.characterSnapshot`.
 * Same pattern as identity/history — distinct shapes (hashed via FNV-1a
 * over an order-stable JSON serialization) become history entries.
 *
 * Why a dedicated hash, not the existing `configHash`? configHash folds
 * in identity, voiceStyle, brainModel, and directive together — two runs
 * with identical directives but different L04 mind/models would split
 * into different config buckets even though L02 was unchanged. This
 * endpoint isolates L02 changes specifically.
 *
 * Same "snapshots without an eval are invisible" caveat as the L01/L04
 * history endpoints. In practice that's fine for L02 since directive
 * iterations are usually followed by a sweep to validate the change.
 *
 * Returns: { entries: Array<HistoryEntry> }, sorted by lastSeenAt DESC.
 */

type HistoryEntry = {
  directiveHash: string;
  directive: CharacterDirective | null;
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

  const grouped = new Map<string, { entries: typeof runs; directive: CharacterDirective | null }>();
  for (const run of runs) {
    const snap = run.characterSnapshot as { directive?: CharacterDirective | null } | null;
    const directive = snap?.directive ?? null;
    const hash = hashShape(directive);
    const existing = grouped.get(hash);
    if (existing) {
      existing.entries.push(run);
    } else {
      grouped.set(hash, { entries: [run], directive });
    }
  }

  const currentHash = hashShape(character.directive);

  const entries: HistoryEntry[] = Array.from(grouped.entries()).map(([hash, g]) => {
    const starts = g.entries.map((r) => r.startedAt).sort();
    return {
      directiveHash: hash,
      directive: g.directive,
      firstSeenAt: starts[0],
      lastSeenAt: starts[starts.length - 1],
      runCount: g.entries.length,
      isCurrent: hash === currentHash,
    };
  });

  entries.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return NextResponse.json({ entries });
}

