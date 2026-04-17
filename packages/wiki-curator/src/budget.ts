/**
 * Budget-aware page selection.
 *
 * Input: scored pages + token budget.
 * Output: for each page, a rendering mode ("full" | "summary" | "title") such
 * that the total rendered prompt fits within budget.
 *
 * Algorithm:
 *   1. Sort by score DESC.
 *   2. voice_identity is promoted to "full" unconditionally (mandatory).
 *   3. Greedy promotion: take each page in score order, try to fit as "full";
 *      fall back to "summary" if full exceeds remaining budget; drop if even
 *      summary doesn't fit.
 *   4. Reserve a small overhead (~80 tokens) for section headers + separators.
 */

import type { WikiPageRecord } from "@odyssey/db";
import type { PageRendering, SelectedPage } from "./types";
import { estimateTokens } from "./tokens";

/** Per-page rendering cost helpers. */

export function tokensForFull(p: WikiPageRecord): number {
  // Full body + summary (we include both) + frontmatter summary + a tiny
  // scaffolding overhead per page.
  let n = estimateTokens(p.body);
  n += estimateTokens(p.summary);
  n += estimateFrontmatterTokens(p);
  n += 24; // heading + bookends
  return n;
}

export function tokensForSummary(p: WikiPageRecord): number {
  return estimateTokens(p.summary ?? p.title) + 8;
}

export function tokensForTitle(p: WikiPageRecord): number {
  return estimateTokens(p.title) + estimateTokens(p.slug) + 4;
}

function estimateFrontmatterTokens(p: WikiPageRecord): number {
  // Rough — we only render a few key structured fields in prompt.
  try {
    return Math.min(80, Math.ceil(JSON.stringify(p.frontmatter).length / 6));
  } catch {
    return 0;
  }
}

/* ── Scheduler ─────────────────────────────────────────────────── */

export type BudgetInput = {
  page: WikiPageRecord;
  score: number;
  origin: string;
  trail: string[];
};

export type BudgetOutput = {
  selected: SelectedPage[];
  budgetDropped: string[];
  tokensUsed: number;
};

const SCAFFOLDING_RESERVE = 120; // fixed overhead for section headers

export function fitBudget(
  items: BudgetInput[],
  budget: number,
): BudgetOutput {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const selected: SelectedPage[] = [];
  const budgetDropped: string[] = [];

  let remaining = budget - SCAFFOLDING_RESERVE;

  for (const item of sorted) {
    const isMandatory = item.page.type === "voice_identity";

    const full = tokensForFull(item.page);
    const summary = tokensForSummary(item.page);
    const title = tokensForTitle(item.page);

    if (isMandatory) {
      // voice_identity always goes in (budget be damned). We still count
      // its tokens against remaining.
      selected.push(render(item, "full", full));
      remaining -= full;
      continue;
    }

    let rendering: PageRendering | null = null;
    let cost = 0;
    if (full <= remaining) {
      rendering = "full";
      cost = full;
    } else if (summary <= remaining) {
      rendering = "summary";
      cost = summary;
    } else if (title <= remaining) {
      rendering = "title";
      cost = title;
    }

    if (rendering) {
      selected.push(render(item, rendering, cost));
      remaining -= cost;
    } else {
      budgetDropped.push(item.page.slug);
    }
  }

  return {
    selected,
    budgetDropped,
    tokensUsed: budget - remaining,
  };
}

function render(item: BudgetInput, rendering: PageRendering, tokens: number): SelectedPage {
  return {
    page: item.page,
    rendering,
    score: item.score,
    origin: item.origin,
    trail: item.trail,
    tokens,
  };
}
