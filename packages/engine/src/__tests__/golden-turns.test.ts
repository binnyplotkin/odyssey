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
      morale: number;
      stability: number;
      resources: number;
      pressure: number;
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
        morale: result.turn.result.visibleState.morale!,
        stability: result.turn.result.visibleState.stability!,
        resources: result.turn.result.visibleState.resources!,
        pressure: result.turn.result.visibleState.pressure!,
        stateDeltaSummary: result.turn.stateDeltaSummary,
      });
    }

    expect(progression).toEqual([
      {
        turn: 1,
        eventId: "empty-granaries",
        morale: 52,
        stability: 64,
        resources: 47,
        pressure: 41,
        stateDeltaSummary:
          "Morale rose to 52. Stability shifted to 64. Resources now 47. Pressure is now 41.",
      },
      {
        turn: 2,
        eventId: "prisoner-plea",
        morale: 56,
        stability: 65,
        resources: 47,
        pressure: 41,
        stateDeltaSummary:
          "Morale rose to 56. Stability shifted to 65. Resources now 47. Pressure is now 41.",
      },
      {
        turn: 3,
        eventId: "prisoner-plea",
        morale: 56,
        stability: 65,
        resources: 52,
        pressure: 41,
        stateDeltaSummary:
          "Morale rose to 56. Stability shifted to 65. Resources now 52. Pressure is now 41.",
      },
      {
        turn: 4,
        eventId: "prisoner-plea",
        morale: 55,
        stability: 67,
        resources: 52,
        pressure: 36,
        stateDeltaSummary:
          "Morale rose to 55. Stability shifted to 67. Resources now 52. Pressure is now 36.",
      },
      {
        turn: 5,
        eventId: "prisoner-plea",
        morale: 55,
        stability: 67,
        resources: 52,
        pressure: 41,
        stateDeltaSummary:
          "Morale rose to 55. Stability shifted to 67. Resources now 52. Pressure is now 41.",
      },
      {
        turn: 6,
        eventId: "prisoner-plea",
        morale: 54,
        stability: 69,
        resources: 57,
        pressure: 38,
        stateDeltaSummary:
          "Morale rose to 54. Stability shifted to 69. Resources now 57. Pressure is now 38.",
      },
      {
        turn: 7,
        eventId: "prisoner-plea",
        morale: 50,
        stability: 68,
        resources: 57,
        pressure: 38,
        stateDeltaSummary:
          "Morale fell to 50. Stability shifted to 68. Resources now 57. Pressure is now 38.",
      },
      {
        turn: 8,
        eventId: "prisoner-plea",
        morale: 50,
        stability: 68,
        resources: 52,
        pressure: 38,
        stateDeltaSummary:
          "Morale rose to 50. Stability shifted to 68. Resources now 52. Pressure is now 38.",
      },
      {
        turn: 9,
        eventId: "empty-granaries",
        morale: 48,
        stability: 72,
        resources: 52,
        pressure: 32,
        stateDeltaSummary:
          "Morale rose to 48. Stability shifted to 72. Resources now 52. Pressure is now 32.",
      },
      {
        turn: 10,
        eventId: "prisoner-plea",
        morale: 48,
        stability: 72,
        resources: 52,
        pressure: 32,
        stateDeltaSummary:
          "Morale rose to 48. Stability shifted to 72. Resources now 52. Pressure is now 32.",
      },
    ]);
  });
});
