import {
  CommunicationSimulationSession,
  ProcessCommunicationTurnInput,
  ScoreBreakdown,
  SimulationFeedbackReport,
  SimulationTurnRecord,
  SpeechAnalysis,
} from "./types";

export type SpecializationNextPrompt = {
  prompt: string;
  phase: SimulationTurnRecord["phase"];
  category: SimulationTurnRecord["questionCategory"];
};

export type ScenarioSpecialization = {
  id: string;
  buildOpeningPrompt: (session: CommunicationSimulationSession) => string;
  scoreTurn: (params: {
    session: CommunicationSimulationSession;
    input: ProcessCommunicationTurnInput;
    analysis: SpeechAnalysis;
  }) => ScoreBreakdown;
  generateReactions: (params: {
    session: CommunicationSimulationSession;
    score: ScoreBreakdown;
    difficulty: number;
    transcript: string;
  }) => SimulationTurnRecord["personaReactions"];
  selectNextPrompt: (params: {
    session: CommunicationSimulationSession;
    turnNumber: number;
    difficulty: number;
    priorScore: ScoreBreakdown;
  }) => SpecializationNextPrompt;
  buildFeedback: (session: CommunicationSimulationSession) => SimulationFeedbackReport;
};

