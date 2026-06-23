import { pricingFor } from "@odyssey/engine";

export type SessionTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

export type SessionCostEstimate = {
  estimatedCostUsd: number;
  pricing: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  } | null;
};

export function estimateSessionTurnCost(
  modelId: string | null | undefined,
  usage: SessionTokenUsage,
): SessionCostEstimate {
  const pricing = modelId ? pricingFor(modelId) : null;
  if (!pricing) {
    return { estimatedCostUsd: 0, pricing: null };
  }

  const inputTokens = finiteTokenCount(usage.inputTokens);
  const outputTokens = finiteTokenCount(usage.outputTokens);
  const cacheReadTokens = finiteTokenCount(usage.cacheReadTokens);
  const cacheCreationTokens = finiteTokenCount(usage.cacheCreationTokens);

  const estimatedCostUsd =
    (inputTokens * pricing.input) / 1_000_000 +
    (outputTokens * pricing.output) / 1_000_000 +
    (cacheReadTokens * (pricing.cacheRead ?? 0)) / 1_000_000 +
    (cacheCreationTokens * (pricing.cacheWrite ?? 0)) / 1_000_000;

  return {
    estimatedCostUsd: roundCost(estimatedCostUsd),
    pricing,
  };
}

function finiteTokenCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
