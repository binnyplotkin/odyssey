/**
 * @odyssey/wiki-ingest — public API.
 *
 * The main entrypoint is `runIngestion(input)`, an async generator yielding
 * `IngestionEvent`s. Consume with `for await (const ev of runIngestion(…))`,
 * or adapt to SSE / WebSocket for the admin UI.
 */

export { runIngestion } from "./pipeline";
export { loadWikiContext } from "./context";
export { renderWikiContext } from "./prompts";
export type { WikiIngestContext } from "./prompts";
export { generateIngestionPrompt } from "./generate";
export type {
  GenerateIngestionPromptArgs,
  GeneratedIngestionPrompt,
} from "./generate";
export {
  MODELS,
  DEFAULT_MODEL,
  resolveModel,
  isKnownModel,
  estimateCost,
} from "./models";
export type { ModelId, ModelMeta } from "./models";
export type {
  IngestionInput,
  IngestionEvent,
  IngestionResult,
  PlanOp,
  PlanOpAction,
  OpPlan,
  WrittenPage,
} from "./types";
export { call, extractToolUse } from "./client";
export type { CallOptions, CallResult } from "./client";

export {
  survey,
  explodeCitations,
  resolveExcludeRanges,
  applyExclusions,
  attributionsForRef,
  extractMarkerApparatus,
  normalizeUrl,
} from "./survey";
export type {
  SurveyAnatomy,
  SurveyBibliographyEntry,
  SurveyExcludeSection,
  SurveyResult,
  ExplodeResult,
} from "./survey";
