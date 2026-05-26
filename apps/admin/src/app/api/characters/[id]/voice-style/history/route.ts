import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore, type CharacterVoiceStyle } from "@odyssey/db";
import { hashShape } from "@/lib/harness-shape-hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/voice-style/history
 *
 * Reconstructs the L03 Voice & Style timeline from
 * `eval_runs.characterSnapshot`. Same pattern as identity/history and
 * directive/history — distinct shapes (hashed via order-stable
 * stringify + FNV-1a) become history entries.
 *
 * Why the dedicated hash, not the snapshot's `configHash`? configHash
 * folds in identity + directive + brainModel; this endpoint isolates
 * voice-style changes specifically.
 *
 * Same "snapshots without an eval are invisible" caveat as the other
 * history endpoints. Fine in practice — every voice-style iteration
 * worth reverting to should have been validated against an eval.
 *
 * Returns: { entries: Array<HistoryEntry> }, sorted by lastSeenAt DESC.
 */

type HistoryEntry = {
  voiceStyleHash: string;
  voiceStyle: CharacterVoiceStyle | null;
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

  const grouped = new Map<string, { entries: typeof runs; voiceStyle: CharacterVoiceStyle | null }>();
  for (const run of runs) {
    const snap = run.characterSnapshot as { voiceStyle?: CharacterVoiceStyle | null } | null;
    const voiceStyle = snap?.voiceStyle ?? null;
    const hash = hashShape(voiceStyle);
    const existing = grouped.get(hash);
    if (existing) {
      existing.entries.push(run);
    } else {
      grouped.set(hash, { entries: [run], voiceStyle });
    }
  }

  const currentHash = hashShape(character.voiceStyle);

  const entries: HistoryEntry[] = Array.from(grouped.entries()).map(([hash, g]) => {
    const starts = g.entries.map((r) => r.startedAt).sort();
    return {
      voiceStyleHash: hash,
      voiceStyle: g.voiceStyle,
      firstSeenAt: starts[0],
      lastSeenAt: starts[starts.length - 1],
      runCount: g.entries.length,
      isCurrent: hash === currentHash,
    };
  });

  entries.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

  return NextResponse.json({ entries });
}

