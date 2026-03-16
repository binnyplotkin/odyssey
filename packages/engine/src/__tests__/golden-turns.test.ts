import { beforeEach, describe, expect, it } from "vitest";
import { getWorldDefinitions } from "@/data/worlds";
import { createSimulationService } from "../service";

const goldenInputs = [
  "Hold open court and hear grievances from the grain quarter.",
  "Pardon the deserters and send food to their families.",
  "Raise a temporary levy on luxury imports to fund repairs.",
  "Mobilize two regiments to the northern border immediately.",
  "Delay escalation and open negotiations with border lords.",
  "Seize corrupt storehouses and redistribute grain reserves.",
  "Execute the smuggling ring leaders publicly.",
  "Compensate farmers for wartime requisitions.",
  "Discipline the garrison commanders for extortion.",
  "Announce a reform council with merchant and peasant delegates.",
];

describe("golden turn regression", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
  });

  it("keeps deterministic visible-state progression stable", async () => {
    const service = createSimulationService(getWorldDefinitions());
    const [world] = await service.listWorlds();
    const session = await service.startSession(world.id, world.roles[0].id);
    const progression: Array<{
      turn: number;
      eventId: string | null;
      publicSentiment: number;
      politicalStability: number;
      treasury: number;
      militaryPressure: number;
      stateDeltaSummary: string;
    }> = [];

    for (let index = 0; index < goldenInputs.length; index += 1) {
      const result = await service.processTurn(session.id, {
        mode: "text",
        text: goldenInputs[index],
        clientTimestamp: new Date().toISOString(),
      });

      progression.push({
        turn: index + 1,
        eventId: result.turn.result.event?.id ?? null,
        publicSentiment: result.turn.result.visibleState.publicSentiment,
        politicalStability: result.turn.result.visibleState.politicalStability,
        treasury: result.turn.result.visibleState.treasury,
        militaryPressure: result.turn.result.visibleState.militaryPressure,
        stateDeltaSummary: result.turn.stateDeltaSummary,
      });
    }

    expect(progression).toEqual([
      {
        turn: 1,
        eventId: "empty-granaries",
        publicSentiment: 52,
        politicalStability: 64,
        treasury: 47,
        militaryPressure: 41,
        stateDeltaSummary:
          "Public sentiment rose to 52. Political stability shifted to 64. Treasury is now 47. Military pressure is now 41.",
      },
      {
        turn: 2,
        eventId: "prisoner-plea",
        publicSentiment: 56,
        politicalStability: 65,
        treasury: 47,
        militaryPressure: 41,
        stateDeltaSummary:
          "Public sentiment rose to 56. Political stability shifted to 65. Treasury is now 47. Military pressure is now 41.",
      },
      {
        turn: 3,
        eventId: "prisoner-plea",
        publicSentiment: 56,
        politicalStability: 65,
        treasury: 52,
        militaryPressure: 41,
        stateDeltaSummary:
          "Public sentiment rose to 56. Political stability shifted to 65. Treasury is now 52. Military pressure is now 41.",
      },
      {
        turn: 4,
        eventId: "prisoner-plea",
        publicSentiment: 55,
        politicalStability: 67,
        treasury: 52,
        militaryPressure: 36,
        stateDeltaSummary:
          "Public sentiment rose to 55. Political stability shifted to 67. Treasury is now 52. Military pressure is now 36.",
      },
      {
        turn: 5,
        eventId: "prisoner-plea",
        publicSentiment: 55,
        politicalStability: 67,
        treasury: 52,
        militaryPressure: 41,
        stateDeltaSummary:
          "Public sentiment rose to 55. Political stability shifted to 67. Treasury is now 52. Military pressure is now 41.",
      },
      {
        turn: 6,
        eventId: "prisoner-plea",
        publicSentiment: 54,
        politicalStability: 69,
        treasury: 57,
        militaryPressure: 38,
        stateDeltaSummary:
          "Public sentiment rose to 54. Political stability shifted to 69. Treasury is now 57. Military pressure is now 38.",
      },
      {
        turn: 7,
        eventId: "prisoner-plea",
        publicSentiment: 50,
        politicalStability: 68,
        treasury: 57,
        militaryPressure: 38,
        stateDeltaSummary:
          "Public sentiment fell to 50. Political stability shifted to 68. Treasury is now 57. Military pressure is now 38.",
      },
      {
        turn: 8,
        eventId: "prisoner-plea",
        publicSentiment: 50,
        politicalStability: 68,
        treasury: 52,
        militaryPressure: 38,
        stateDeltaSummary:
          "Public sentiment rose to 50. Political stability shifted to 68. Treasury is now 52. Military pressure is now 38.",
      },
      {
        turn: 9,
        eventId: "empty-granaries",
        publicSentiment: 48,
        politicalStability: 72,
        treasury: 52,
        militaryPressure: 32,
        stateDeltaSummary:
          "Public sentiment rose to 48. Political stability shifted to 72. Treasury is now 52. Military pressure is now 32.",
      },
      {
        turn: 10,
        eventId: "prisoner-plea",
        publicSentiment: 48,
        politicalStability: 72,
        treasury: 52,
        militaryPressure: 32,
        stateDeltaSummary:
          "Public sentiment rose to 48. Political stability shifted to 72. Treasury is now 52. Military pressure is now 32.",
      },
    ]);
  });
});
