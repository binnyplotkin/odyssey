import { describe, expect, it, vi } from "vitest";
import {
  buildSceneDecisionRequest,
  createInitialSceneState,
  getScene,
} from "@odyssey/orchestration/client";
import { resolveOrchestratorExecutor } from "./orchestrator-executor";

function decisionRequest() {
  const scene = getScene("abrahams-tent");
  expect(scene).not.toBeNull();
  if (!scene) throw new Error("missing test scene");

  return buildSceneDecisionRequest({
    scene,
    sceneState: createInitialSceneState(scene),
    recentTurns: [],
  });
}

describe("orchestrator executor", () => {
  it("reports no executor when no provider key is configured", () => {
    const resolution = resolveOrchestratorExecutor({
      provider: "",
      cerebrasApiKey: "",
      groqApiKey: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(resolution.executor).toBeNull();
    expect(resolution.reason).toBe(
      "No orchestrator provider key configured. Set CEREBRAS_API_KEY or GROQ_API_KEY.",
    );
  });

  it("defaults to Cerebras when both provider keys are configured", () => {
    const resolution = resolveOrchestratorExecutor({
      cerebrasApiKey: "cerebras-key",
      groqApiKey: "groq-key",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(resolution.executor).toMatchObject({
      provider: "cerebras",
      model: "qwen-3-235b-a22b-instruct-2507",
    });
  });

  it("returns a provider-specific missing key reason", () => {
    const resolution = resolveOrchestratorExecutor({
      provider: "groq",
      cerebrasApiKey: "cerebras-key",
      groqApiKey: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(resolution.executor).toBeNull();
    expect(resolution.reason).toBe("GROQ_API_KEY not configured");
  });

  it("calls Groq with the structured-output chat payload", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "narrate",
                narration: "The fire snaps in the doorway.",
                beat: "A hush settles over the camp.",
                ambience: "tent-evening",
              }),
            },
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const resolution = resolveOrchestratorExecutor({
      provider: "groq",
      groqApiKey: "groq-key",
      groqModel: "openai/gpt-oss-20b",
      fetchImpl: fetchMock,
    });

    expect(resolution.executor).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-20b",
    });
    const decision = await resolution.executor?.execute(decisionRequest());

    expect(decision).toEqual({
      action: "narrate",
      narration: "The fire snaps in the doorway.",
      beat: "A hush settles over the camp.",
      ambience: "tent-evening",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer groq-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(
      (fetchMock as unknown as { mock: { calls: Array<[string, { body: string }]> } })
        .mock.calls[0][1].body,
    );
    expect(body).toMatchObject({
      model: "openai/gpt-oss-20b",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "orchestrator_decision",
          strict: true,
        },
      },
      max_completion_tokens: 256,
    });
    expect(body.messages[0].role).toBe("system");
  });
});
