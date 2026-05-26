/**
 * Re-export shim. The real registry lives in `@odyssey/engine` so the
 * evals package + chat route + voice route + L04 editor all consume one
 * source of truth (pre-v2 the file was duplicated here and pricing was
 * hardcoded a third time in packages/evals/src/runner.ts).
 *
 * Keep this file so client components don't import the full engine barrel:
 * that barrel also exports server/audio adapters that pull in Node-only
 * modules and break Next's client compiler.
 */

export {
  MODEL_REGISTRY,
  DEFAULT_CHAT_MODEL,
  DEFAULT_VOICE_MODEL,
  modelMetaFor,
  providerFor,
  modelsFor,
  pricingFor,
} from "../../../../packages/engine/src/model-registry";

export type {
  ProviderId,
  ModelMode,
  ModelPricing,
  ModelCapabilities,
  LatencyTier,
  QualityTier,
  ModelOption,
} from "../../../../packages/engine/src/model-registry";

// Back-compat alias — pre-v2 the provider type was named `LlmProvider`.
// New code should use `ProviderId`.
import type { ProviderId as _ProviderId } from "../../../../packages/engine/src/model-registry";
export type LlmProvider = _ProviderId;
