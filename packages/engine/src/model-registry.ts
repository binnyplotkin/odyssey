/**
 * Single source of truth for the LLM models the engine knows about.
 * Consumed by:
 *   - apps/admin's chat route (model validation + provider routing)
 *   - apps/admin's voice route (model-id based provider streaming)
 *   - apps/admin's L04 Brain / Model editor (picker UI)
 *   - packages/evals' runner (cost estimation, provider routing)
 *
 * Pre-v2 the registry lived in apps/admin/src/lib/model-registry.ts with
 * only { id, label, provider, modes }. Pricing was duplicated as a
 * separate hardcoded table in packages/evals/src/runner.ts. This unified
 * registry collapses both into one record per model.
 *
 * Updating prices: vendor list prices in USD per 1M tokens, taken from
 * each provider's pricing page. Update when the vendor announces a change.
 * Cache pricing (`cacheRead` / `cacheWrite`) only applies to providers
 * that support prompt caching (Anthropic today; OpenAI added it in late
 * 2024 but we don't use it yet).
 */

export type ProviderId = "anthropic" | "openai" | "cerebras" | "groq";

/** Where this model can be used. */
export type ModelMode = "chat" | "voice";

/** USD per 1M tokens. */
export type ModelPricing = {
  input: number;
  output: number;
  /** Reads from prompt cache. Omit when provider doesn't cache. */
  cacheRead?: number;
  /** Writes (cold-start) to prompt cache. Omit when provider doesn't cache. */
  cacheWrite?: number;
};

export type ModelCapabilities = {
  /** Supports prompt-caching headers (Anthropic `cache_control`). */
  promptCache?: boolean;
  /** Supports server-side streaming completion. */
  streaming?: boolean;
  /** Supports tool / function calling. */
  tools?: boolean;
  /** Accepts image inputs alongside text. */
  vision?: boolean;
  /** Native JSON-schema structured output mode. */
  structuredOutput?: boolean;
  /** Exposes a `temperature` parameter. */
  temperature?: boolean;
  /** Exposes a `top_p` parameter. */
  topP?: boolean;
};

/**
 * Coarse latency bucket. Useful for UI filtering ("show me anything fast
 * enough for voice"). Not a hard SLO — actual TTFT depends on prompt size,
 * cache hits, region, and current load.
 *
 *   instant   ~< 200ms TTFT  (Cerebras, Groq)
 *   fast      ~< 1s   TTFT  (Haiku, GPT-5-nano)
 *   balanced  ~< 3s   TTFT  (Sonnet, GPT-5-mini)
 *   frontier  ~< 8s   TTFT  (Opus, GPT-5)
 */
export type LatencyTier = "instant" | "fast" | "balanced" | "frontier";

/**
 * Coarse quality bucket. Authoring guidance, not a benchmark claim.
 *   budget     — cheapest tier from each provider; fine for high-volume turns
 *   production — daily-driver tier; what most characters should run
 *   frontier   — most capable / most expensive; reserve for hardest probes
 */
export type QualityTier = "budget" | "production" | "frontier";

export type ModelOption = {
  id: string;
  /** Short display name shown in pickers (e.g. "Sonnet 4.5"). */
  label: string;
  /** One-sentence positioning shown beneath the label. */
  description?: string;
  provider: ProviderId;
  modes: ModelMode[];
  /** Total context window the model can consume (input tokens). */
  contextWindow: number;
  /** Soft ceiling on output tokens per call (provider-enforced or sensible default). */
  maxOutputTokens: number;
  pricing: ModelPricing;
  capabilities: ModelCapabilities;
  latencyTier: LatencyTier;
  qualityTier: QualityTier;
  /** Mark non-GA models so the picker can flag them. */
  preview?: boolean;
};

/* ── The registry ───────────────────────────────────────────── */

export const MODEL_REGISTRY: ModelOption[] = [
  // ── Anthropic Claude 4-series ────────────────────────────────
  {
    id: "claude-opus-4-5",
    label: "Opus 4.5",
    description: "Anthropic's flagship. Best in-character coherence, slowest TTFT.",
    provider: "anthropic",
    modes: ["chat", "voice"],
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    pricing: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    capabilities: {
      promptCache: true, streaming: true, tools: true, vision: true,
      structuredOutput: true, temperature: true, topP: true,
    },
    latencyTier: "frontier",
    qualityTier: "frontier",
  },
  {
    id: "claude-sonnet-4-5",
    label: "Sonnet 4.5",
    description: "The daily-driver. Closest to Opus on quality at 1/5 the cost.",
    provider: "anthropic",
    modes: ["chat", "voice"],
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    pricing: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    capabilities: {
      promptCache: true, streaming: true, tools: true, vision: true,
      structuredOutput: true, temperature: true, topP: true,
    },
    latencyTier: "balanced",
    qualityTier: "production",
  },
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "Fastest Anthropic model. Voice-grade TTFT, holds character well at short lengths.",
    provider: "anthropic",
    modes: ["chat", "voice"],
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    pricing: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    capabilities: {
      promptCache: true, streaming: true, tools: true, vision: true,
      structuredOutput: true, temperature: true, topP: true,
    },
    latencyTier: "fast",
    qualityTier: "budget",
  },

  // ── OpenAI GPT-5 series ──────────────────────────────────────
  // Pricing per OpenAI's GPT-5 launch (USD per 1M tokens).
  // Note on capabilities: GPT-5 models reject custom `temperature` and
  // `top_p` values — only the default (1.0) is accepted. We mark these
  // capabilities false so the chat route + OpenAI provider drop the
  // parameters before sending, and the L04 picker can disable the
  // matching sliders when one of these is selected.
  {
    id: "gpt-5",
    label: "GPT-5",
    description: "OpenAI's frontier. Strong instruction following + tool use; locks temperature to default.",
    provider: "openai",
    modes: ["chat"],
    contextWindow: 400_000,
    maxOutputTokens: 8192,
    pricing: { input: 1.25, output: 10 },
    capabilities: {
      promptCache: false, streaming: true, tools: true, vision: true,
      structuredOutput: true, temperature: false, topP: false,
    },
    latencyTier: "frontier",
    qualityTier: "frontier",
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    description: "Cost/quality balance. Comparable to Sonnet 4.5 at less than 1/10 the input cost.",
    provider: "openai",
    modes: ["chat"],
    contextWindow: 400_000,
    maxOutputTokens: 8192,
    pricing: { input: 0.25, output: 2 },
    capabilities: {
      promptCache: false, streaming: true, tools: true, vision: true,
      structuredOutput: true, temperature: false, topP: false,
    },
    latencyTier: "balanced",
    qualityTier: "production",
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    description: "Cheapest GPT-5 tier. Voice-grade TTFT possible.",
    provider: "openai",
    modes: ["chat"],
    contextWindow: 400_000,
    maxOutputTokens: 8192,
    pricing: { input: 0.05, output: 0.4 },
    capabilities: {
      promptCache: false, streaming: true, tools: true, vision: true,
      structuredOutput: true, temperature: false, topP: false,
    },
    latencyTier: "fast",
    qualityTier: "budget",
  },

  // ── Cerebras — open-weights, sub-200ms TTFT ──────────────────
  // All accept "chat" mode now (OpenAI-compatible HTTP, wired through
  // CerebrasChatProvider). Author beware: long-form chat quality is
  // model-dependent — evaluate each one before adopting in production.
  {
    id: "llama3.1-8b",
    label: "Llama 3.1 8B",
    description: "Small open-weights. Instant TTFT; quality drops on long-form turns.",
    provider: "cerebras",
    modes: ["chat", "voice"],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    pricing: { input: 0.1, output: 0.1 },
    capabilities: { promptCache: false, streaming: true, tools: false, vision: false, structuredOutput: false, temperature: true, topP: true },
    latencyTier: "instant",
    qualityTier: "budget",
  },
  {
    id: "qwen-3-235b-a22b-instruct-2507",
    label: "Qwen 3 235B",
    description: "MoE with ~22B active params. Strong character coherence among the open-weights set.",
    provider: "cerebras",
    modes: ["chat", "voice"],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    pricing: { input: 0.6, output: 1.2 },
    capabilities: { promptCache: false, streaming: true, tools: false, vision: false, structuredOutput: false, temperature: true, topP: true },
    latencyTier: "instant",
    qualityTier: "production",
    preview: true,
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    description: "OpenAI's open-weights drop, served on Cerebras silicon.",
    provider: "cerebras",
    modes: ["chat", "voice"],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    pricing: { input: 0.25, output: 0.5 },
    capabilities: { promptCache: false, streaming: true, tools: false, vision: false, structuredOutput: false, temperature: true, topP: true },
    latencyTier: "instant",
    qualityTier: "production",
  },
  {
    id: "zai-glm-4.7",
    label: "GLM 4.7",
    description: "Zhipu's GLM. Multilingual — strong Chinese + English coverage.",
    provider: "cerebras",
    modes: ["chat", "voice"],
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    pricing: { input: 0.5, output: 1 },
    capabilities: { promptCache: false, streaming: true, tools: false, vision: false, structuredOutput: false, temperature: true, topP: true },
    latencyTier: "instant",
    qualityTier: "production",
  },

  // ── Groq — OpenAI-compatible ultra-low-latency inference ─────
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    description: "OpenAI open-weight MoE on Groq. Strong voice latency with high-capability reasoning.",
    provider: "groq",
    modes: ["chat", "voice"],
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    pricing: { input: 0.15, output: 0.6, cacheRead: 0.075 },
    capabilities: {
      promptCache: true, streaming: true, tools: true, vision: false,
      structuredOutput: true, temperature: true, topP: true,
    },
    latencyTier: "instant",
    qualityTier: "production",
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B (Groq)",
    description: "Compact GPT-OSS on Groq. Very fast, inexpensive voice/chat turns.",
    provider: "groq",
    modes: ["chat", "voice"],
    contextWindow: 131_072,
    maxOutputTokens: 65_536,
    pricing: { input: 0.075, output: 0.3, cacheRead: 0.0375 },
    capabilities: {
      promptCache: true, streaming: true, tools: true, vision: false,
      structuredOutput: true, temperature: true, topP: true,
    },
    latencyTier: "instant",
    qualityTier: "budget",
  },
];

/* ── Defaults ──────────────────────────────────────────────── */

export const DEFAULT_CHAT_MODEL = "claude-sonnet-4-5";

/**
 * Default model for *voice* contexts. Qwen 3 235B gives noticeably better
 * in-character dialogue than smaller Cerebras models with similar TTFT.
 * Note: Cerebras lists this as Preview — if it 404s, fall back to gpt-oss-120b.
 */
export const DEFAULT_VOICE_MODEL = "qwen-3-235b-a22b-instruct-2507";

/* ── Lookup helpers ────────────────────────────────────────── */

export function modelMetaFor(id: string): ModelOption | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}

export function providerFor(id: string, fallback: ProviderId = "anthropic"): ProviderId {
  return modelMetaFor(id)?.provider ?? fallback;
}

export function modelsFor(mode: ModelMode): ModelOption[] {
  return MODEL_REGISTRY.filter((m) => m.modes.includes(mode));
}

/** Returns the pricing record for a model, or null if unknown. */
export function pricingFor(id: string): ModelPricing | null {
  return modelMetaFor(id)?.pricing ?? null;
}
