import { describe, expect, it } from "vitest";
import { getChatProviderForModel, modelMetaFor, providerFor } from "../index";

describe("model registry provider routing", () => {
  it("routes Groq model ids to the Groq provider", () => {
    expect(providerFor("openai/gpt-oss-120b")).toBe("groq");
    expect(modelMetaFor("openai/gpt-oss-120b")).toMatchObject({
      provider: "groq",
      modes: ["chat", "voice"],
      latencyTier: "instant",
    });
  });

  it("constructs a Groq chat provider for Groq models", () => {
    const previous = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test-groq-key";
    try {
      expect(getChatProviderForModel("openai/gpt-oss-20b").id).toBe("groq");
    } finally {
      if (previous === undefined) {
        delete process.env.GROQ_API_KEY;
      } else {
        process.env.GROQ_API_KEY = previous;
      }
    }
  });
});
