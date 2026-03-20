import {
  InterviewFramework,
  InterviewPhase,
  InterviewQuestionCategory,
  InterviewerPersonality,
  SpecificityLevel,
  ScoreBreakdown,
  SimulationPersona,
} from "./types";

const questionBank: Record<InterviewQuestionCategory, string[]> = {
  background: [
    "Tell me a little about yourself and what brings you here.",
    "Walk me through your background and why this role is a fit right now.",
  ],
  behavioral: [
    "Tell me about a time you handled a difficult situation with a teammate.",
    "Describe a moment you took ownership when things were not going smoothly.",
  ],
  situational: [
    "If priorities conflict and time is short, how would you decide what to do first?",
    "If a customer or stakeholder is upset, how would you handle the conversation?",
  ],
  technical: [
    "Explain how you would break down this technical problem before implementing.",
    "How would you debug a major issue when you have limited information?",
  ],
  logical: [
    "Talk through your reasoning process step by step for an ambiguous problem.",
    "How would you compare two options with different risks and tradeoffs?",
  ],
  hypothetical: [
    "Imagine this plan fails in two weeks. What early signal would you have missed?",
    "If you had to make this decision with incomplete data, what would you do?",
  ],
  "stress-test": [
    "Your answer is not clear yet. Tighten it and give one concrete example.",
    "You have 30 seconds. Give your final recommendation and one key risk.",
  ],
  "culture-fit": [
    "What kind of team environment helps you do your best work?",
    "Why should we hire you for this role over another candidate?",
  ],
};

function questionForCategory(
  category: InterviewQuestionCategory,
  turnNumber: number,
  framework: InterviewFramework,
) {
  const base = questionBank[category][turnNumber % questionBank[category].length];

  if (framework.roleLevel === 1) {
    if (category === "background") {
      return "Let's start simple. Tell me a little about yourself.";
    }
    if (category === "situational") {
      return "If it gets busy and stressful, how would you stay calm and keep moving?";
    }
    return base;
  }

  if (framework.roleLevel >= 4 && (category === "logical" || category === "stress-test")) {
    return `${base} Keep it concise and precise.`;
  }

  return base;
}

function phaseForTurn(turnNumber: number): InterviewPhase {
  if (turnNumber <= 1) return "arrival";
  if (turnNumber <= 3) return "warm-up";
  if (turnNumber <= 7) return "core-evaluation";
  if (turnNumber <= 10) return "deep-dive";
  return "closing";
}

function categoryForTurn(params: {
  phase: InterviewPhase;
  turnNumber: number;
  framework: InterviewFramework;
}): InterviewQuestionCategory {
  const categories = params.framework.questionCategories;

  if (params.phase === "arrival") {
    return "background";
  }
  if (params.phase === "warm-up") {
    return categories.includes("background") ? "background" : "behavioral";
  }
  if (params.phase === "deep-dive") {
    if (categories.includes("stress-test")) return "stress-test";
    if (categories.includes("logical")) return "logical";
    if (categories.includes("technical")) return "technical";
    return "hypothetical";
  }
  if (params.phase === "closing") {
    return categories.includes("culture-fit") ? "culture-fit" : "behavioral";
  }

  return categories[params.turnNumber % categories.length] ?? "behavioral";
}

function openingForPersonality(personality: InterviewerPersonality, roleLevel: number) {
  if (roleLevel === 1) {
    return "Hi, nice to meet you. Thanks for coming in today.";
  }
  switch (personality) {
    case "warm-supportive":
      return "Great to meet you. We'll keep this conversational and practical.";
    case "neutral-efficient":
      return "Thanks for joining. We'll move through this in a structured way.";
    case "skeptical-probing":
      return "Let's get started. I'll ask direct follow-ups as we go.";
    case "intimidating-high-pressure":
      return "We'll run this quickly and challenge assumptions. Think out loud.";
    case "disengaged-distracted":
      return "Thanks for coming in. Let's jump right into it.";
    case "highly-analytical":
      return "We'll focus on reasoning quality and precision today.";
    default:
      return "Let's begin.";
  }
}

function followUpForResponse(params: {
  score: ScoreBreakdown;
  category: InterviewQuestionCategory;
  roleLevel: number;
}) {
  if (params.score.overall < 50) {
    return "Can you give me a more specific example?";
  }
  if (params.score.overall >= 84) {
    return params.roleLevel >= 4
      ? "Why did you choose that approach over the strongest alternative?"
      : "Good. What would you do as a next step?";
  }
  if (params.category === "technical" || params.category === "logical") {
    return "Clarify your reasoning one more step so I can follow your logic.";
  }
  return "Okay. Keep going.";
}

export function generatePersonaReactions(params: {
  personas: SimulationPersona[];
  score: ScoreBreakdown;
  difficulty: number;
  transcript: string;
  roleContext?: string;
  industry?: string;
  framework: InterviewFramework;
}) {
  const lower = params.transcript.toLowerCase();
  const explicitMiss =
    /i don't know|i do not know|not sure|no idea|i can't answer|cannot answer/.test(lower);

  return params.personas.map((persona, index) => {
    const interrupt = persona.interruptionTendency > 0.5 && params.difficulty >= 5 && index === 0;
    const expression =
      explicitMiss || params.score.overall < 40
        ? ("confused" as const)
        : params.score.overall < 55
          ? ("critical" as const)
          : params.score.overall < 72
            ? ("skeptical" as const)
            : params.score.overall >= 86
              ? ("approving" as const)
              : ("neutral" as const);
    const emotionalImpact =
      expression === "approving"
        ? ("calming" as const)
        : expression === "neutral"
          ? ("neutral" as const)
          : ("pressuring" as const);

    const personality = params.framework.interviewerPersonality;
    const tonePrefix =
      personality === "intimidating-high-pressure"
        ? "Interviewer expression: intense, impatient. "
        : personality === "highly-analytical"
          ? "Interviewer expression: analytical, focused. "
          : personality === "warm-supportive"
            ? "Interviewer expression: engaged, encouraging. "
            : expression === "critical"
              ? "Interviewer expression: stern, concerned. "
              : expression === "skeptical"
                ? "Interviewer expression: skeptical, probing. "
                : expression === "confused"
                  ? "Interviewer expression: confused, furrowed brow. "
                  : expression === "approving"
                    ? "Interviewer expression: subtle nod, engaged. "
                    : "";

    const alignedReaction =
      expression === "approving"
        ? "Strong answer. Keep this level of clarity."
        : expression === "neutral"
          ? "Solid baseline. Be a bit more specific."
          : expression === "skeptical"
            ? "Tighten your logic and give one concrete example."
            : expression === "critical"
              ? "This response is below expected bar. Be direct and structured."
              : "This answer signals low readiness. Reset and try again clearly.";

    return {
      personaId: persona.id,
      text:
        tonePrefix +
        (explicitMiss
          ? "That answer sounds unprepared. Give your best practical attempt."
          : alignedReaction),
      interrupt,
      expression,
      emotionalImpact,
    };
  });
}

export function chooseNextPrompt(params: {
  interviewType: string;
  turnNumber: number;
  difficulty: number;
  priorScore: ScoreBreakdown;
  roleContext?: string;
  industry?: string;
  framework: InterviewFramework;
  specificityLevel: SpecificityLevel;
  constraints?: {
    characterRoles?: string[];
    emotionalDynamics?: string;
    scenarioStructure?: string;
    knowledgeDomain?: string;
    toneStyle?: string;
    environmentalDetails?: string;
    pressurePattern?: string;
  };
  knowledgeModel?: {
    stableFacts: Array<{ summary: string }>;
    currentFacts: Array<{ summary: string }>;
  };
}): { prompt: string; phase: InterviewPhase; category: InterviewQuestionCategory } {
  const phase = phaseForTurn(params.turnNumber);
  const category = categoryForTurn({
    phase,
    turnNumber: params.turnNumber,
    framework: params.framework,
  });

  if (phase === "arrival") {
    return {
      prompt: `${openingForPersonality(params.framework.interviewerPersonality, params.framework.roleLevel)} ${
        params.framework.roleLevel === 1
          ? "Can you confirm which interview you are here for?"
          : "Give a short opening introduction."
      }`,
      phase,
      category,
    };
  }

  const question = questionForCategory(category, params.turnNumber, params.framework);
  const followUp = followUpForResponse({
    score: params.priorScore,
    category,
    roleLevel: params.framework.roleLevel,
  });
  const pressure =
    params.difficulty >= 8 || params.framework.interviewerPersonality === "intimidating-high-pressure"
      ? " Keep it concise."
      : "";
  const specificityTailoring =
    params.specificityLevel === "high"
      ? [
          params.constraints?.knowledgeDomain ? `Stay grounded in ${params.constraints.knowledgeDomain}.` : "",
          params.constraints?.emotionalDynamics ? `Maintain ${params.constraints.emotionalDynamics} dynamics.` : "",
          params.constraints?.pressurePattern ? `Apply ${params.constraints.pressurePattern} pressure pattern.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : params.specificityLevel === "broad"
        ? "Use practical defaults and keep pacing natural."
        : "";
  const groundingHint =
    params.knowledgeModel && (params.knowledgeModel.currentFacts.length || params.knowledgeModel.stableFacts.length)
      ? `Ground your response in this context: ${
          (params.knowledgeModel.currentFacts[0]?.summary ?? params.knowledgeModel.stableFacts[0]?.summary ?? "").slice(
            0,
            140,
          )
        }`
      : "";

  return {
    prompt: `${question} ${followUp}${pressure} ${specificityTailoring} ${groundingHint}`.trim(),
    phase,
    category,
  };
}
