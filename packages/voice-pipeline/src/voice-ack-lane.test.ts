import { describe, expect, it } from "vitest";
import { isStageDirection } from "./stage-direction";
import { selectVoiceAck } from "./voice-ack-lane";

describe("isStageDirection", () => {
  it("matches whole-span parenthesized and bracketed directions", () => {
    expect(isStageDirection("(No reply needed)")).toBe(true);
    expect(isStageDirection(" (No reply needed) ")).toBe(true);
    expect(isStageDirection("(No reply needed).")).toBe(true);
    expect(isStageDirection("[a pause]")).toBe(true);
    expect(isStageDirection("(The user has gone quiet.)")).toBe(true);
  });

  it("does not match real speech, mixed spans, or nested brackets", () => {
    expect(isStageDirection("I hear you. What brings you to seek me today?")).toBe(false);
    expect(isStageDirection("[a pause] She's known the whole of my life.")).toBe(false);
    expect(isStageDirection("She laughed (behind the tent) and so did I.")).toBe(false);
    expect(isStageDirection("((weird))")).toBe(false);
    expect(isStageDirection("")).toBe(false);
  });
});

describe("selectVoiceAck", () => {
  const base = {
    enabled: true,
    characterTitle: "Abraham",
    selectedPages: [
      { page: { slug: "sarah", title: "Sarah" } },
      { page: { slug: "abraham-voice-identity", title: "Abraham's voice and manner" } },
    ],
  };

  it("never acks a stage-direction message (proactive silence sentinel)", () => {
    expect(selectVoiceAck({ ...base, message: "(The user has gone quiet.)" })).toBeNull();
    expect(selectVoiceAck({ ...base, message: "[the wanderer says nothing]" })).toBeNull();
  });

  it("still acks real user speech", () => {
    expect(selectVoiceAck({ ...base, message: "Tell me what happened on the mountain." }))
      .toBe("I can speak to that.");
    expect(selectVoiceAck({ ...base, message: "Tell me about Sarah." }))
      .toBe("Yes, I can speak of Sarah.");
  });

  it("stays quiet when disabled or trivial", () => {
    expect(selectVoiceAck({ ...base, enabled: false, message: "Tell me about Sarah." })).toBeNull();
    expect(selectVoiceAck({ ...base, message: "hello" })).toBeNull();
  });

  it("never acks channel checks — the real reply is the acknowledgment", () => {
    expect(selectVoiceAck({ ...base, message: "Can you hear me?" })).toBeNull();
    expect(selectVoiceAck({ ...base, message: "Hello? Do you hear me?" })).toBeNull();
    expect(selectVoiceAck({ ...base, message: "Are you there?" })).toBeNull();
    expect(selectVoiceAck({ ...base, message: "testing, testing" })).toBeNull();
    expect(selectVoiceAck({ ...base, message: "Is this thing on?" })).toBeNull();
  });

  it("uses a thinking noise for direct questions, not a topical ack", () => {
    expect(selectVoiceAck({ ...base, message: "Why did you build altars wherever you went?" }))
      .toBe("Hm — let me think.");
    expect(selectVoiceAck({ ...base, message: "What do you fear most" }))
      .toBe("Hm — let me think.");
    // Statements and "tell me…" prompts keep the topical ack.
    expect(selectVoiceAck({ ...base, message: "I've heard stories that you hold an answer for me." }))
      .toBe("I can speak to that.");
  });
});
