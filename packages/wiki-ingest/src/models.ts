/**
 * Model registry for wiki ingestion. Swappable per-run — the pipeline stores
 * the chosen model's slug in the ingestion log so we can A/B quality and
 * cost over time.
 *
 * Prices are $ per *million* tokens, matching Anthropic's published pricing
 * format. Not load-bearing — recorded for cost estimation only.
 */

export type ModelMeta = {
  /** Context window (tokens). */
  context: number;
  /** Input cost $/1M tokens. */
  inPerMTok: number;
  /** Output cost $/1M tokens. */
  outPerMTok: number;
  /** Whether this model supports Anthropic prompt caching. */
  supportsCaching: boolean;
  /** Human-friendly name for UI display. */
  label: string;
};

export const MODELS = {
  "claude-opus-4-5": {
    context: 200_000,
    inPerMTok: 15,
    outPerMTok: 75,
    supportsCaching: true,
    label: "Claude Opus 4.5",
  },
  "claude-sonnet-4-5": {
    context: 200_000,
    inPerMTok: 3,
    outPerMTok: 15,
    supportsCaching: true,
    label: "Claude Sonnet 4.5",
  },
  "claude-haiku-4-5": {
    context: 200_000,
    inPerMTok: 1,
    outPerMTok: 5,
    supportsCaching: true,
    label: "Claude Haiku 4.5",
  },
} as const satisfies Record<string, ModelMeta>;

export type ModelId = keyof typeof MODELS;

export const DEFAULT_MODEL: ModelId = "claude-sonnet-4-5";

export function isKnownModel(id: string): id is ModelId {
  return id in MODELS;
}

export function resolveModel(id?: string): ModelId {
  if (!id) return DEFAULT_MODEL;
  if (!isKnownModel(id)) {
    throw new Error(
      `Unknown model "${id}". Known: ${Object.keys(MODELS).join(", ")}`,
    );
  }
  return id;
}

/** Estimate $ cost for a run given token split. Cheap heuristic, not billing. */
export function estimateCost(
  modelId: ModelId,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = MODELS[modelId];
  return (
    (inputTokens / 1_000_000) * m.inPerMTok +
    (outputTokens / 1_000_000) * m.outPerMTok
  );
}
