import { buildSimulationFeedbackReport } from "./feedback-engine";
import { scoreCommunicationTurn } from "./scoring-engine";
import { ScenarioSpecialization, SpecializationNextPrompt } from "./specialization";

function genericOpening(scenarioType: string) {
  switch (scenarioType) {
    case "presentation":
      return "You are now on stage. Give your opening summary in 30 seconds.";
    case "negotiation":
      return "The negotiation starts now. State your position and core objective clearly.";
    case "historical-immersion":
      return "You enter the historical setting. Describe your first action and intent.";
    case "classroom":
      return "Class has begun. Introduce the topic and your learning goal.";
    case "debate":
      return "Debate round starts. Deliver your opening argument.";
    case "training":
      return "Training simulation is live. Explain your first operational decision.";
    default:
      return "Simulation started. Give your opening response.";
  }
}

function genericPrompt(
  scenarioType: string,
  turnNumber: number,
  priorOverall: number,
): SpecializationNextPrompt {
  const phase =
    turnNumber <= 2
      ? "warm-up"
      : turnNumber <= 7
        ? "core-evaluation"
        : turnNumber <= 10
          ? "deep-dive"
          : "closing";

  const category =
    scenarioType === "classroom"
      ? "situational"
      : scenarioType === "presentation"
        ? "behavioral"
        : scenarioType === "negotiation"
          ? "hypothetical"
          : "logical";

  const depthHint =
    priorOverall >= 82
      ? "Push one level deeper and justify tradeoffs."
      : priorOverall < 55
        ? "Clarify with one concrete example."
        : "Keep your structure clear and practical.";

  const prompt = (() => {
    switch (scenarioType) {
      case "presentation":
        return `Address audience concerns and clarify your main message. ${depthHint}`;
      case "negotiation":
        return `Respond to a counteroffer and propose next terms. ${depthHint}`;
      case "historical-immersion":
        return `React to a new event in the world and choose your next move. ${depthHint}`;
      case "classroom":
        return `Guide the learner through the next concept and check understanding. ${depthHint}`;
      case "debate":
        return `Counter the opposing argument and defend your claim. ${depthHint}`;
      case "training":
        return `Handle a practical challenge and explain your decision process. ${depthHint}`;
      default:
        return `Continue the simulation with a grounded response. ${depthHint}`;
    }
  })();

  return {
    prompt,
    phase,
    category,
  };
}

function buildGenericSpecialization(id: string): ScenarioSpecialization {
  return {
    id,
    buildOpeningPrompt: (session) => genericOpening(session.scenario.scenarioType),
    scoreTurn: ({ session, input, analysis }) =>
      scoreCommunicationTurn({
        input,
        analysis,
        priorPrompt: session.currentPrompt,
        interviewType: session.scenario.interviewType,
        roleContext: session.scenario.role,
        industry: session.scenario.industry,
        framework: session.scenario.framework,
      }),
    generateReactions: ({ session, score, difficulty }) =>
      session.scenario.personas.map((persona, index) => ({
        personaId: persona.id,
        text:
          score.overall >= 80
            ? "Strong response. Continue with precision."
            : score.overall < 55
              ? "This is unclear. Be more specific and structured."
              : "Reasonable answer. Tighten the conclusion.",
        interrupt: difficulty >= 7 && index === 0,
        expression:
          score.overall >= 85
            ? "approving"
            : score.overall < 50
              ? "critical"
              : score.overall < 70
                ? "skeptical"
                : "neutral",
        emotionalImpact: score.overall >= 85 ? "calming" : score.overall < 60 ? "pressuring" : "neutral",
      })),
    selectNextPrompt: ({ session, turnNumber, priorScore }) =>
      genericPrompt(session.scenario.scenarioType, turnNumber, priorScore.overall),
    buildFeedback: (session) => buildSimulationFeedbackReport(session.turns, session.scenario.framework),
  };
}

export const presentationSpecialization = buildGenericSpecialization("presentation");
export const negotiationSpecialization = buildGenericSpecialization("negotiation");
export const historicalImmersionSpecialization = buildGenericSpecialization("historical-immersion");
export const classroomSpecialization = buildGenericSpecialization("classroom");
export const debateSpecialization = buildGenericSpecialization("debate");
export const trainingSpecialization = buildGenericSpecialization("training");

