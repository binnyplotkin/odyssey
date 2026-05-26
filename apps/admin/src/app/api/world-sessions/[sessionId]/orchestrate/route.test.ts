import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSceneSessionSnapshot,
  createInitialSceneState,
  getScene,
} from "@odyssey/orchestration/client";
import { POST } from "./route";

const appendEvent = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const updateCurrentScene = vi.hoisted(() => vi.fn());
const getCharacterBySlug = vi.hoisted(() => vi.fn());
const getCharacterById = vi.hoisted(() => vi.fn());
const getVoiceById = vi.hoisted(() => vi.fn());

vi.mock("@odyssey/db", () => ({
  getCharacterStore: () => ({
    getBySlug: getCharacterBySlug,
    getById: getCharacterById,
  }),
  getVoiceStore: () => ({
    getById: getVoiceById,
  }),
  getWorldSessionStore: () => ({
    appendEvent,
    getSession,
    updateCurrentScene,
  }),
}));

const routeCtx = {
  params: Promise.resolve({ sessionId: "session_1" }),
};

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/world-sessions/session_1/orchestrate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("world-session orchestrate route", () => {
  beforeEach(() => {
    vi.stubEnv("ORCHESTRATOR_PROVIDER", "");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    getSession.mockResolvedValue(null);
  });

  afterEach(() => {
    appendEvent.mockReset();
    getSession.mockReset();
    updateCurrentScene.mockReset();
    getCharacterBySlug.mockReset();
    getCharacterById.mockReset();
    getVoiceById.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("degrades without a configured orchestrator provider key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ sceneId: "abrahams-tent" }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(updateCurrentScene).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      decision: { action: "wait-for-user", ambience: "tent-evening" },
      sceneState: {
        sceneId: "abrahams-tent",
        beat: "The strangers have just left. Sarah's laughter still hangs in the air. The user has arrived at the camp.",
        turnIndex: 0,
      },
      sceneMemory: [],
      degraded: true,
      reason:
        "No orchestrator provider key configured. Set CEREBRAS_API_KEY or GROQ_API_KEY.",
    });
  });

  it("can route orchestration through Groq", async () => {
    vi.stubEnv("ORCHESTRATOR_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "speak",
                speakerId: "sarah",
                beat: "Sarah answers from the tent flap.",
                ambience: "tent-evening",
              }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ sceneId: "abrahams-tent" }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.degraded).toBeUndefined();
    expect(payload.orchestrator).toEqual({
      provider: "groq",
      model: "openai/gpt-oss-120b",
    });
    expect(payload.decision).toMatchObject({
      action: "speak",
      speakerId: "sarah",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"max_completion_tokens":1024'),
      }),
    );
  });

  it("persists a degraded scene decision when the provider call fails", async () => {
    vi.stubEnv("ORCHESTRATOR_PROVIDER", "groq");
    vi.stubEnv("GROQ_API_KEY", "test-groq-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "max completion tokens reached" } },
          { status: 400 },
        ),
      ),
    );

    const response = await POST(
      request({ sceneId: "abrahams-tent" }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.degraded).toBe(true);
    expect(payload.decision).toEqual({
      action: "wait-for-user",
      ambience: "tent-evening",
    });
    expect(payload.sceneState).toMatchObject({
      sceneId: "abrahams-tent",
      turnIndex: 1,
    });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        type: "scene.decision.wait",
        source: "orchestration",
        payload: expect.objectContaining({
          degraded: true,
          reason: expect.stringContaining("Groq 400"),
        }),
      }),
    );
    expect(updateCurrentScene).toHaveBeenCalledWith({
      sessionId: "session_1",
      currentScene: expect.objectContaining({
        sceneId: "abrahams-tent",
        sceneState: expect.objectContaining({ turnIndex: 1 }),
      }),
    });
  });

  it("resolves dynamic character sandbox scenes", async () => {
    getCharacterBySlug.mockResolvedValue({
      id: "char_1",
      slug: "miriam",
      title: "Miriam",
      summary: "Prophet and musician under live sandbox test.",
      voiceId: "voice_1",
    });
    getVoiceById.mockResolvedValue({ slug: "miriam-voice" });

    const response = await POST(
      request({
        sceneId: "character-sandbox:miriam",
        recentTurns: [
          { speakerSlug: "user", speakerName: "User", text: "What do you see?" },
        ],
        lastUserMessage: "What do you see?",
      }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getCharacterBySlug).toHaveBeenCalledWith("miriam");
    expect(getVoiceById).toHaveBeenCalledWith("voice_1");
    expect(payload).toMatchObject({
      decision: { action: "wait-for-user", ambience: null },
      sceneState: {
        sceneId: "character-sandbox:miriam",
        presentCharacterSlugs: ["miriam"],
        ambience: null,
        turnIndex: 0,
      },
      sceneMemory: ["User: What do you see?"],
      degraded: true,
    });
  });

  it("falls back safely when the model returns malformed JSON shape", async () => {
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({}) } }],
        }),
      ),
    );

    const response = await POST(
      request({ sceneId: "abrahams-tent" }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.degraded).toBe(true);
    expect(payload.reason).toBe("invalid-decision-shape");
    expect(payload.decision).toEqual({
      action: "wait-for-user",
      ambience: "tent-evening",
    });
    expect(payload.sceneState).toMatchObject({
      sceneId: "abrahams-tent",
      turnIndex: 1,
    });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        type: "scene.decision.wait",
        source: "orchestration",
        payload: expect.objectContaining({
          degraded: true,
          reason: "invalid-decision-shape",
        }),
      }),
    );
    expect(updateCurrentScene).toHaveBeenCalledWith({
      sessionId: "session_1",
      currentScene: expect.objectContaining({
        version: 1,
        sceneId: "abrahams-tent",
        sceneState: expect.objectContaining({ turnIndex: 1 }),
        sceneMemory: [],
      }),
    });
  });

  it("falls back safely when the model chooses an unknown speaker", async () => {
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "speak",
                  speakerId: "melchizedek",
                  beat: "A stranger speaks from outside the roster.",
                }),
              },
            },
          ],
        }),
      ),
    );

    const response = await POST(
      request({ sceneId: "abrahams-tent" }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.degraded).toBe(true);
    expect(payload.reason).toBe("unknown-speaker:melchizedek");
    expect(payload.decision.action).toBe("wait-for-user");
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "scene.decision.wait",
        payload: expect.objectContaining({
          reason: "unknown-speaker:melchizedek",
        }),
      }),
    );
  });

  it("uses persisted scene state when the client omits sceneState", async () => {
    const scene = getScene("abrahams-tent");
    expect(scene).not.toBeNull();
    if (!scene) return;
    const persistedState = {
      ...createInitialSceneState(scene),
      beat: "Sarah has stepped into the doorway.",
      turnIndex: 7,
      lastSpeakerSlug: "abraham",
    };
    getSession.mockResolvedValue({
      id: "session_1",
      currentScene: buildSceneSessionSnapshot(persistedState, "2026-01-01T00:00:00.000Z"),
    });
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ action: "wait-for-user" }) } }],
        }),
      ),
    );

    const response = await POST(
      request({ sceneId: "abrahams-tent" }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sceneState).toMatchObject({
      beat: "Sarah has stepped into the doorway.",
      turnIndex: 8,
      lastSpeakerSlug: "abraham",
    });
    expect(updateCurrentScene).toHaveBeenCalledWith({
      sessionId: "session_1",
      currentScene: expect.objectContaining({
        sceneState: expect.objectContaining({ turnIndex: 8 }),
      }),
    });
  });

  it("persists scene memory folded from recent turns", async () => {
    getSession.mockResolvedValue({
      id: "session_1",
      currentScene: {
        version: 1,
        sceneId: "abrahams-tent",
        sceneState: {
          sceneId: "abrahams-tent",
          beat: "The strangers have just left. Sarah's laughter still hangs in the air. The user has arrived at the camp.",
          presentCharacterSlugs: ["abraham", "sarah"],
          ambience: "tent-evening",
          lastSpeakerSlug: null,
          turnIndex: 2,
        },
        sceneMemory: ["Abraham: The visitors promised Sarah a son."],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    vi.stubEnv("CEREBRAS_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ action: "wait-for-user" }) } }],
        }),
      ),
    );

    const response = await POST(
      request({
        sceneId: "abrahams-tent",
        recentTurns: [
          { speakerSlug: "user", speakerName: "Traveler", text: "Sarah, I heard you laugh." },
          { speakerSlug: "sarah", speakerName: "Sarah", text: "I did not laugh." },
        ],
      }),
      routeCtx,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sceneMemory).toEqual([
      "Abraham: The visitors promised Sarah a son.",
      "Traveler: Sarah, I heard you laugh.",
      "Sarah: I did not laugh.",
    ]);
    expect(updateCurrentScene).toHaveBeenCalledWith({
      sessionId: "session_1",
      currentScene: expect.objectContaining({
        sceneMemory: payload.sceneMemory,
      }),
    });
  });
});
