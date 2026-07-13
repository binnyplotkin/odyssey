import { describe, expect, it } from "vitest";
import { createInitialSceneState, type Scene } from "../client";
import {
  buildDramaturgMessages,
  expandLandedBeats,
  matchArcLabel,
  parseDramaturgReflection,
  sanitizeDramaturgNote,
} from "../dramaturg";

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

describe("arc in the dramaturg review", () => {
  const arcScene: Scene = {
    ...scene,
    arc: [
      { label: "The machine is named", summary: "someone says its name aloud" },
      { label: "Ada's admission" },
    ],
  };

  it("renders the arc with markers and the LANDED instruction", () => {
    const state = {
      ...createInitialSceneState(arcScene),
      arcLanded: ["The machine is named"],
    };
    const request = buildDramaturgMessages({
      scene: arcScene,
      sceneState: state,
      recentTurns: [],
    });
    expect(request.user).toContain("[landed] The machine is named - someone says its name aloud");
    expect(request.user).toContain("[next]   Ada's admission");
    expect(request.system).toContain("LANDED: <beat label only, copied verbatim");
  });

  it("omits the arc block and instruction for arc-less scenes", () => {
    const request = buildDramaturgMessages({
      scene,
      sceneState: createInitialSceneState(scene),
      recentTurns: [],
    });
    expect(request.user).not.toContain("Scene arc");
    expect(request.system).not.toContain("LANDED:");
  });
});

describe("parseDramaturgReflection", () => {
  it("splits the note from LANDED lines regardless of position", () => {
    const { note, landed } = parseDramaturgReflection(
      "LANDED: The machine is named\nAda is cornered; press the admission now.\nLANDED: Ada's admission",
    );
    expect(note).toBe("Ada is cornered; press the admission now.");
    expect(landed).toEqual(["The machine is named", "Ada's admission"]);
  });

  it("handles note-only and landed-only replies", () => {
    expect(parseDramaturgReflection("Just a note.")).toEqual({
      note: "Just a note.",
      landed: [],
    });
    expect(parseDramaturgReflection("landed: Something Happened")).toEqual({
      note: null,
      landed: ["Something Happened"],
    });
  });
});

describe("matchArcLabel", () => {
  const labels = ["The promise is spoken aloud", "Sarah's laugh — and the denial"];

  it("matches exact (case-insensitive) labels", () => {
    expect(matchArcLabel("the promise is spoken aloud", labels)).toBe(
      "The promise is spoken aloud",
    );
  });

  it("tolerates a copied label-with-summary suffix", () => {
    expect(
      matchArcLabel(
        "The promise is spoken aloud - The promise of a son is said where Sarah can hear it.",
        labels,
      ),
    ).toBe("The promise is spoken aloud");
  });

  it("rejects prefixes that aren't separator-bounded and unknown labels", () => {
    expect(matchArcLabel("The promise is spoken aloudly", labels)).toBeNull();
    expect(matchArcLabel("Something else entirely", labels)).toBeNull();
  });
});

describe("expandLandedBeats", () => {
  const arc = [
    "The stranger is tested",
    "The promise is spoken aloud",
    "Sarah's laugh — and the denial",
  ];

  it("landing a later beat lands every earlier beat, in arc order", () => {
    expect(expandLandedBeats(["The promise is spoken aloud"], arc)).toEqual([
      "The stranger is tested",
      "The promise is spoken aloud",
    ]);
    expect(expandLandedBeats(["Sarah's laugh — and the denial"], arc)).toEqual(arc);
  });

  it("is a no-op for the first beat and for empty input", () => {
    expect(expandLandedBeats(["The stranger is tested"], arc)).toEqual([
      "The stranger is tested",
    ]);
    expect(expandLandedBeats([], arc)).toEqual([]);
  });

  it("matches case-insensitively and ignores labels not in the arc", () => {
    expect(
      expandLandedBeats(["the PROMISE is spoken aloud", "not a real beat"], arc),
    ).toEqual(["The stranger is tested", "The promise is spoken aloud"]);
  });

  it("merges prior state with a new later landing", () => {
    expect(
      expandLandedBeats(
        ["The stranger is tested", "Sarah's laugh — and the denial"],
        arc,
      ),
    ).toEqual(arc);
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
