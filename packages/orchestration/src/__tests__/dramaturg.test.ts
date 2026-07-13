import { describe, expect, it } from "vitest";
import { createInitialSceneState, type Scene } from "../client";
import { buildDramaturgMessages, sanitizeDramaturgNote } from "../dramaturg";

const scene: Scene = {
  id: "test-scene",
  title: "Test Scene",
  description: "A small scene for dramaturg tests.",
  openingBeat: "The room waits.",
  defaultAmbience: null,
  objective: "Ada admits what the machine really measured.",
  characters: [
    {
      characterSlug: "ada",
      displayName: "Ada",
      voice: "ada-voice",
      blurb: "Precise, curious, wants the truth.",
      motivations: "protect the lab's secret while learning what the user knows",
      behaviorTriggers: [
        { condition: "the machine is mentioned", behavior: "deflect with a question" },
      ],
    },
    {
      characterSlug: "turing",
      displayName: "Turing",
      voice: "turing-voice",
      blurb: "Reserved, playful, hides concern.",
    },
  ],
};

describe("buildDramaturgMessages", () => {
  it("renders objective, authored intentions, dialogue, and the previous note", () => {
    const request = buildDramaturgMessages({
      scene,
      sceneState: createInitialSceneState(scene),
      recentTurns: [
        { speakerSlug: "user", text: "What did the machine measure?" },
        { speakerSlug: "ada", speakerName: "Ada", text: "Why do you ask?" },
      ],
      previousNote: "Ada is stonewalling; give Turing an opening.",
    });

    expect(request.system).toContain("DRAMATURG");
    expect(request.system).toContain("do NOT write dialogue");
    expect(request.user).toContain("Objective: Ada admits what the machine really measured.");
    expect(request.user).toContain("wants: protect the lab's secret");
    expect(request.user).toContain("will: deflect with a question (when the machine is mentioned)");
    expect(request.user).toContain("Ada: Why do you ask?");
    expect(request.user).toContain("Your previous note: Ada is stonewalling; give Turing an opening.");
  });

  it("omits objective/previous-note lines when absent", () => {
    const plain: Scene = { ...scene, objective: undefined };
    const request = buildDramaturgMessages({
      scene: plain,
      sceneState: createInitialSceneState(plain),
      recentTurns: [],
    });
    expect(request.user).not.toContain("Objective:");
    expect(request.user).not.toContain("previous note");
    expect(request.user).toContain("(no dialogue yet)");
  });
});

describe("sanitizeDramaturgNote", () => {
  it("strips fences, labels, and wrapping quotes; collapses whitespace", () => {
    expect(
      sanitizeDramaturgNote('```\nDirector\'s note: "Press  Ada\nnow."\n```'),
    ).toBe("Press Ada now.");
  });

  it("returns null for empty output", () => {
    expect(sanitizeDramaturgNote("   ")).toBeNull();
    expect(sanitizeDramaturgNote('""')).toBeNull();
  });

  it("caps long notes at a sentence boundary", () => {
    const first = "Sarah's laugh has landed and Abraham has told the story of the stars twice already. ".repeat(2);
    const note = sanitizeDramaturgNote(first + "x".repeat(400));
    expect(note!.length).toBeLessThanOrEqual(300);
    expect(note!.endsWith(".")).toBe(true);
  });
});
