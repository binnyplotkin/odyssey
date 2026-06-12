export { getOpenAIClient } from "./openai-client";
export { embedText, embedTexts, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "./embedding";
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
} from "./voice-mapping";
export type { VoiceProvider, VoiceProfile } from "./voice-mapping";
export type {
  SpeechToTextAdapter,
  TextToSpeechAdapter,
  StreamingTextToSpeechAdapter,
  StreamingTtsChunk,
  VoiceContext,
} from "./interfaces";

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
