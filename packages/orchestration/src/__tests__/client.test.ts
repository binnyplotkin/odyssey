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

// The Phase-3 roster variant: same cast, plus placed sounds the director
// can cue (a bed + a one-shot).
const sceneWithSounds: Scene = {
  ...scene,
  id: "test-scene-sounds",
  sounds: [
    {
      slug: "room-tone",
      name: "Room tone",
      description: "Low room hum, unremarkable.",
      role: "bed",
      loopable: true,
    },
    {
      slug: "glass-shatter",
      name: "Glass shatter",
      description: "A glass breaks nearby.",
      role: "oneshot",
      triggerHint: "when something breaks",
      loopable: false,
    },
  ],
};

// The authored-intention variant: character goals + triggers, a scene
// objective, and an insistent drive.
const sceneWithIntent: Scene = {
  ...scene,
  id: "test-scene-intent",
  objective: "Ada admits what the machine really measured.",
  drive: "insistent",
  characters: [
    {
      ...scene.characters[0], // ada
      roleInScene: "reluctant witness",
      motivations: "protect the lab's secret while learning what the user knows",
      emotionalBaseline: "guarded",
      behaviorTriggers: [
        { condition: "the machine is mentioned", behavior: "deflect with a question" },
      ],
    },
    scene.characters[1], // turing — no intention authored
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

  it("renders the audio roster in the director prompt (and omits it for legacy scenes)", () => {
    const request = buildSceneDecisionRequest({
      scene: sceneWithSounds,
      sceneState: createInitialSceneState(sceneWithSounds),
    });
    const system = request.messages[0].content;
    expect(system).toContain("Sounds available (cue by id):");
    expect(system).toContain('id="room-tone"');
    expect(system).toContain('id="glass-shatter"');
    expect(system).toContain("(cue: when something breaks)");
    expect(system).toContain("`ambience` must be one of the bed ids above");

    const legacy = buildSceneDecisionRequest({
      scene,
      sceneState: createInitialSceneState(scene),
    });
    expect(legacy.messages[0].content).not.toContain("Sounds available");
  });

  it("keeps the current bed when the director cues a non-roster ambience", () => {
    const initial = createInitialSceneState(sceneWithSounds);
    const result = resolveSceneDecision(
      { scene: sceneWithSounds, sceneState: initial },
      { action: "speak", speakerId: "ada", beat: "Ada answers.", ambience: "hallucinated-bed" },
    );

    expect(result.degraded).toBe(false); // the turn itself still lands
    expect(result.sceneState.ambience).toBe("room-tone"); // unchanged
    expect(result.reason).toBe("ambience-not-in-roster:hallucinated-bed");

    // `ambience: null` means "no change", NOT silence — the strict JSON
    // schema forces the model to emit null for every unused field, so
    // nulls are stripped before parsing (stripNullOptionalDecisionFields).
    const noChange = resolveSceneDecision(
      { scene: sceneWithSounds, sceneState: initial },
      { action: "wait-for-user", ambience: null },
    );
    expect(noChange.sceneState.ambience).toBe("room-tone");
    expect(noChange.reason).toBeUndefined();
  });

  it("filters sfx cues to roster one-shots", () => {
    const initial = createInitialSceneState(sceneWithSounds);
    const result = resolveSceneDecision(
      { scene: sceneWithSounds, sceneState: initial },
      {
        action: "speak",
        speakerId: "ada",
        beat: "Ada reacts to the crash.",
        sfx: [
          { id: "glass-shatter", at: "now" },
          { id: "not-a-sound", at: "with-speaker" },
          { id: "room-tone", at: "now" }, // a bed is not cueable as sfx
        ],
      },
    );

    expect(result.decision.sfx).toEqual([{ id: "glass-shatter", at: "now" }]);
    expect(result.reason).toBe("sfx-not-in-roster:not-a-sound,room-tone");
    // The sanitized decision is what lands in the persisted event too.
    expect(
      (result.events[0].payload as { decision: { sfx: unknown } }).decision.sfx,
    ).toEqual([{ id: "glass-shatter", at: "now" }]);
  });

  it("passes audio cues through untouched for legacy scenes without a roster", () => {
    const initial = createInitialSceneState(scene);
    const result = resolveSceneDecision(
      { scene, sceneState: initial },
      {
        action: "speak",
        speakerId: "ada",
        ambience: "free-string-bed",
        sfx: [{ id: "anything", at: "now" }],
      },
    );
    expect(result.sceneState.ambience).toBe("free-string-bed");
    expect(result.decision.sfx).toEqual([{ id: "anything", at: "now" }]);
    expect(result.reason).toBeUndefined();
  });

  it("renders authored intention in the director prompt (and omits it for plain scenes)", () => {
    const request = buildSceneDecisionRequest({
      scene: sceneWithIntent,
      sceneState: createInitialSceneState(sceneWithIntent),
    });
    const system = request.messages[0].content;
    expect(system).toContain("This scene is driving toward: Ada admits what the machine really measured.");
    expect(system).toContain("wants: protect the lab's secret while learning what the user knows");
    expect(system).toContain("role: reluctant witness");
    expect(system).toContain("baseline: guarded");
    expect(system).toContain("will: deflect with a question (when the machine is mentioned)");
    expect(system).toContain("Write `beat`s in service of what the speaker WANTS");
    expect(system).toContain("Press actively");

    const plain = buildSceneDecisionRequest({
      scene,
      sceneState: createInitialSceneState(scene),
    });
    const plainSystem = plain.messages[0].content;
    expect(plainSystem).not.toContain("driving toward");
    expect(plainSystem).not.toContain("wants:");
    expect(plainSystem).not.toContain("Press actively");
    expect(plainSystem).not.toContain("Follow the user's lead");
  });

  it("threads the speaker's agenda into the turn directive", () => {
    const state = createInitialSceneState(sceneWithIntent);
    const request = buildSpeakerTurnRequest({
      scene: sceneWithIntent,
      sceneState: state,
      decision: { action: "speak", speakerId: "ada", beat: "Deflect, then probe." },
      recentTurns: [{ speakerSlug: "user", text: "What did the machine measure?" }],
    });
    expect(request?.promptChunk).toBe(
      [
        "Direction: Deflect, then probe.",
        "Your agenda in this scene: protect the lab's secret while learning what the user knows",
        "When the machine is mentioned: deflect with a question",
      ].join("\n"),
    );

    // No authored intention → directive is just the direction (current behavior).
    const plainRequest = buildSpeakerTurnRequest({
      scene,
      sceneState: createInitialSceneState(scene),
      decision: { action: "speak", speakerId: "ada", beat: "Answer plainly." },
      recentTurns: [{ speakerSlug: "user", text: "Hello?" }],
    });
    expect(plainRequest?.promptChunk).toBe("Direction: Answer plainly.");
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
      // History excludes the turn lifted into `message` ("Ask Ada.") so it isn't fed
      // twice (here AND as the appended user message downstream).
      history: [{ role: "user", content: "What happened here?" }],
      // Director `beat` framed as "Direction:"; `sceneCue` is the optional scene note.
      promptChunk: "Direction: Ada responds to the visitor.\nScene note: Keep it quiet.",
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
