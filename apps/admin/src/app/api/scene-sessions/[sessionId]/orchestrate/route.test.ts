import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "@odyssey/types";

// Store + dependency spies. The orchestrate route's single-character
// fast-path must synthesize the decision WITHOUT touching the orchestrator
// executor, so we spy on resolveOrchestratorExecutor to assert it's skipped.
const getSession = vi.hoisted(() => vi.fn(async () => null as unknown));
const appendEvent = vi.hoisted(() =>
  vi.fn(async (_event: Record<string, unknown>) => {}),
);
const updateCurrentScene = vi.hoisted(() => vi.fn(async () => {}));
const resolveScene = vi.hoisted(() => vi.fn());
const resolveOrchestratorExecutor = vi.hoisted(() => vi.fn());

vi.mock("@odyssey/db", () => ({
  getSceneSessionStore: () => ({ getSession, appendEvent, updateCurrentScene }),
}));

vi.mock("@/lib/scene-orchestration", () => ({ resolveScene }));

vi.mock("@/lib/orchestrator-executor", () => ({ resolveOrchestratorExecutor }));

import { POST } from "./route";

function soloScene(slug = "abraham"): Scene {
  return {
    id: `character-sandbox:${slug}`,
    title: `${slug} sandbox`,
    description: "A live single-character sandbox.",
    characters: [
      {
        characterSlug: slug,
        displayName: "Abraham",
        voice: slug,
        blurb: "The authored character under test.",
      },
    ],
    openingBeat: "Abraham is ready and waiting for the user to begin.",
    defaultAmbience: null,
    narratorVoice: "fable",
  };
}

function duoScene(): Scene {
  return {
    id: "scene:dinner",
    title: "Dinner at Mamre",
    description: "Two characters share a meal.",
    characters: [
      { characterSlug: "abraham", displayName: "Abraham", voice: "abraham", blurb: "Host." },
      { characterSlug: "sarah", displayName: "Sarah", voice: "sarah", blurb: "Guest." },
    ],
    openingBeat: "The meal begins.",
    defaultAmbience: null,
    narratorVoice: "fable",
  };
}

const routeCtx = { params: Promise.resolve({ sessionId: "session_1" }) };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/scene-sessions/session_1/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function traceEventNames(payload: { trace: { events: Array<{ name: string }> } }) {
  return payload.trace.events.map((e) => e.name);
}

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(null);
  appendEvent.mockReset().mockResolvedValue(undefined);
  updateCurrentScene.mockReset().mockResolvedValue(undefined);
  resolveScene.mockReset();
  resolveOrchestratorExecutor.mockReset();
});

describe("orchestrate route — single-character fast-path", () => {
  it("synthesizes a speak decision without invoking the orchestrator LLM", async () => {
    resolveScene.mockResolvedValue(soloScene("abraham"));

    const res = await POST(
      request({ sceneId: "character-sandbox:abraham", lastUserMessage: "Peace be with you." }),
      routeCtx,
    );
    const payload = await res.json();

    expect(payload.decision).toMatchObject({ action: "speak", speakerId: "abraham" });
    expect(payload.orchestrator).toEqual({ provider: "fastpath", model: "single-character" });
    // The whole point: the blocking orchestrator LLM call is skipped.
    expect(resolveOrchestratorExecutor).not.toHaveBeenCalled();
    const names = traceEventNames(payload);
    expect(names).toContain("orchestrate.fastpath");
    expect(names).not.toContain("orchestrate.llm.start");
    // Persistence is preserved — events + current_scene still written.
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent.mock.calls[0][0]).toMatchObject({ type: "scene.decision.speak" });
    expect(updateCurrentScene).toHaveBeenCalledTimes(1);
  });

  it("waits for the user when no user message has arrived yet", async () => {
    resolveScene.mockResolvedValue(soloScene("abraham"));

    const res = await POST(request({ sceneId: "character-sandbox:abraham" }), routeCtx);
    const payload = await res.json();

    expect(payload.decision.action).toBe("wait-for-user");
    expect(resolveOrchestratorExecutor).not.toHaveBeenCalled();
    expect(appendEvent.mock.calls[0][0]).toMatchObject({ type: "scene.decision.wait" });
  });

  it("treats a trailing user turn as user input even without lastUserMessage", async () => {
    resolveScene.mockResolvedValue(soloScene("abraham"));

    const res = await POST(
      request({
        sceneId: "character-sandbox:abraham",
        recentTurns: [{ speakerSlug: "user", speakerName: "You", text: "Tell me of Sarah." }],
      }),
      routeCtx,
    );
    const payload = await res.json();

    expect(payload.decision).toMatchObject({ action: "speak", speakerId: "abraham" });
    expect(resolveOrchestratorExecutor).not.toHaveBeenCalled();
  });

  it("falls through to the real orchestrator for multi-character scenes", async () => {
    resolveScene.mockResolvedValue(duoScene());
    resolveOrchestratorExecutor.mockReturnValue({
      executor: null,
      reason: "No orchestrator provider key configured. Set CEREBRAS_API_KEY or GROQ_API_KEY.",
    });

    const res = await POST(
      request({ sceneId: "scene:dinner", lastUserMessage: "Hello to you both." }),
      routeCtx,
    );
    const payload = await res.json();

    expect(resolveOrchestratorExecutor).toHaveBeenCalledTimes(1);
    expect(traceEventNames(payload)).not.toContain("orchestrate.fastpath");
    expect(payload.degraded).toBe(true);
  });
});
