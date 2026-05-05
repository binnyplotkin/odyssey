/**
 * Single source of truth for the LLM models the test chat and the dedicated
 * voice page can pick from. The `modes` array reflects which routes actually
 * accept that provider:
 *
 *   - chat route ([id]/chat) talks to Anthropic only
 *   - voice routes ([id]/voice-chat, [id]/voice-stream) accept both Anthropic
 *     and Cerebras
 *
 * Cerebras IDs come from `GET https://api.cerebras.ai/v1/models`. They rotate
 * from time to time — if a model 404s the API for an account, edit this list.
 */

export type LlmProvider = "anthropic" | "cerebras";
export type ModelMode = "chat" | "voice";

export type ModelOption = {
  id: string;
  label: string;
  provider: LlmProvider;
  modes: ModelMode[];
};

export const MODEL_REGISTRY: ModelOption[] = [
  // Anthropic — accepted by both routes. In voice they're slower (~800ms TTFT)
  // but produce more in-character replies than Cerebras's open-weights models.
  { id: "claude-opus-4-5",                label: "Opus 4.5",     provider: "anthropic", modes: ["chat", "voice"] },
  { id: "claude-sonnet-4-5",              label: "Sonnet 4.5",   provider: "anthropic", modes: ["chat", "voice"] },
  { id: "claude-haiku-4-5",               label: "Haiku 4.5",    provider: "anthropic", modes: ["chat", "voice"] },

  // Cerebras — voice-only today. Sub-200ms TTFT thanks to wafer-scale silicon.
  // Quality is fine for short voice replies; long-form chat is uneven.
  { id: "llama3.1-8b",                    label: "Llama 3.1 8B", provider: "cerebras",  modes: ["voice"] },
  { id: "qwen-3-235b-a22b-instruct-2507", label: "Qwen 3 235B",  provider: "cerebras",  modes: ["voice"] },
  { id: "gpt-oss-120b",                   label: "GPT-OSS 120B", provider: "cerebras",  modes: ["voice"] },
  { id: "zai-glm-4.7",                    label: "GLM 4.7",      provider: "cerebras",  modes: ["voice"] },
];

export const DEFAULT_CHAT_MODEL = "claude-sonnet-4-5";

/**
 * Default model for *voice* contexts. Qwen 3 235B (MoE, 22B active) gives
 * noticeably better in-character dialogue than smaller Cerebras models with
 * similar TTFT (~200–300ms). Note: Cerebras lists this as Preview tier — if
 * it ever 404s for an account, fall back to gpt-oss-120b (Production).
 */
export const DEFAULT_VOICE_MODEL = "qwen-3-235b-a22b-instruct-2507";

export function modelMetaFor(id: string): ModelOption | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function providerFor(id: string, fallback: LlmProvider = "cerebras"): LlmProvider {
  return modelMetaFor(id)?.provider ?? fallback;
}

export function modelsFor(mode: ModelMode): ModelOption[] {
  return MODEL_REGISTRY.filter((m) => m.modes.includes(mode));
}
