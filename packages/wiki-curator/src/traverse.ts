/**
 * Graph traversal from the seed pages. BFS with priority scoring — walk
 * outbound + inbound edges up to a fixed depth, accruing score from edge
 * weights with a per-hop penalty.
 *
 * Edge-kind weights tuned for the character-runtime case: the pages that
 * represent HOW the character relates to things (perspective_of, relates_to)
 * outrank pages that simply mention something.
 */

import type { EdgeKind, WikiEdgeRecord, WikiPageRecord } from "@odyssey/db";
import type { EdgeFollowed } from "./types";

export const EDGE_WEIGHT: Record<EdgeKind, number> = {
  perspective_of:  1.0,
  relates_to:      0.8,
  participates_in: 0.7,
  happens_at:      0.5,
  contradicts:     0.45,
  mentions:        0.18,
};

const HOP_PENALTY = 0.35;
const MAX_DEPTH = 2;
/** Ignore traversal targets whose accumulated score would fall below this. */
const MIN_SCORE_KEEP = 30;

export type TraverseResult = {
  scores: Map<string, number>;
  /** Lookup for "how did this page get here" — hop count + parent slug. */
  origin: Map<string, { hop: number; parentPageId: string | null; edgeKind: EdgeKind | null }>;
  edgesFollowed: EdgeFollowed[];
};

export function traverse(
  pages: WikiPageRecord[],
  edges: WikiEdgeRecord[],
  initialScores: Map<string, number>,
): TraverseResult {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const edgesByFrom = new Map<string, WikiEdgeRecord[]>();
  const edgesByTo = new Map<string, WikiEdgeRecord[]>();
  for (const e of edges) {
    if (!edgesByFrom.has(e.fromPageId)) edgesByFrom.set(e.fromPageId, []);
    edgesByFrom.get(e.fromPageId)!.push(e);
    if (!edgesByTo.has(e.toPageId)) edgesByTo.set(e.toPageId, []);
    edgesByTo.get(e.toPageId)!.push(e);
  }

  const scores = new Map(initialScores);
  const origin = new Map<
    string,
    { hop: number; parentPageId: string | null; edgeKind: EdgeKind | null }
  >();
  for (const [id] of initialScores) origin.set(id, { hop: 0, parentPageId: null, edgeKind: null });

  const edgesFollowed: EdgeFollowed[] = [];

  // Simple BFS by depth levels. At each level, expand only the pages already
  // in the frontier; push neighbours into the next frontier.
  let frontier = Array.from(initialScores.keys());
  const visited = new Set<string>(frontier);

  for (let hop = 1; hop <= MAX_DEPTH; hop++) {
    const nextFrontier = new Set<string>();

    for (const fromId of frontier) {
      // Identity is mandatory context, not a topical query seed. Expanding
      // from it fans out into broad biographical/philosophical pages and
      // drowns the pages that the current utterance actually asked for.
      if (pageById.get(fromId)?.type === "voice_identity") continue;

      const fromScore = scores.get(fromId) ?? 0;
      const hopMultiplier = Math.max(0, 1 - HOP_PENALTY * hop);
      if (fromScore * hopMultiplier < MIN_SCORE_KEEP) continue;

      const outgoing = edgesByFrom.get(fromId) ?? [];
      const incoming = edgesByTo.get(fromId) ?? [];

      for (const e of [...outgoing, ...incoming]) {
        const toId = e.fromPageId === fromId ? e.toPageId : e.fromPageId;
        if (toId === fromId) continue;

        const kindWeight = EDGE_WEIGHT[e.kind] ?? 0.3;
        // Score contribution: the source score × edge weight × hop decay.
        const contribution = fromScore * kindWeight * hopMultiplier;

        if (contribution < MIN_SCORE_KEEP) continue;

        const current = scores.get(toId) ?? 0;
        // Accumulate scores from multiple paths — a page connected via two
        // strong edges ranks higher than one connected via one.
        const updated = Math.max(current, contribution) +
          (current > 0 ? contribution * 0.35 : 0);

        scores.set(toId, updated);

        if (!origin.has(toId)) {
          origin.set(toId, { hop, parentPageId: fromId, edgeKind: e.kind });
        }

        const fromSlug = pageById.get(fromId)?.slug ?? "?";
        const toSlug = pageById.get(toId)?.slug ?? "?";
        edgesFollowed.push({
          fromSlug,
          toSlug,
          kind: e.kind,
          contribution: Math.round(contribution * 10) / 10,
        });

        if (!visited.has(toId)) {
          visited.add(toId);
          nextFrontier.add(toId);
        }
      }
    }

    frontier = Array.from(nextFrontier);
    if (frontier.length === 0) break;
  }

  return { scores, origin, edgesFollowed };
}
