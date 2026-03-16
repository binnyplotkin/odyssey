import { describe, expect, it } from "vitest";
import { kingdomWorld } from "@/data/worlds/kingdom";
import { FallbackTextGenerator, OpenAITextGenerator } from "../generator";

const baseParams = {
  world: kingdomWorld,
  state: {
    ...kingdomWorld.initialState,
    turnCount: 1,
    activeEventId: null,
    lastEventIds: [],
  },
  activeEvent: kingdomWorld.eventTemplates[0],
  input: {
    mode: "text" as const,
    text: "Open court and hear the merchants.",
    clientTimestamp: new Date().toISOString(),
  },
};

describe("OpenAITextGenerator fallbacks", () => {
  it("falls back when client is unavailable", async () => {
    const generator = new OpenAITextGenerator({
      clientFactory: () => null,
      fallback: new FallbackTextGenerator(),
    });

    const result = await generator.generateTurn(baseParams);

    expect(result.narration.length).toBeGreaterThan(0);
    expect(result.uiChoices.length).toBeGreaterThan(0);
  });

  it("falls back when provider returns malformed JSON", async () => {
    const generator = new OpenAITextGenerator({
      clientFactory: () =>
        ({
          responses: {
            create: async () => ({ output_text: "{not json" }),
            stream: () => {
              throw new Error("stream not used");
            },
          },
        }) as never,
      fallback: new FallbackTextGenerator(),
    });

    const result = await generator.generateTurn(baseParams);

    expect(result.narration[0]?.speaker).toBe("narrator");
    expect(result.dialogue.length).toBeGreaterThan(0);
  });

  it("falls back when provider create call throws", async () => {
    const generator = new OpenAITextGenerator({
      clientFactory: () =>
        ({
          responses: {
            create: async () => {
              throw new Error("provider timeout");
            },
            stream: () => {
              throw new Error("stream not used");
            },
          },
        }) as never,
      fallback: new FallbackTextGenerator(),
    });

    const result = await generator.generateTurn(baseParams);

    expect(result.audioDirectives.some((directive) => directive.type === "await-input")).toBe(true);
  });
});
