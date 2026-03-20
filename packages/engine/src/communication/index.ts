export { AudioCommunicationSimulationEngine } from "./service";
export { generateCommunicationScenario } from "./scenario-generator";
export { interviewSpecialization } from "./interview-specialization";
export {
  presentationSpecialization,
  negotiationSpecialization,
  historicalImmersionSpecialization,
  classroomSpecialization,
  debateSpecialization,
  trainingSpecialization,
} from "./generic-specializations";
export {
  HeuristicKnowledgeTransformer,
  NullKnowledgeRetriever,
  shouldActivateRetrieval,
} from "./retrieval-layer";
export { OpenAIWebKnowledgeRetriever } from "./openai-knowledge-retriever";
export { analyzeSpeechTurn } from "./speech-analysis";
export { scoreCommunicationTurn } from "./scoring-engine";
export { scaleDifficulty } from "./difficulty-scaler";
export { buildSimulationFeedbackReport } from "./feedback-engine";
export type {
  CommunicationScenarioType,
  CommunicationScenarioInput,
  CommunicationSimulationSession,
  ProcessCommunicationTurnInput,
  ProcessCommunicationTurnResult,
  ScenarioTone,
  RealismMode,
  WorldScenarioType,
  SpecificityLevel,
  ScoreBreakdown,
  SimulationFeedbackReport,
  SimulationPersona,
  WorldKnowledgeFact,
  WorldKnowledgeModel,
  WorldModel,
  SpeechTurnSignal,
} from "./types";
