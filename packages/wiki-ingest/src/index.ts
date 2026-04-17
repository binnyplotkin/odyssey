/**
 * @odyssey/wiki-ingest — public API.
 *
 * The main entrypoint is `runIngestion(input)`, an async generator yielding
 * `IngestionEvent`s. Consume with `for await (const ev of runIngestion(…))`,
 * or adapt to SSE / WebSocket for the admin UI.
 */

export { runIngestion } from "./pipeline.js";
export {
  MODELS,
  DEFAULT_MODEL,
  resolveModel,
  isKnownModel,
  estimateCost,
} from "./models.js";
export type { ModelId, ModelMeta } from "./models.js";
export type {
  IngestionInput,
  IngestionEvent,
  IngestionResult,
  PlanOp,
  PlanOpAction,
  OpPlan,
  WrittenPage,
} from "./types.js";
