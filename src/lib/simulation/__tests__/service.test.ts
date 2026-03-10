import { beforeEach, describe, expect, it } from "vitest";
import { listWorlds, processTurn, startSession } from "@/lib/simulation/service";

describe("simulation service", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
  });

  it("starts a session from the static world pack", async () => {
    const worlds = await listWorlds();
    const session = await startSession(worlds[0].id, worlds[0].roles[0].id);

    expect(session.worldId).toBe(worlds[0].id);
    expect(session.currentStateVersion).toBe(1);
    expect(session.state.turnCount).toBe(0);
  });

  it("processes a turn and advances state", async () => {
    const worlds = await listWorlds();
    const session = await startSession(worlds[0].id, worlds[0].roles[0].id);
    const result = await processTurn(session.id, {
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
});
