import { createId } from "@odyssey/utils";
import {
  CommunicationScenario,
  CommunicationScenarioInput,
  InterviewFramework,
  InterviewQuestionCategory,
  InterviewStructureType,
  InterviewerPersonality,
  RealismMode,
  SpecificityLevel,
  WorldModel,
} from "./types";
import { buildBaseKnowledgeModel } from "./retrieval-layer";
import { createPersonasForScenario } from "./persona-engine";

function isServiceRole(input: CommunicationScenarioInput) {
  const role = input.jobType.toLowerCase();
  const industry = input.industry.toLowerCase();
  return (
    input.interviewType === "job-interview" &&
    (/cashier|crew|barista|retail|customer service|front counter|store associate|restaurant/.test(
      role,
    ) || /service|retail|restaurant|hospitality/.test(industry))
  );
}

function inferRoleLevel(input: CommunicationScenarioInput): 1 | 2 | 3 | 4 | 5 {
  const role = input.jobType.toLowerCase();
  if (isServiceRole(input)) {
    return 1;
  }
  if (/intern|apprentice|junior|entry/.test(role)) {
    return 2;
  }
  if (/director|vp|vice president|chief|head of|executive|c-suite/.test(role)) {
    return 5;
  }
  if (
    input.interviewType === "high-stakes-qa" ||
    /jane street|quant|trading|hedge fund|elite|principal strategist/.test(role)
  ) {
    return 4;
  }
  return 3;
}

function inferStructureType(
  input: CommunicationScenarioInput,
  roleLevel: 1 | 2 | 3 | 4 | 5,
): InterviewStructureType {
  if ((input.scenarioType ?? "interview") === "role-experience") return "casual-conversational";
  if (input.interviewType === "technical-interview") return "technical";
  if (input.interviewType === "case-interview") return "case-based";
  if (input.interviewType === "panel-presentation") return "panel";
  if (input.interviewType === "high-stakes-qa") return "high-pressure-grilling";
  if (isServiceRole(input)) return "casual-conversational";
  if (roleLevel >= 5) return "informal-coffee-chat";
  return "structured-behavioral";
}

function inferQuestionCategories(
  input: CommunicationScenarioInput,
  roleLevel: 1 | 2 | 3 | 4 | 5,
): InterviewQuestionCategory[] {
  if (roleLevel === 1) {
    return ["background", "situational", "behavioral", "culture-fit"];
  }
  if (roleLevel === 2) {
    return ["background", "behavioral", "situational", "culture-fit", "hypothetical"];
  }
  if (roleLevel === 4) {
    return input.interviewType === "technical-interview"
      ? ["technical", "logical", "stress-test", "hypothetical", "behavioral"]
      : ["logical", "stress-test", "hypothetical", "behavioral"];
  }
  if (roleLevel === 5) {
    return ["behavioral", "hypothetical", "stress-test", "culture-fit", "situational"];
  }
  return input.interviewType === "technical-interview"
    ? ["technical", "behavioral", "situational", "logical"]
    : ["behavioral", "situational", "hypothetical", "culture-fit"];
}

function inferPersonality(
  input: CommunicationScenarioInput,
  roleLevel: 1 | 2 | 3 | 4 | 5,
): InterviewerPersonality {
  if (input.tone === "supportive") return "warm-supportive";
  if (input.tone === "aggressive" && roleLevel >= 4) return "intimidating-high-pressure";
  if (input.tone === "aggressive") return "skeptical-probing";
  if (input.interviewType === "technical-interview" || input.interviewType === "case-interview") {
    return roleLevel >= 4 ? "highly-analytical" : "neutral-efficient";
  }
  return "neutral-efficient";
}

function inferEvaluationCriteria(
  roleLevel: 1 | 2 | 3 | 4 | 5,
  input: CommunicationScenarioInput,
) {
  if ((input.scenarioType ?? "interview") === "role-experience") {
    return ["task execution", "composure", "prioritization", "customer/stakeholder handling"];
  }
  if (roleLevel === 1) {
    return ["clarity", "politeness", "reliability", "energy", "coachability"];
  }
  if (roleLevel === 2) {
    return ["initiative", "teamwork", "problem-solving", "communication"];
  }
  if (roleLevel === 3) {
    return ["structure", "ownership", "execution", "reasoning"];
  }
  if (roleLevel === 4) {
    return ["precision", "depth", "ambiguity-handling", "mental agility", "rigor"];
  }
  if (input.interviewType === "panel-presentation") {
    return ["judgment", "stakeholder influence", "decision quality", "tradeoff clarity"];
  }
  return ["judgment", "decision-making", "vision", "tradeoff management"];
}

function inferEnvironment(
  input: CommunicationScenarioInput,
  structureType: InterviewStructureType,
  roleLevel: 1 | 2 | 3 | 4 | 5,
) {
  if (isServiceRole(input)) {
    return {
      location: "In-store manager interview corner",
      ambiance: "Light kitchen noise, order beeps, customer chatter",
      pacing: "Fast and conversational",
      pressureDynamics: "Mild social pressure with practical screening",
    };
  }
  if (structureType === "technical") {
    return {
      location: "Technical interview room with shared editor",
      ambiance: "Quiet, focused environment",
      pacing: roleLevel >= 4 ? "Rapid analytical cadence" : "Structured technical cadence",
      pressureDynamics: roleLevel >= 4 ? "High precision pressure" : "Moderate problem-solving pressure",
    };
  }
  if (structureType === "panel") {
    return {
      location: "Panel conference room",
      ambiance: "Multiple interviewer voices with occasional overlap",
      pacing: "Layered and sequential",
      pressureDynamics: "Cross-functional scrutiny from multiple perspectives",
    };
  }
  if (structureType === "high-pressure-grilling") {
    return {
      location: "Formal interview suite",
      ambiance: "Minimal small talk and long silences between questions",
      pacing: "Intense, clipped, high-tempo",
      pressureDynamics: "Sustained pressure and deliberate challenge",
    };
  }
  return {
    location: "Standard interview room",
    ambiance: "Quiet, professional setting",
    pacing: "Balanced and structured",
    pressureDynamics: "Moderate evaluative pressure",
  };
}

function buildFramework(input: CommunicationScenarioInput): InterviewFramework {
  const roleLevel = inferRoleLevel(input);
  const structureType = inferStructureType(input, roleLevel);
  return {
    roleLevel,
    structureType,
    interviewerPersonality: inferPersonality(input, roleLevel),
    questionCategories: inferQuestionCategories(input, roleLevel),
    evaluationCriteria: inferEvaluationCriteria(roleLevel, input),
    environment: inferEnvironment(input, structureType, roleLevel),
  };
}

function inferSpecificity(input: CommunicationScenarioInput): SpecificityLevel {
  if (input.specificityLevel) {
    return input.specificityLevel;
  }

  const constraints = input.constraints;
  if (!constraints) {
    return "broad";
  }

  const specificitySignals = [
    constraints.characterRoles?.length ? 1 : 0,
    constraints.emotionalDynamics ? 1 : 0,
    constraints.scenarioStructure ? 1 : 0,
    constraints.knowledgeDomain ? 1 : 0,
    constraints.toneStyle ? 1 : 0,
    constraints.environmentalDetails ? 1 : 0,
    constraints.pressurePattern ? 1 : 0,
  ].reduce((sum, current) => sum + current, 0);

  if (specificitySignals >= 4) return "high";
  if (specificitySignals >= 2) return "balanced";
  return "broad";
}

function inferRealismMode(input: CommunicationScenarioInput): RealismMode {
  if (input.realismMode) {
    return input.realismMode;
  }
  if (input.constraints?.knowledgeDomain || /historical|company|real-world|current/i.test(input.goal ?? "")) {
    return "real-world-grounded";
  }
  if (input.specificityLevel === "high") {
    return "hybrid";
  }
  return "hybrid";
}

function buildWorldModel(
  input: CommunicationScenarioInput,
  framework: InterviewFramework,
  specificityLevel: SpecificityLevel,
  realismMode: RealismMode,
): WorldModel {
  const scenarioType = input.scenarioType ?? "interview";
  const constraints = input.constraints;
  const knowledgeModel = buildBaseKnowledgeModel({
    scenarioType,
    realismMode,
    role: input.jobType,
    industry: input.industry,
    goal: input.goal ?? defaultGoal(input),
    specificityLevel,
    constraints: {
      knowledgeDomain: constraints?.knowledgeDomain,
      pressurePattern: constraints?.pressurePattern,
      scenarioStructure: constraints?.scenarioStructure,
    },
  });
  const stakes =
    framework.roleLevel <= 2
      ? "Hiring decision based on reliability, attitude, and basic communication."
      : framework.roleLevel >= 4
        ? "Selection under high standards for precision and reasoning under pressure."
        : "Evaluation of role readiness, ownership, and communication quality.";

  return {
    scenarioType,
    specificityLevel,
    realismMode,
    knowledgeModel,
    environment: constraints?.environmentalDetails ?? framework.environment.location,
    participants:
      constraints?.characterRoles?.length
        ? constraints.characterRoles.map((role, index) => ({
            name: `Participant ${index + 1}`,
            role,
            disposition: constraints.emotionalDynamics ?? framework.interviewerPersonality,
          }))
        : [
            { name: "Primary Actor", role: input.jobType, disposition: "active" },
            {
              name: scenarioType === "interview" ? "Interview Panel" : "World Counterpart",
              role: "evaluators",
              disposition: framework.interviewerPersonality,
            },
          ],
    goals: [input.goal ?? defaultGoal(input), "Demonstrate role-fit under realistic social dynamics."],
    stakes,
    tone: input.tone,
    knowledgeDomain: constraints?.knowledgeDomain ?? input.industry,
    interactionRules: [
      "Conversation is turn-based with dynamic follow-up prompts.",
      "Difficulty adapts to response quality and configured level.",
      "Interviewer behavior reflects selected personality and structure.",
      ...(constraints?.scenarioStructure
        ? [`Scenario structure to preserve: ${constraints.scenarioStructure}`]
        : []),
    ],
    branchingRules: [
      "Strong answers increase depth and challenge.",
      "Weak or vague answers trigger clarifying/probing follow-ups.",
      constraints?.pressurePattern
        ? `Pressure pattern to preserve: ${constraints.pressurePattern}.`
        : "Pressure varies by personality and current difficulty tier.",
    ],
  };
}

function defaultSetting(type: CommunicationScenarioInput["interviewType"]) {
  switch (type) {
    case "technical-interview":
      return "Live technical interview room with shared coding screen.";
    case "case-interview":
      return "Consulting case room with whiteboard and time pressure.";
    case "startup-pitch":
      return "Investor pitch meeting with partner panel.";
    case "panel-presentation":
      return "Executive panel presentation in conference setting.";
    case "press-interview":
      return "Press room with cameras and rapid-fire questions.";
    case "high-stakes-qa":
      return "High-pressure public Q&A after major announcement.";
    case "job-interview":
    default:
      return "Structured hiring interview room.";
  }
}

function defaultGoal(input: CommunicationScenarioInput) {
  if ((input.scenarioType ?? "interview") === "role-experience") {
    return `Experience what it is like to perform as ${input.jobType} under realistic conditions.`;
  }

  if (isServiceRole(input)) {
    return `Practice a realistic ${input.jobType} interview with conversational pressure and clear hiring signals.`;
  }

  switch (input.interviewType) {
    case "technical-interview":
      return `Demonstrate technical depth and clear problem solving for ${input.jobType}.`;
    case "case-interview":
      return "Structure ambiguous problems clearly and defend recommendations.";
    case "startup-pitch":
      return "Convince evaluators of market, execution, and defensibility.";
    case "panel-presentation":
      return "Present with clarity under challenge from multiple stakeholders.";
    case "press-interview":
      return "Maintain composure and deliver clear, credible messaging.";
    case "high-stakes-qa":
      return "Handle difficult questions without losing structure or confidence.";
    case "job-interview":
    default:
      return `Earn strong confidence for the ${input.jobType} role.`;
  }
}

function defaultTimeLimitMinutes(input: CommunicationScenarioInput) {
  const role = input.jobType.toLowerCase();
  const isJaneStreet = role.includes("jane street");

  if (isJaneStreet) {
    // Practical approximation of Jane Street interview-day duration.
    return 300;
  }

  if ((input.scenarioType ?? "interview") === "role-experience") {
    return 20;
  }

  if (isServiceRole(input)) {
    return 18;
  }

  switch (input.interviewType) {
    case "technical-interview":
    case "case-interview":
      return 40;
    case "panel-presentation":
      return 30;
    case "press-interview":
    case "high-stakes-qa":
      return 25;
    case "startup-pitch":
      return 20;
    case "job-interview":
    default:
      return 30;
  }
}

export function generateCommunicationScenario(
  input: CommunicationScenarioInput,
): CommunicationScenario {
  const framework = buildFramework(input);
  const specificityLevel = inferSpecificity(input);
  const realismMode = inferRealismMode(input);
  const worldModel = buildWorldModel(input, framework, specificityLevel, realismMode);
  const interviewerCount = Math.max(1, Math.min(input.interviewerCount, 5));
  const timeLimitSeconds = Math.max(
    300,
    (input.timeLimitMinutes ?? defaultTimeLimitMinutes(input)) * 60,
  );

  return {
    id: createId("comms_scenario"),
    role: input.jobType,
    setting:
      input.setting ??
      (isServiceRole(input)
        ? "Busy counter-service restaurant interview setting with light ambient noise."
        : defaultSetting(input.interviewType)),
    goal: input.goal ?? defaultGoal(input),
    timeLimitSeconds,
    participantCount: interviewerCount + 1,
    difficultyLevel: input.difficultyLevel,
    interviewType: input.interviewType,
    scenarioType: input.scenarioType ?? "interview",
    specificityLevel,
    realismMode,
    industry: input.industry,
    tone: input.tone,
    framework,
    worldModel,
    constraints: input.constraints,
    personas: createPersonasForScenario({
      interviewType: input.interviewType,
      tone: input.tone,
      difficultyLevel: input.difficultyLevel,
      interviewerCount,
      interviewerPersonality: framework.interviewerPersonality,
    }),
  };
}
