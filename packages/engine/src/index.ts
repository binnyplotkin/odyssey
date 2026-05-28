export { createSimulationService } from "./service";
export { TurnProcessor } from "./turn-processor";
export type { TurnTraceStep } from "./turn-processor";
export { RuleBasedEventSelector } from "./event-selector";
export { HeuristicStateReducer } from "./state-reducer";
export { RollingMemorySummarizer } from "./memory-summarizer";
export { DefaultPolicyGuard } from "./policy-guard";
export { OpenAITextGenerator } from "./generator";
export { FallbackTextGenerator } from "./generator";
export { StaticWorldLoader } from "./world-loader";
export { buildWorldDefinitionFromPrompt } from "./world-builder";
export {
  resolveMetrics,
  resolveCategories,
  getMetricValue,
  setMetricValue,
  buildVisibleState,
  formatMetricsForPrompt,
  resolveRelationships,
  resolveGroupIds,
  evaluateBehaviorCondition,
  buildCharacterContext,
  evaluateGroupCondition,
  buildGroupContext,
  buildRoleContext,
  buildEventContext,
} from "./metric-helpers";
export { getOpenAIClient } from "./openai-client";
export { embedText, embedTexts, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./embedding";
export { AudioCommunicationSimulationEngine } from "./communication";
export {
  generateCommunicationScenario,
  HeuristicKnowledgeTransformer,
  NullKnowledgeRetriever,
  OpenAIWebKnowledgeRetriever,
  shouldActivateRetrieval,
  analyzeSpeechTurn,
  scoreCommunicationTurn,
  scaleDifficulty,
  buildSimulationFeedbackReport,
} from "./communication";
export {
  OpenAITextGenerationProvider,
  FallbackTextGenerationProvider,
  createDefaultTextGenerationProvider,
  getDeterministicTextGenerationAdapter,
} from "./text-generation-provider";
export {
  OpenAISpeechToTextAdapter,
  OpenAITextToSpeechAdapter,
  ElevenLabsTextToSpeechAdapter,
  KyutaiSpeechToTextAdapter,
  PocketTtsStreamingAdapter,
  ElevenLabsStreamingAdapter,
  createSpeechToTextAdapter,
  createTextToSpeechAdapter,
  createStreamingTtsAdapterForVoice,
  resolveSttProvider,
  resolveTtsProvider,
  resolveTtsAttemptOrder,
  getAudioRuntimeConfig,
  getElevenLabsPricingGuardInfo,
  getPocketTtsBaseUrl,
  POCKET_TTS_SAMPLE_RATE,
  POCKET_TTS_PUBLIC_BASE_URL,
} from "./audio";
export type {
  SttProvider,
  TtsProvider,
  StreamingTtsProvider,
  VoiceForRouting,
  ElevenLabsVoiceProviderConfig,
} from "./audio";
export {
  getVoiceDiscoveryDebugInfo,
  getNarratorVoiceProfile,
  getCharacterVoiceProfile,
  normalizeVoiceProfile,
  assignDynamicVoiceProfiles,
} from "./voice-mapping";
export type { VoiceProvider, VoiceProfile } from "./voice-mapping";
export type {
  SpeechToTextAdapter,
  TextGenerationAdapter,
  TextToSpeechAdapter,
  StreamingTextToSpeechAdapter,
  StreamingTtsChunk,
  VoiceContext,
  TextGenerationProvider,
  WorldLoader,
  EventSelector,
  StateReducer,
  MemorySummarizer,
  PolicyGuard,
} from "./interfaces";
export type {
  CommunicationScenarioType,
  CommunicationScenarioInput,
  CommunicationSimulationSession,
  ProcessCommunicationTurnInput,
  ProcessCommunicationTurnResult,
  ScenarioTone,
  RealismMode,
  SpecificityLevel,
  ScoreBreakdown,
  SimulationFeedbackReport,
  SimulationPersona,
  WorldKnowledgeFact,
  WorldKnowledgeModel,
  WorldModel,
  SpeechTurnSignal,
  WorldScenarioType,
} from "./communication";

// L01–L04 prompt builders (moved here from apps/admin/src/lib so
// both the admin app and the @odyssey/evals package consume one source).
export {
  buildSystemPrompt,
  buildSystemPromptParts,
  buildVoiceSystemPrompt,
  buildVoiceSystemPromptParts,
} from "./character-system-prompt";
export { compileDirectiveXml } from "./directive-xml";
export { compileIdentityXml } from "./identity-xml";
export { compileVoiceXml } from "./voice-xml";

// Model registry v2 — single source of truth for chat / voice models +
// pricing + capabilities. Consumed by chat route, voice route, evals
// runner, and the L04 editor.
export {
  MODEL_REGISTRY,
  DEFAULT_CHAT_MODEL,
  DEFAULT_VOICE_MODEL,
  modelMetaFor,
  providerFor,
  modelsFor,
  pricingFor,
} from "./model-registry";
export type {
  ProviderId,
  ModelMode,
  ModelPricing,
  ModelCapabilities,
  LatencyTier,
  QualityTier,
  ModelOption,
} from "./model-registry";

// Multi-provider chat abstraction. Chat route + evals runner consume
// `getChatProviderForModel(modelId)` and call .complete() / .stream()
// without caring whether the underlying SDK is Anthropic or OpenAI.
export {
  getChatProvider,
  getChatProviderForModel,
  AnthropicChatProvider,
  OpenAIChatProvider,
  CerebrasChatProvider,
  GroqChatProvider,
} from "./chat-providers";
export type {
  ChatProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamEvent,
  ChatSystemBlock,
  ChatMessage,
} from "./chat-providers";
