import { describe, expect, it } from "vitest";
import { buildVoicePromptPlan } from "../server";
import type { CurateResult } from "@odyssey/wiki-curator";

const curated: CurateResult = {
  promptChunk: "Ada remembers the machine room.",
  pages: [
    {
      page: {
        id: "page_1",
        wikiId: "wiki_1",
        characterId: "char_ada",
        slug: "machine-room",
        title: "Machine Room",
        type: "entity",
        summary: "The room hums.",
        body: "The room hums.",
        frontmatter: {},
        perspective: {},
        confidence: 1,
        timeIndex: null,
        knowsFuture: false,
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
      },
      rendering: "summary",
      score: 120,
      origin: "seed",
      trail: ["machine-room"],
      tokens: 12,
    },
  ],
  trace: {
    totalPages: 1,
    seeds: [{ slug: "machine-room", reason: "query-title", score: 120 }],
    edges: [],
    timelineFiltered: [],
    scoreDropped: [],
    budgetDropped: [],
  },
  tokensUsed: 12,
  tokensBudget: 2500,
  elapsedMs: 7,
};

describe("@odyssey/orchestration server", () => {
  it("builds a voice prompt plan with mocked stores", async () => {
    const plan = await buildVoicePromptPlan(
      {
        characterId: "char_ada",
        mode: "voice-baseline",
        promptKind: "voice",
        query: "What do you remember?",
      },
      {
        getCharacterById: async () => ({
          id: "char_ada",
          slug: "ada",
          title: "Ada",
          directive: {
            guidance: "Answer as the keeper of the machine room.",
          },
          identity: null,
          voiceStyle: {
            tone: ["careful"],
            brevity: "short",
          },
        }),
        curate: async () => curated,
      },
    );

    expect(plan.character.title).toBe("Ada");
    expect(plan.promptChunk).toBe("Ada remembers the machine room.");
    expect(plan.systemPrompt).toContain("You are Ada.");
    expect(plan.systemPrompt).toContain("careful");
    expect(plan.pages[0].slug).toBe("machine-room");
    expect(plan.timingTrace.events.some((e) => e.name === "prompt.built")).toBe(true);
  });

  it("uses provided curated context without calling the curator", async () => {
    let curateCalled = false;
    const plan = await buildVoicePromptPlan(
      {
        characterId: "char_ada",
        character: {
          id: "char_ada",
          slug: "ada",
          title: "Ada",
        },
        mode: "voice-turn",
        promptKind: "voice",
        curatedContext: curated,
      },
      {
        getCharacterById: async () => {
          throw new Error("should not load character");
        },
        curate: async () => {
          curateCalled = true;
          return curated;
        },
      },
    );

    expect(curateCalled).toBe(false);
    expect(plan.routingMode).toBe("voice-turn");
    expect(plan.tokensUsed).toBe(12);
  });
});
