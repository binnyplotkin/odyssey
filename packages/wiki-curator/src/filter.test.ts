import { describe, expect, it } from "vitest";
import type { EraConfig, WikiPageRecord } from "@odyssey/db";
import { filterByTimeline } from "./filter";

const eras: EraConfig[] = [
  { key: "early", title: "Early", order: 1 },
  { key: "late", title: "Late", order: 2 },
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
    // Inaccessible ≠ future: the horizon fence must not list curator-only
    // pages as "not yet lived".
    expect(result.futureSlugs).toEqual([]);
  });

  it("separates future pages (fence material) from curator-only drops", () => {
    const past = page({
      slug: "the-call",
      title: "The Call",
      timeIndex: { era: "early", index: 1 },
    });
    const sameEraFuture = page({
      slug: "birth-of-isaac",
      title: "Birth of Isaac",
      timeIndex: { era: "early", index: 9 },
    });
    const laterEraFuture = page({
      slug: "death-of-sarah",
      title: "Death of Sarah",
      timeIndex: { era: "late", index: 1 },
    });
    const prophecy = page({
      slug: "great-nation-promise",
      title: "Great Nation Promise",
      timeIndex: { era: "late", index: 5 },
      knowsFuture: true,
    });
    const timeless = page({ slug: "sarah", title: "Sarah" });
    const curatorOnly = page({
      slug: "aristotle",
      title: "Aristotle",
      frontmatter: { knowledge_accessible: false },
    });

    const result = filterByTimeline(
      [past, sameEraFuture, laterEraFuture, prophecy, timeless, curatorOnly],
      eras,
      { era: "early", index: 3 },
    );

    expect(result.kept.map((p) => p.slug)).toEqual([
      "the-call",
      "great-nation-promise",
      "sarah",
    ]);
    expect(result.filteredSlugs).toEqual([
      "birth-of-isaac",
      "death-of-sarah",
      "aristotle",
    ]);
    expect(result.futureSlugs).toEqual(["birth-of-isaac", "death-of-sarah"]);
  });

  it("keeps everything when no moment is set", () => {
    const future = page({
      slug: "later",
      title: "Later",
      timeIndex: { era: "late", index: 1 },
    });
    const result = filterByTimeline([future], eras, null);
    expect(result.kept.map((p) => p.slug)).toEqual(["later"]);
    expect(result.futureSlugs).toEqual([]);
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
