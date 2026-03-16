import { describe, expect, it } from "vitest";
import { kingdomWorld } from "@/data/worlds/kingdom";
import { RuleBasedEventSelector } from "../event-selector";
import { TextGenerationAdapter } from "../interfaces";
import { RollingMemorySummarizer } from "../memory-summarizer";
import { DefaultPolicyGuard } from "../policy-guard";
import { HeuristicStateReducer } from "../state-reducer";
import { TurnProcessor } from "../turn-processor";

describe("TurnProcessor contract", () => {
  it("keeps state progression deterministic regardless of narrative style", async () => {
    const generator: TextGenerationAdapter = {
      async generateTurn() {
        return {
          narration: [{ id: "n1", speaker: "narrator", text: "Narrative output." }],
          dialogue: [
            {
              id: "d1",
              speaker: "Unlisted Character",
              role: "Unknown",
              emotion: "skeptical",
              text: "I claim the state should change however I want.",
            },
          ],
          uiChoices: ["Make a decree"],
          audioDirectives: [{ type: "await-input", voice: "alloy", text: "Your move." }],
        };
      },
    };

    const processor = new TurnProcessor(
      new HeuristicStateReducer(),
      new RuleBasedEventSelector(),
      new RollingMemorySummarizer(),
      new DefaultPolicyGuard(),
      generator,
    );

    const seededSession = {
      id: "session_contract",
      worldId: kingdomWorld.id,
      roleId: kingdomWorld.roles[0].id,
      status: "active" as const,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      currentStateVersion: 1,
      state: {
        ...kingdomWorld.initialState,
        turnCount: 0,
        activeEventId: null,
        lastEventIds: [],
      },
    };

    const processed = await processor.process(kingdomWorld, seededSession, {
      mode: "text",
      text: "Pardon the prisoner and feed the village.",
      clientTimestamp: new Date().toISOString(),
    });

    expect(processed.session.currentStateVersion).toBe(2);
    expect(processed.turn.result.visibleState.publicSentiment).toBeGreaterThan(
      seededSession.state.publicSentiment,
    );
    expect(processed.turn.result.privateStateVersion).toBe(2);
  });
});
