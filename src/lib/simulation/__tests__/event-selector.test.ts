import { describe, expect, it } from "vitest";
import { kingdomWorld } from "@/data/worlds/kingdom";
import { RuleBasedEventSelector } from "@/lib/simulation/event-selector";

describe("RuleBasedEventSelector", () => {
  it("prefers the highest-urgency eligible event", () => {
    const selector = new RuleBasedEventSelector();
    const event = selector.select(kingdomWorld, {
      ...kingdomWorld.initialState,
      turnCount: 0,
      activeEventId: null,
      lastEventIds: [],
      militaryPressure: 60,
      treasury: 40,
      politicalStability: 55,
      publicSentiment: 50,
    });

    expect(event?.id).toBe("border-raid");
  });
});
