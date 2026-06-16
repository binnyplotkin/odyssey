import * as dotenv from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

dotenv.config({ override: true, quiet: true });

import { getCharacterStore } from "@odyssey/db";
import { curate } from "./index";

const TOKEN_BUDGET = 3000;
const MIN_AVG_PRECISION = 0.5;
const MAX_SELECTED_PAGES = 10;

type GoldCase = {
  name: string;
  query: string;
  expected: string[];
  forbidden?: string[];
};

const GOLD_CASES: GoldCase[] = [
  {
    name: "Mamre visitors tolerates STT drift",
    query: "Tell me about the visitors who came to your tent at mammary.",
    expected: ["three-visitors-at-mamre", "hospitality-and-kindness", "sarah"],
  },
  {
    name: "Sarah laughter resolves promise context",
    query: "When I say Sarah laughed, what promise am I referring to?",
    expected: [
      "sarah",
      "sarai",
      "barrenness",
      "birth-of-isaac",
      "great-nation-promise",
      "three-visitors-at-mamre",
    ],
    forbidden: ["death-of-sarah", "purchase-of-machpelah"],
  },
  {
    name: "Ur and Haran origin tolerates STT drift",
    query: "What did you leave behind in Ur and Huran?",
    expected: [
      "ur-of-the-chaldees",
      "departure-from-ur",
      "the-call-at-haran",
      "haran-city",
      "terah",
    ],
    forbidden: ["descent-into-egypt", "binding-of-isaac"],
  },
  {
    name: "Egypt fear activates Egypt scene",
    query: "What happened in Egypt when fear overtook you?",
    expected: ["descent-into-egypt", "egypt", "pharaoh", "fear-and-deception", "sarah", "sarai"],
  },
  {
    name: "negative binding instruction stays on hospitality",
    query: "Do not talk about the binding yet. Keep this to the visitors and hospitality.",
    expected: ["three-visitors-at-mamre", "hospitality-and-kindness"],
    forbidden: ["binding-of-isaac", "moriah", "isaac"],
  },
  {
    name: "Isaac promise connects Sarah and barrenness",
    query: "Now connect the promise of Isaac to Sarah's barrenness without drifting into later events.",
    expected: ["sarah", "sarai", "barrenness", "birth-of-isaac", "great-nation-promise"],
    forbidden: ["binding-of-isaac", "death-of-sarah", "eliezers-mission-for-isaac"],
  },
];

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb("wiki-curator context activation", () => {
  let characterId: string;

  beforeAll(async () => {
    const abraham = await getCharacterStore().getBySlug("abraham");
    if (!abraham) {
      throw new Error("Expected seeded Abraham character for context activation tests.");
    }
    characterId = abraham.id;
  });

  it.each(GOLD_CASES)("$name", async (gold) => {
    const result = await curate({
      characterId,
      query: gold.query,
      tokenBudget: TOKEN_BUDGET,
    });

    const selected = result.pages.map((entry) => entry.page.slug);
    const selectedSet = new Set(selected);
    const missing = gold.expected.filter((slug) => !selectedSet.has(slug));
    const forbiddenHits = (gold.forbidden ?? []).filter((slug) => selectedSet.has(slug));

    expect(result.tokensUsed, `${gold.name} token budget`).toBeLessThanOrEqual(TOKEN_BUDGET);
    expect(selected.length, `${gold.name} selected page count`).toBeLessThanOrEqual(MAX_SELECTED_PAGES);
    expect(missing, `${gold.name} missing gold pages from ${selected.join(", ")}`).toEqual([]);
    expect(forbiddenHits, `${gold.name} selected forbidden pages from ${selected.join(", ")}`).toEqual([]);
    expect(
      result.trace.seeds.some((seed) => seed.reason === "query-activation"),
      `${gold.name} should use direct activation seeds`,
    ).toBe(true);
  });

  it("keeps suite-level precision above the floor", async () => {
    let precisionTotal = 0;

    for (const gold of GOLD_CASES) {
      const result = await curate({
        characterId,
        query: gold.query,
        tokenBudget: TOKEN_BUDGET,
      });
      const selected = new Set(result.pages.map((entry) => entry.page.slug));
      const matches = gold.expected.filter((slug) => selected.has(slug)).length;
      precisionTotal += selected.size > 0 ? matches / selected.size : 0;
    }

    expect(precisionTotal / GOLD_CASES.length).toBeGreaterThanOrEqual(MIN_AVG_PRECISION);
  });
});
