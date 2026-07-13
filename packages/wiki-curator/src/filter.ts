/**
 * Timeline guard. Drop pages whose timeIndex is after the character's
 * current moment, unless the page is tagged knowsFuture (e.g. a covenant
 * Abraham was promised but hasn't yet lived through).
 *
 * Pages can also be marked as curator-only through frontmatter
 * (`knowledge_accessible: false` or `accessible_to_character: false`). Those
 * pages remain in the wiki/graph but are withheld from runtime character
 * context.
 *
 * Entities, concepts, relationships, voice_identity, timeline, and pages
 * without a timeIndex are otherwise kept — they're not event-bound.
 */

import type { EraConfig, TimeIndex, WikiPageRecord } from "@odyssey/db";

export function filterByTimeline(
  pages: WikiPageRecord[],
  eras: EraConfig[],
  currentMoment: TimeIndex | null | undefined,
): { kept: WikiPageRecord[]; filteredSlugs: string[]; futureSlugs: string[] } {
  // futureSlugs ⊆ filteredSlugs: only the pages dropped because they sit
  // AFTER currentMoment (not the curator-only ones). The renderer lists these
  // in the horizon fence ("these have not happened yet").
  if (!currentMoment) {
    return { kept: pages, filteredSlugs: [], futureSlugs: [] };
  }

  // Map each era key → order index for O(1) comparison.
  const eraOrder = new Map<string, number>();
  for (const e of eras) eraOrder.set(e.key, e.order);

  const currentOrder = eraOrder.get(currentMoment.era);
  if (currentOrder === undefined) {
    // currentMoment references an era the character doesn't have configured.
    // Be permissive and keep everything — don't silently break a session.
    return { kept: pages, filteredSlugs: [], futureSlugs: [] };
  }

  const kept: WikiPageRecord[] = [];
  const filteredSlugs: string[] = [];
  const futureSlugs: string[] = [];

  for (const p of pages) {
    if (!isKnowledgeAccessible(p)) {
      filteredSlugs.push(p.slug);
      continue;
    }

    if (!p.timeIndex) {
      kept.push(p);
      continue;
    }
    if (p.knowsFuture) {
      kept.push(p);
      continue;
    }

    const otherOrder = eraOrder.get(p.timeIndex.era);
    if (otherOrder === undefined) {
      // Unknown era on the page; keep it rather than silently filter.
      kept.push(p);
      continue;
    }

    if (otherOrder < currentOrder) {
      kept.push(p);
    } else if (otherOrder === currentOrder) {
      if (p.timeIndex.index <= currentMoment.index) {
        kept.push(p);
      } else {
        filteredSlugs.push(p.slug);
        futureSlugs.push(p.slug);
      }
    } else {
      filteredSlugs.push(p.slug);
      futureSlugs.push(p.slug);
    }
  }

  return { kept, filteredSlugs, futureSlugs };
}

function isKnowledgeAccessible(page: WikiPageRecord): boolean {
  const frontmatter = page.frontmatter as Record<string, unknown>;
  return (
    frontmatter.knowledge_accessible !== false &&
    frontmatter.accessible_to_character !== false
  );
}
