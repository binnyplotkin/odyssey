import { beforeEach, describe, expect, it } from "vitest";
import { getWorldDefinitions } from "@/data/worlds";
import { createSimulationService } from "../service";

describe("simulation service", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  it("starts a session from the static world pack", async () => {
    const service = createSimulationService(getWorldDefinitions());
    const worlds = await service.listWorlds();
    const session = await service.startSession(worlds[0].id, worlds[0].roles[0].id);

    expect(session.worldId).toBe(worlds[0].id);
    expect(session.currentStateVersion).toBe(1);
    expect(session.state.turnCount).toBe(0);
  });

  it("processes a turn and advances state", async () => {
    const service = createSimulationService(getWorldDefinitions());
    const worlds = await service.listWorlds();
    const session = await service.startSession(worlds[0].id, worlds[0].roles[0].id);
    const result = await service.processTurn(session.id, {
      mode: "text",
      text: "Show the prisoner mercy and send grain to the quarter.",
      clientTimestamp: new Date().toISOString(),
    });

    expect(result.session.currentStateVersion).toBe(2);
    expect(result.turn.result.visibleState.publicSentiment).toBeGreaterThan(
      session.state.publicSentiment,
    );
    expect(result.turn.result.narration.length).toBeGreaterThan(0);
  });

  it("streams text deltas during turn processing", async () => {
    const service = createSimulationService(getWorldDefinitions());
    const worlds = await service.listWorlds();
    const session = await service.startSession(worlds[0].id, worlds[0].roles[0].id);
    const deltas: string[] = [];

    await service.processTurn(
      session.id,
      {
        mode: "text",
        text: "Negotiate with the merchants and reduce taxes.",
        clientTimestamp: new Date().toISOString(),
      },
      {
        onTextDelta: (delta) => {
          deltas.push(delta);
        },
      },
    );

    expect(deltas.join("")).not.toHaveLength(0);
  });

  it("replays a session deterministically", async () => {
    const service = createSimulationService(getWorldDefinitions());
    const worlds = await service.listWorlds();
    const session = await service.startSession(worlds[0].id, worlds[0].roles[0].id);

    await service.processTurn(session.id, {
      mode: "text",
      text: "Open court and hear the border reports.",
      clientTimestamp: new Date().toISOString(),
    });
    await service.processTurn(session.id, {
      mode: "text",
      text: "Send grain aid and ask the chancellor for a levy compromise.",
      clientTimestamp: new Date().toISOString(),
    });

    const replay = await service.replaySession(session.id);

    expect(replay.matches).toBe(true);
    expect(replay.mismatches).toEqual([]);
    expect(replay.turnCount).toBe(2);
  });
});
