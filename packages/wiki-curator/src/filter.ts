/**
 * Timeline guard. Drop pages whose timeIndex is after the character's
 * current moment, unless the page is tagged knowsFuture (e.g. a covenant
 * Abraham was promised but hasn't yet lived through).
 *
 * Entities, concepts, relationships, voice_identity, timeline, and pages
 * without a timeIndex are always kept — they're not event-bound.
 */

import type { EraConfig, TimeIndex, WikiPageRecord } from "@odyssey/db";

export function filterByTimeline(
  pages: WikiPageRecord[],
  eras: EraConfig[],
  currentMoment: TimeIndex | null | undefined,
): { kept: WikiPageRecord[]; filteredSlugs: string[] } {
  if (!currentMoment) {
    return { kept: pages, filteredSlugs: [] };
  }

  // Map each era key → order index for O(1) comparison.
  const eraOrder = new Map<string, number>();
  for (const e of eras) eraOrder.set(e.key, e.order);

  const currentOrder = eraOrder.get(currentMoment.era);
  if (currentOrder === undefined) {
    // currentMoment references an era the character doesn't have configured.
    // Be permissive and keep everything — don't silently break a session.
    return { kept: pages, filteredSlugs: [] };
  }

  const kept: WikiPageRecord[] = [];
  const filteredSlugs: string[] = [];

  for (const p of pages) {
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
      if (p.timeIndex.index <= currentMoment.index) kept.push(p);
      else filteredSlugs.push(p.slug);
    } else {
      filteredSlugs.push(p.slug);
    }
  }

  return { kept, filteredSlugs };
}
