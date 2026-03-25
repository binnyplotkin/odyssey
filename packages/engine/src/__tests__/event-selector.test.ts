import { describe, expect, it } from "vitest";
import { kingdomWorld } from "@/data/worlds/kingdom";
import { RuleBasedEventSelector } from "../event-selector";

describe("RuleBasedEventSelector", () => {
  it("prefers the highest-urgency eligible event", () => {
    const selector = new RuleBasedEventSelector();
    const event = selector.select(kingdomWorld, {
      ...kingdomWorld.initialState,
      turnCount: 0,
      activeEventId: null,
      lastEventIds: [],
      pressure: 60,
      resources: 40,
      stability: 55,
      morale: 50,
      metricValues: { stability: 55, morale: 50, resources: 40, pressure: 60 },
    });

    expect(event?.id).toBe("border-raid");
  });
});
