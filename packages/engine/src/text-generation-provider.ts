import { FallbackTextGenerator, OpenAITextGenerator } from "./generator";
import { TextGenerationAdapter, TextGenerationProvider } from "./interfaces";

export class OpenAITextGenerationProvider implements TextGenerationProvider {
  readonly id = "openai";

  createAdapter() {
    return new OpenAITextGenerator();
  }
}

export class FallbackTextGenerationProvider implements TextGenerationProvider {
  readonly id = "fallback";

  createAdapter() {
    return new FallbackTextGenerator();
  }
}

export function createDefaultTextGenerationProvider(): TextGenerationProvider {
  return new OpenAITextGenerationProvider();
}

export function getDeterministicTextGenerationAdapter(): TextGenerationAdapter {
  return new FallbackTextGenerator();
}
