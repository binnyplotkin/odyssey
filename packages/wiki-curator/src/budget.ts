/**
 * Budget-aware page selection.
 *
 * Input: scored pages + token budget.
 * Output: for each page, a rendering mode ("full" | "summary" | "title") such
 * that the total rendered prompt fits within budget.
 *
 * Algorithm:
 *   1. Sort by score DESC.
 *   2. voice_identity is mandatory, but not allowed to consume the entire
 *      budget; it falls back to summary/title when its full body is too large.
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
  const rendered = [p.slug, p.title, p.summary ?? ""].join(" ");
  const frontmatter = p.type === "voice_identity" ? estimateFrontmatterTokens(p) : 0;
  return estimateTokens(rendered) + frontmatter + 12;
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
const MAX_MANDATORY_FULL_SHARE = 0.30;
const MAX_SELECTED_PAGES = 10;
const MAX_FULL_NON_MANDATORY = 2;

export function fitBudget(
  items: BudgetInput[],
  budget: number,
): BudgetOutput {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  const selected: SelectedPage[] = [];
  const budgetDropped: string[] = [];

  let remaining = budget - SCAFFOLDING_RESERVE;
  let nonMandatoryFullCount = 0;

  for (const item of sorted) {
    const isMandatory = item.page.type === "voice_identity";

    const full = tokensForFull(item.page);
    const summary = tokensForSummary(item.page);
    const title = tokensForTitle(item.page);

    if (isMandatory) {
      // voice_identity must be present, but full voice pages can be larger
      // than the entire live-voice context budget. Keep the identity signal
      // without starving turn-specific world knowledge.
      const maxFullCost = Math.max(200, Math.floor(budget * MAX_MANDATORY_FULL_SHARE));
      if (full <= remaining && full <= maxFullCost) {
        selected.push(render(item, "full", full));
        remaining -= full;
      } else if (summary <= remaining) {
        selected.push(render(item, "summary", summary));
        remaining -= summary;
      } else if (title <= remaining) {
        selected.push(render(item, "title", title));
        remaining -= title;
      } else {
        budgetDropped.push(item.page.slug);
      }
      continue;
    }

    if (selected.length >= MAX_SELECTED_PAGES) {
      budgetDropped.push(item.page.slug);
      continue;
    }

    let rendering: PageRendering | null = null;
    let cost = 0;
    if (nonMandatoryFullCount < MAX_FULL_NON_MANDATORY && full <= remaining) {
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
      if (rendering === "full") nonMandatoryFullCount += 1;
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
