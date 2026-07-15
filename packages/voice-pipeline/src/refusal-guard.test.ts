import { describe, expect, it } from "vitest";
import { isRefusalBoilerplate } from "./refusal-guard";

describe("isRefusalBoilerplate", () => {
  it.each([
    "I’m sorry, but I can’t help with that.",
    "I'm sorry, but I can't help with that.",
    "I am sorry, but I cannot help with that request.",
    "Sorry, I can't assist with that.",
    "I apologize, but I won't continue with this.",
    "I can't help with that.",
    "I cannot comply.",
    "I can’t assist with this request.",
    "I'm unable to help with that.",
    "I am not able to assist with this.",
    "I won't be able to help with that.",
    "  \"I'm sorry, but I can't help with that.\"  ",
  ])("flags assistant boilerplate: %s", (line) => {
    expect(isRefusalBoilerplate(line)).toBe(true);
  });

  it.each([
    "As an AI, I shouldn't weigh in on that.",
    "I'm an AI assistant, so I have to decline — but I can tell you about the covenant instead, which is honestly the more interesting story.",
    "I'm just a language model, friend.",
  ])("flags AI self-identification at any length: %s", (line) => {
    expect(isRefusalBoilerplate(line)).toBe(true);
  });

  it.each([
    // In-character declines that share surface words with boilerplate.
    "I cannot help you carry that burden, friend.",
    "I can't help wondering what brings you to my tent at this hour.",
    "I won't take that bait — sit, and speak plainly of what you seek.",
    "Destruction is not a gift I will receive; speak of it no more in my tent.",
    "I'm sorry for your loss, truly.",
    "Sorry — my ears are old. Say it once more.",
    "I cannot answer for the Lord; I can only tell you what I have seen.",
    // Long apology openers are doing character work.
    "I'm sorry, but I can't help thinking of the night He led me outside the tent and told me to count the stars, if I could count them at all.",
    // Empty / whitespace.
    "",
    "   ",
  ])("does not flag in-character lines: %s", (line) => {
    expect(isRefusalBoilerplate(line)).toBe(false);
  });
});
