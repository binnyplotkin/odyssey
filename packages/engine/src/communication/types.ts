export type CommunicationScenarioType =
  | "job-interview"
  | "technical-interview"
  | "case-interview"
  | "startup-pitch"
  | "panel-presentation"
  | "press-interview"
  | "high-stakes-qa";

export type PersonaTemperament = "calm" | "aggressive" | "skeptical" | "warm";
export type PersonaObjectionStyle = "interrupting" | "probing" | "passive";
export type PersonaEmotionalTone =
  | "neutral"
  | "supportive"
  | "pressuring"
  | "critical"
  | "adversarial";

export type ScenarioTone = "supportive" | "balanced" | "aggressive";
export type InterviewStructureType =
  | "casual-conversational"
  | "structured-behavioral"
  | "technical"
  | "case-based"
  | "panel"
  | "high-pressure-grilling"
  | "informal-coffee-chat";
export type InterviewQuestionCategory =
  | "background"
  | "behavioral"
  | "situational"
  | "technical"
  | "logical"
  | "hypothetical"
  | "stress-test"
  | "culture-fit";
export type InterviewerPersonality =
  | "warm-supportive"
  | "neutral-efficient"
  | "skeptical-probing"
  | "intimidating-high-pressure"
  | "disengaged-distracted"
  | "highly-analytical";
export type InterviewPhase =
  | "arrival"
  | "warm-up"
  | "core-evaluation"
  | "deep-dive"
  | "closing";
export type SpecificityLevel = "broad" | "balanced" | "high";
export type RealismMode = "fictional" | "real-world-grounded" | "hybrid";
export type WorldScenarioType =
  | "interview"
  | "presentation"
  | "negotiation"
  | "historical-immersion"
  | "classroom"
  | "debate"
  | "training";

export type WorldKnowledgeFact = {
  id: string;
  kind: "stable" | "current" | "invented";
  topic: string;
  summary: string;
  confidence: number;
  sourceLabel: string;
  sourceUrl?: string;
};

export type WorldKnowledgeModel = {
  stableFacts: WorldKnowledgeFact[];
  currentFacts: WorldKnowledgeFact[];
  inventedFacts: WorldKnowledgeFact[];
  retrieval: {
    used: boolean;
    generatedAt: string;
    sources: string[];
    notes?: string;
  };
};

export type CommunicationScenarioInput = {
  scenarioType?: WorldScenarioType;
  realismMode?: RealismMode;
  jobType: string;
  interviewType: CommunicationScenarioType;
  industry: string;
  difficultyLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  interviewerCount: number;
  tone: ScenarioTone;
  setting?: string;
  goal?: string;
  timeLimitMinutes?: number;
  specificityLevel?: SpecificityLevel;
  constraints?: {
    characterRoles?: string[];
    emotionalDynamics?: string;
    scenarioStructure?: string;
    knowledgeDomain?: string;
    toneStyle?: string;
    environmentalDetails?: string;
    pressurePattern?: string;
  };
};

export type WorldModel = {
  scenarioType: WorldScenarioType;
  specificityLevel: SpecificityLevel;
  realismMode: RealismMode;
  knowledgeModel: WorldKnowledgeModel;
  environment: string;
  participants: Array<{ name: string; role: string; disposition: string }>;
  goals: string[];
  stakes: string;
  tone: ScenarioTone;
  knowledgeDomain: string;
  interactionRules: string[];
  branchingRules: string[];
};

export type InterviewFramework = {
  roleLevel: 1 | 2 | 3 | 4 | 5;
  structureType: InterviewStructureType;
  interviewerPersonality: InterviewerPersonality;
  questionCategories: InterviewQuestionCategory[];
  evaluationCriteria: string[];
  environment: {
    location: string;
    ambiance: string;
    pacing: string;
    pressureDynamics: string;
  };
};

export type SimulationPersona = {
  id: string;
  name: string;
  role: string;
  temperament: PersonaTemperament;
  agenda: string;
  objectionStyle: PersonaObjectionStyle;
  patienceThreshold: number;
  interruptionTendency: number;
  emotionalTone: PersonaEmotionalTone;
};

export type CommunicationScenario = {
  id: string;
  role: string;
  setting: string;
  goal: string;
  timeLimitSeconds: number;
  participantCount: number;
  difficultyLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  interviewType: CommunicationScenarioType;
  scenarioType: WorldScenarioType;
  specificityLevel: SpecificityLevel;
  realismMode: RealismMode;
  industry: string;
  tone: ScenarioTone;
  framework: InterviewFramework;
  worldModel: WorldModel;
  constraints?: CommunicationScenarioInput["constraints"];
  personas: SimulationPersona[];
};

export type SpeechTurnSignal = {
  startDetected?: boolean;
  endDetected?: boolean;
  durationSeconds?: number;
  pauseCount?: number;
  avgPauseMs?: number;
  interruptedByPanel?: boolean;
  userInterruptedPanel?: boolean;
  transcriptConfidence?: number;
};

export type SpeechAnalysis = {
  clarity: number;
  structure: number;
  confidence: number;
  pacing: number;
  hesitation: number;
  fillerWords: number;
  responseLength: number;
  directness: number;
  composure: number;
};

export type ScoreBreakdown = {
  answerQuality: number;
  clarityStructure: number;
  confidence: number;
  composure: number;
  adaptability: number;
  concision: number;
  persuasion: number;
  overall: number;
};

export type SimulationTurnRecord = {
  turnNumber: number;
  phase: InterviewPhase;
  questionCategory: InterviewQuestionCategory;
  prompt: string;
  transcript: string;
  analysis: SpeechAnalysis;
  score: ScoreBreakdown;
  answeredCorrectly: boolean;
  difficultyBefore: number;
  difficultyAfter: number;
  personaReactions: Array<{
    personaId: string;
    text: string;
    interrupt: boolean;
    expression: "approving" | "neutral" | "skeptical" | "confused" | "critical";
    emotionalImpact: "calming" | "neutral" | "pressuring";
  }>;
};

export type CommunicationSimulationSession = {
  sessionId: string;
  scenario: CommunicationScenario;
  startedAt: string;
  updatedAt: string;
  remainingSeconds: number;
  activeDifficulty: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  currentPrompt: string;
  turns: SimulationTurnRecord[];
};

export type ProcessCommunicationTurnInput = {
  transcript: string;
  signal?: SpeechTurnSignal;
};

export type ProcessCommunicationTurnResult = {
  session: CommunicationSimulationSession;
  latestTurn: SimulationTurnRecord;
  nextPrompt: string;
  shouldEnd: boolean;
  liveCoaching: string[];
  scoreDelta: number;
};

export type SimulationFeedbackReport = {
  overallScore: number;
  breakdown: ScoreBreakdown;
  communicationScore: number;
  hireabilityScore: number;
  roleSpecificFeedback: string[];
  missedOpportunities: string[];
  serviceEvaluation?: {
    confidence: number;
    clarity: number;
    professionalism: number;
    customerServiceReadiness: number;
    reliabilityHireability: number;
    strongestMoment: string;
    weakestMoment: string;
    bestAnswer: string;
    tooVagueAnswer: string;
    followUpSuggestion: string;
  };
  strengths: string[];
  weaknesses: string[];
  keyMoments: string[];
  improvedAnswerExamples: string[];
  recommendedNextScenario: string;
};
