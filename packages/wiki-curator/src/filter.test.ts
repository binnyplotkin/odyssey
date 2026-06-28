import { describe, expect, it } from "vitest";
import type { EraConfig, WikiPageRecord } from "@odyssey/db";
import { filterByTimeline } from "./filter";

const eras: EraConfig[] = [
  { key: "early", label: "Early", order: 1 },
  { key: "late", label: "Late", order: 2 },
];

describe("filterByTimeline", () => {
  it("keeps curator-only pages in the graph but out of runtime context", () => {
    const accessible = page({ slug: "abraham", title: "Abraham" });
    const curatorOnly = page({
      slug: "rav-soloveitchik",
      title: "Rav Soloveitchik",
      frontmatter: { knowledge_accessible: false },
    });
    const alsoCuratorOnly = page({
      slug: "aristotle",
      title: "Aristotle",
      frontmatter: { accessible_to_character: false },
    });

    const result = filterByTimeline(
      [accessible, curatorOnly, alsoCuratorOnly],
      eras,
      { era: "early", index: 1 },
    );

    expect(result.kept.map((p) => p.slug)).toEqual(["abraham"]);
    expect(result.filteredSlugs).toEqual(["rav-soloveitchik", "aristotle"]);
  });
});

function page(input: {
  slug: string;
  title: string;
  frontmatter?: Record<string, unknown>;
  timeIndex?: WikiPageRecord["timeIndex"];
  knowsFuture?: boolean;
}): WikiPageRecord {
  return {
    id: input.slug,
    characterId: "character-1",
    wikiId: "wiki-1",
    type: "entity",
    slug: input.slug,
    title: input.title,
    summary: null,
    body: "",
    frontmatter: input.frontmatter ?? {},
    perspective: {},
    confidence: 1,
    timeIndex: input.timeIndex ?? null,
    knowsFuture: input.knowsFuture ?? false,
    contradictions: [],
    version: 1,
    lastCompiledAt: null,
    embedding: null,
    embeddingModel: null,
    embeddedAt: null,
    layoutX: null,
    layoutY: null,
    layoutComputedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
