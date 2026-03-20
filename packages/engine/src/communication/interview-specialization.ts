import { buildSimulationFeedbackReport } from "./feedback-engine";
import { chooseNextPrompt, generatePersonaReactions } from "./dialogue-policy-engine";
import { scoreCommunicationTurn } from "./scoring-engine";
import { ScenarioSpecialization } from "./specialization";

function openingPromptForInterview(params: {
  role: string;
  industry: string;
  interviewType: string;
  roleLevel: number;
}) {
  const roleLower = params.role.toLowerCase();
  const industryLower = params.industry.toLowerCase();
  const serviceContext =
    params.interviewType === "job-interview" &&
    (/cashier|crew|barista|server|retail|customer service|front counter|store associate/.test(
      roleLower,
    ) || /service|retail|restaurant|hospitality/.test(industryLower));

  if (serviceContext) {
    return "Manager: Hi, thanks for coming in. Let's get started. Can you tell me a little about yourself and why you want to work here?";
  }

  if (params.roleLevel <= 2) {
    return "Let's start with a quick intro. Tell me a little about yourself.";
  }

  if (params.interviewType === "startup-pitch") {
    return "Give us your 60-second opening pitch, including the problem and why now.";
  }
  if (params.interviewType === "technical-interview") {
    return "Start with a concise summary of your most technically complex recent project.";
  }
  if (params.interviewType === "press-interview") {
    return "Give your opening statement in under 45 seconds.";
  }
  return "Begin with your opening response and core thesis in under 60 seconds.";
}

export const interviewSpecialization: ScenarioSpecialization = {
  id: "interview",
  buildOpeningPrompt: (session) =>
    openingPromptForInterview({
      role: session.scenario.role,
      industry: session.scenario.industry,
      interviewType: session.scenario.interviewType,
      roleLevel: session.scenario.framework.roleLevel,
    }),
  scoreTurn: ({ session, input, analysis }) =>
    scoreCommunicationTurn({
      input,
      analysis,
      priorPrompt: session.currentPrompt,
      scenarioType: session.scenario.scenarioType,
      interviewType: session.scenario.interviewType,
      roleContext: session.scenario.role,
      industry: session.scenario.industry,
      framework: session.scenario.framework,
    }),
  generateReactions: ({ session, score, difficulty, transcript }) =>
    generatePersonaReactions({
      personas: session.scenario.personas,
      score,
      difficulty,
      transcript,
      roleContext: session.scenario.role,
      industry: session.scenario.industry,
      framework: session.scenario.framework,
    }),
  selectNextPrompt: ({ session, turnNumber, difficulty, priorScore }) =>
    chooseNextPrompt({
      interviewType: session.scenario.interviewType,
      turnNumber,
      difficulty,
      priorScore,
      roleContext: session.scenario.role,
      industry: session.scenario.industry,
      framework: session.scenario.framework,
      specificityLevel: session.scenario.specificityLevel,
      constraints: session.scenario.constraints,
      knowledgeModel: session.scenario.worldModel.knowledgeModel,
    }),
  buildFeedback: (session) => buildSimulationFeedbackReport(session.turns, session.scenario.framework),
};
