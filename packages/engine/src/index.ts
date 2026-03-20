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
export { getOpenAIClient } from "./openai-client";
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
  createTextToSpeechAdapter,
  resolveTtsProvider,
  getElevenLabsPricingGuardInfo,
} from "./audio";
export type { TtsProvider } from "./audio";
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
