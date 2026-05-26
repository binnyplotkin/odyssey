import { NextResponse } from "next/server";
import { getCharacterStore, getEvalStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/characters/:id/directive/never-compliance
 *
 * Backs the L02 NEVER tab. For each saved never-rule on this character,
 * scans recent eval probes for evidence of violation. The same
 * keyword-overlap heuristic as the in-editor advisory check, just
 * scaled across runs.
 *
 * Heuristic:
 *   - Strip leading "do not " from each rule.
 *   - Pull words length ≥ 4 (drops articles + prepositions), take first 3.
 *   - For each probe response, count how many of those 3 keywords appear.
 *   - 2-out-of-3 keyword hits = a suspected violation.
 *
 * False positives are real — the heuristic doesn't understand context.
 * The tab surfaces matches for human review rather than asserting them
 * as actual violations. A rule that's truly enforced shows zero matches.
 *
 * Limit: 50 recent runs, same as promote-candidates. At ~20 probes per
 * run that's up to 1000 probe responses to scan — fast.
 *
 * Returns: { rules: Array<{ rule, matches[] }> }
 */

type Match = {
  probeId: string;
  probeCategory: string;
  input: string;
  response: string;
  overall: number;
  runId: string;
  startedAt: string;
};

type RuleResult = {
  rule: string;
  matches: Match[];
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

  const neverRules = character.directive?.never ?? [];
  if (neverRules.length === 0) {
    return NextResponse.json({ rules: [] });
  }

  const store = getEvalStore();
  const runs = await store.listRuns({ characterId: id, limit: 50 });
  const probesByRun = await Promise.all(
    runs.map(async (run) => {
      const withProbes = await store.getRunWithProbes(run.id);
      return { run, probes: withProbes?.probes ?? [] };
    }),
  );

  // Compile each rule's keyword set once.
  const compiledRules = neverRules.map((rule) => {
    const stripped = rule.replace(/^do not\s+/i, "");
    const keywords = stripped
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4)
      .slice(0, 3);
    return { rule, keywords };
  });

  const results: RuleResult[] = compiledRules.map(({ rule, keywords }) => {
    const matches: Match[] = [];
    if (keywords.length === 0) {
      return { rule, matches };
    }

    for (const { run, probes } of probesByRun) {
      for (const p of probes) {
        const text = (p.response ?? "").toLowerCase();
        if (!text) continue;
        const hits = keywords.filter((k) => text.includes(k)).length;
        // 2/3 keyword hits = suspected violation. For shorter rules
        // (1-2 keywords) require all to match.
        const required = Math.max(2, keywords.length === 1 ? 1 : keywords.length === 2 ? 2 : 2);
        if (hits < required) continue;
        matches.push({
          probeId: p.probeId,
          probeCategory: p.probeCategory,
          input: p.input,
          response: p.response,
          overall: p.overall,
          runId: run.id,
          startedAt: run.startedAt,
        });
      }
    }

    // Sort matches by recency — most recent violations first surface
    // regressions worth addressing now.
    matches.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    // Cap at 20 per rule — UI is otherwise unbounded.
    return { rule, matches: matches.slice(0, 20) };
  });

  return NextResponse.json({ rules: results });
}
