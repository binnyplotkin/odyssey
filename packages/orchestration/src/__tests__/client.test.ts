import { describe, expect, it } from "vitest";
import {
  buildSceneDecisionRequest,
  buildSceneSessionSnapshot,
  buildSpeakerTurnRequest,
  createInitialSceneState,
  readSceneMemoryFromSnapshot,
  readSceneStateFromSnapshot,
  resolveSceneDecision,
  updateSceneMemory,
  type Scene,
  getScene,
} from "../client";

const scene: Scene = {
  id: "test-scene",
  title: "Test Scene",
  description: "A small scene for orchestration tests.",
  openingBeat: "The room waits.",
  defaultAmbience: "room-tone",
  characters: [
    {
      characterSlug: "ada",
      displayName: "Ada",
      voice: "ada-voice",
      blurb: "Precise, curious, wants the truth.",
    },
    {
      characterSlug: "turing",
      displayName: "Turing",
      voice: "turing-voice",
      blurb: "Reserved, playful, hides concern.",
    },
  ],
};

describe("@odyssey/orchestration client", () => {
  it("creates initial scene state", () => {
    expect(createInitialSceneState(scene)).toEqual({
      sceneId: "test-scene",
      beat: "The room waits.",
      presentCharacterSlugs: ["ada", "turing"],
      ambience: "room-tone",
      lastSpeakerSlug: null,
      turnIndex: 0,
    });
  });

  it("round-trips persisted scene state snapshots", () => {
    const state = createInitialSceneState(scene);
    const snapshot = buildSceneSessionSnapshot(state, "2026-01-01T00:00:00.000Z");

    expect(snapshot).toEqual({
      version: 1,
      sceneId: "test-scene",
      sceneState: state,
      sceneMemory: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(readSceneStateFromSnapshot(snapshot, "test-scene")).toEqual(state);
    expect(readSceneStateFromSnapshot(state, "test-scene")).toEqual(state);
    expect(readSceneStateFromSnapshot(snapshot, "other-scene")).toBeNull();
  });

  it("folds recent turns into bounded scene memory", () => {
    const memory = updateSceneMemory({
      previousMemory: ["Ada: The machine hummed."],
      recentTurns: [
        { speakerSlug: "user", text: "What changed?" },
        { speakerSlug: "ada", speakerName: "Ada", text: "The pressure dropped." },
        { speakerSlug: "ada", speakerName: "Ada", text: "The pressure dropped." },
      ],
      maxEntries: 3,
    });

    expect(memory).toEqual([
      "Ada: The machine hummed.",
      "user: What changed?",
      "Ada: The pressure dropped.",
    ]);

    const snapshot = buildSceneSessionSnapshot(createInitialSceneState(scene), {
      updatedAt: "2026-01-01T00:00:00.000Z",
      sceneMemory: memory,
    });
    expect(readSceneMemoryFromSnapshot(snapshot, "test-scene")).toEqual(memory);
    expect(readSceneMemoryFromSnapshot(snapshot, "other-scene")).toEqual([]);
  });

  it("builds provider-ready scene decision messages", () => {
    const request = buildSceneDecisionRequest({
      scene,
      sceneState: createInitialSceneState(scene),
      recentTurns: [{ speakerSlug: "user", text: "Ada, what do you see?" }],
      sceneMemory: ["Turing warned Ada not to touch the relay."],
      lastUserMessage: "Ada, what do you see?",
    });

    expect(request.messages).toHaveLength(2);
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("Scene: \"Test Scene\"");
    expect(request.messages[0].content).toContain('slug="ada"');
    expect(request.messages[0].content).toContain("Scene memory");
    expect(request.trace.sceneMemoryCount).toBe(1);
    expect(request.messages[1].content).toContain("The user just said");
    expect(request.responseSchema.required).toEqual([
      "action",
      "speakerId",
      "beat",
      "sceneCue",
      "narration",
      "ambience",
      "sfx",
      "beatLabel",
    ]);
    expect(request.trace.sceneId).toBe("test-scene");
  });

  it("resolves speak/wait/narrate/end decisions into next state", () => {
    const initial = createInitialSceneState(scene);
    const speak = resolveSceneDecision(
      { scene, sceneState: initial },
      {
        action: "speak",
        speakerId: "ada",
        beat: "Ada answers.",
        ambience: "tense-room",
        beatLabel: "Ada takes focus",
      },
    );

    expect(speak.degraded).toBe(false);
    expect(speak.speakerSlug).toBe("ada");
    expect(speak.events[0].type).toBe("scene.decision.speak");
    expect(speak.events[0].payload).toMatchObject({
      action: "speak",
      speakerSlug: "ada",
    });
    expect(speak.sceneState).toMatchObject({
      beat: "Ada takes focus",
      ambience: "tense-room",
      lastSpeakerSlug: "ada",
      turnIndex: 1,
    });

    const wait = resolveSceneDecision(
      { scene, sceneState: speak.sceneState },
      { action: "wait-for-user" },
    );
    expect(wait.events[0].type).toBe("scene.decision.wait");
    expect(wait.sceneState.turnIndex).toBe(2);

    const narrate = resolveSceneDecision(
      { scene, sceneState: wait.sceneState },
      { action: "narrate", narration: "The light shifts." },
    );
    expect(narrate.degraded).toBe(false);
    expect(narrate.events[0].type).toBe("scene.decision.narrate");

    const end = resolveSceneDecision(
      { scene, sceneState: narrate.sceneState },
      { action: "end-scene" },
    );
    expect(end.events[0].type).toBe("scene.decision.end");
    expect(end.sceneState.turnIndex).toBe(4);
  });

  it("falls back safely on unknown speaker", () => {
    const result = resolveSceneDecision(
      { scene, sceneState: createInitialSceneState(scene) },
      { action: "speak", speakerId: "nobody" },
    );

    expect(result.degraded).toBe(true);
    expect(result.reason).toBe("unknown-speaker:nobody");
    expect(result.decision.action).toBe("wait-for-user");
    expect(result.events[0].payload).toMatchObject({
      degraded: true,
      reason: "unknown-speaker:nobody",
    });
  });

  it("builds a speaker turn request", () => {
    const state = createInitialSceneState(scene);
    const request = buildSpeakerTurnRequest({
      scene,
      sceneState: state,
      decision: {
        action: "speak",
        speakerId: "ada",
        beat: "Ada responds to the visitor.",
        sceneCue: "Keep it quiet.",
      },
      recentTurns: [
        { speakerSlug: "user", text: "What happened here?" },
        { speakerSlug: "turing", speakerName: "Turing", text: "Ask Ada." },
      ],
    });

    expect(request).toEqual({
      characterSlug: "ada",
      speakerName: "Ada",
      message: "Ask Ada.",
      history: [
        { role: "user", content: "What happened here?" },
        { role: "user", content: "Ask Ada." },
      ],
      promptChunk: "Scene direction (orchestrator): Keep it quiet.\nBeat: Ada responds to the visitor.",
      voiceSlug: "ada-voice",
    });
  });

  it("does not build a speaker turn for absent scene characters", () => {
    const state = {
      ...createInitialSceneState(scene),
      presentCharacterSlugs: ["turing"],
    };

    expect(
      buildSpeakerTurnRequest({
        scene,
        sceneState: state,
        decision: {
          action: "speak",
          speakerId: "ada",
          beat: "Ada tries to speak from outside the room.",
        },
        recentTurns: [],
      }),
    ).toBeNull();
  });

  it("keeps the Abraham's Tent orchestrator prompt stable", () => {
    const abrahamsTent = getScene("abrahams-tent");
    expect(abrahamsTent).not.toBeNull();
    if (!abrahamsTent) return;

    const request = buildSceneDecisionRequest({
      scene: abrahamsTent,
      sceneState: createInitialSceneState(abrahamsTent),
      recentTurns: [
        {
          speakerSlug: "user",
          speakerName: "Traveler",
          text: "Sarah, why did you laugh?",
        },
      ],
      lastUserMessage: "Sarah, why did you laugh?",
    });

    expect(request.messages).toMatchSnapshot("abrahams-tent-orchestrator-prompt");
  });
});
