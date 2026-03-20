import { createId, isoNow } from "@odyssey/utils";
import { scaleDifficulty } from "./difficulty-scaler";
import {
  classroomSpecialization,
  debateSpecialization,
  historicalImmersionSpecialization,
  negotiationSpecialization,
  presentationSpecialization,
  trainingSpecialization,
} from "./generic-specializations";
import { interviewSpecialization } from "./interview-specialization";
import {
  ExternalKnowledgeRetriever,
  HeuristicKnowledgeTransformer,
  KnowledgeTransformer,
  NullKnowledgeRetriever,
  shouldActivateRetrieval,
} from "./retrieval-layer";
import { generateCommunicationScenario } from "./scenario-generator";
import { ScenarioSpecialization } from "./specialization";
import { analyzeSpeechTurn } from "./speech-analysis";
import {
  CommunicationScenarioInput,
  CommunicationSimulationSession,
  ProcessCommunicationTurnInput,
  ProcessCommunicationTurnResult,
  SimulationFeedbackReport,
} from "./types";

function clampDifficulty(level: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 {
  return Math.max(1, Math.min(10, Math.round(level))) as
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10;
}

export class AudioCommunicationSimulationEngine {
  private readonly specializationRegistry: Record<string, ScenarioSpecialization>;
  private readonly knowledgeRetriever: ExternalKnowledgeRetriever;
  private readonly knowledgeTransformer: KnowledgeTransformer;

  constructor(
    options?: {
      specializationRegistry?: Record<string, ScenarioSpecialization>;
      knowledgeRetriever?: ExternalKnowledgeRetriever;
      knowledgeTransformer?: KnowledgeTransformer;
    },
  ) {
    this.specializationRegistry = options?.specializationRegistry ?? {
      interview: interviewSpecialization,
      presentation: presentationSpecialization,
      negotiation: negotiationSpecialization,
      "historical-immersion": historicalImmersionSpecialization,
      classroom: classroomSpecialization,
      debate: debateSpecialization,
      training: trainingSpecialization,
    };
    this.knowledgeRetriever = options?.knowledgeRetriever ?? new NullKnowledgeRetriever();
    this.knowledgeTransformer = options?.knowledgeTransformer ?? new HeuristicKnowledgeTransformer();
  }

  private resolveSpecialization(session: CommunicationSimulationSession) {
    return (
      this.specializationRegistry[session.scenario.scenarioType] ??
      this.specializationRegistry.interview
    );
  }

  startSession(input: CommunicationScenarioInput): CommunicationSimulationSession {
    const scenario = generateCommunicationScenario(input);
    const now = isoNow();
    const skeletonSession: CommunicationSimulationSession = {
      sessionId: createId("comms_session"),
      scenario,
      startedAt: now,
      updatedAt: now,
      remainingSeconds: scenario.timeLimitSeconds,
      activeDifficulty: clampDifficulty(scenario.difficultyLevel),
      currentPrompt: "",
      turns: [],
    };
    const specialization = this.resolveSpecialization(skeletonSession);

    return {
      ...skeletonSession,
      currentPrompt: specialization.buildOpeningPrompt(skeletonSession),
    };
  }

  async startSessionWithRetrieval(
    input: CommunicationScenarioInput,
    mode: "off" | "auto" | "on" = "auto",
  ): Promise<CommunicationSimulationSession> {
    const session = this.startSession(input);
    const retrievalContext = {
      scenarioType: session.scenario.scenarioType,
      realismMode: session.scenario.realismMode,
      role: session.scenario.role,
      industry: session.scenario.industry,
      goal: session.scenario.goal,
      specificityLevel: session.scenario.specificityLevel,
      constraints: {
        knowledgeDomain: session.scenario.constraints?.knowledgeDomain,
        pressurePattern: session.scenario.constraints?.pressurePattern,
        scenarioStructure: session.scenario.constraints?.scenarioStructure,
      },
    } as const;
    const shouldUse =
      mode === "on" || (mode === "auto" && shouldActivateRetrieval(retrievalContext));

    if (!shouldUse) {
      return session;
    }

    const docs = await this.knowledgeRetriever.retrieve(retrievalContext);
    if (!docs.length) {
      return session;
    }

    const transformed = this.knowledgeTransformer.transform(
      retrievalContext,
      docs,
      session.scenario.worldModel.knowledgeModel,
    );

    return {
      ...session,
      scenario: {
        ...session.scenario,
        worldModel: {
          ...session.scenario.worldModel,
          knowledgeModel: transformed,
        },
      },
    };
  }

  processTurn(
    session: CommunicationSimulationSession,
    input: ProcessCommunicationTurnInput,
  ): ProcessCommunicationTurnResult {
    if (!input.transcript?.trim()) {
      throw new Error("transcript is required.");
    }

    const analysis = analyzeSpeechTurn(input);
    const specialization = this.resolveSpecialization(session);
    const score = specialization.scoreTurn({
      session,
      input,
      analysis,
    });
    const difficultyAfter = scaleDifficulty({
      currentLevel: session.activeDifficulty,
      score,
      turnCount: session.turns.length + 1,
    });
    const reactions = specialization.generateReactions({
      session,
      score,
      difficulty: difficultyAfter,
      transcript: input.transcript,
    });
    const next = specialization.selectNextPrompt({
      session,
      turnNumber: session.turns.length + 2,
      difficulty: difficultyAfter,
      priorScore: score,
    });

    const spent = Math.max(20, input.signal?.durationSeconds ?? 45);
    const turn = {
      turnNumber: session.turns.length + 1,
      phase: next.phase,
      questionCategory: next.category,
      prompt: session.currentPrompt,
      transcript: input.transcript,
      analysis,
      score,
      answeredCorrectly: score.overall >= 75,
      difficultyBefore: session.activeDifficulty,
      difficultyAfter,
      personaReactions: reactions,
    };

    const updatedSession: CommunicationSimulationSession = {
      ...session,
      updatedAt: isoNow(),
      activeDifficulty: difficultyAfter,
      remainingSeconds: Math.max(0, session.remainingSeconds - spent),
      currentPrompt: next.prompt,
      turns: [...session.turns, turn],
    };

    const liveCoaching = [
      analysis.fillerWords > 2 ? "Reduce filler words and pause with intent." : "Keep your delivery crisp.",
      score.concision < 55 ? "Shorten the first sentence and lead with your recommendation." : "Length is on target.",
      score.persuasion < 60 ? "Add one concrete metric or outcome to increase credibility." : "Evidence level is strong.",
    ];

    return {
      session: updatedSession,
      latestTurn: turn,
      nextPrompt: next.prompt,
      shouldEnd: updatedSession.remainingSeconds <= 0 || updatedSession.turns.length >= 12,
      liveCoaching,
      scoreDelta:
        updatedSession.turns.length > 1
          ? turn.score.overall -
            updatedSession.turns[updatedSession.turns.length - 2].score.overall
          : 0,
    };
  }

  finalize(session: CommunicationSimulationSession): SimulationFeedbackReport {
    return this.resolveSpecialization(session).buildFeedback(session);
  }
}
