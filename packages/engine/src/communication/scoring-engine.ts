import {
  InterviewFramework,
  ProcessCommunicationTurnInput,
  ScoreBreakdown,
  SpeechAnalysis,
} from "./types";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isServiceContext(params: {
  scenarioType?: string;
  interviewType: string;
  roleContext?: string;
  industry?: string;
  priorPrompt: string;
}) {
  const roleLower = (params.roleContext ?? "").toLowerCase();
  const industryLower = (params.industry ?? "").toLowerCase();
  const promptLower = params.priorPrompt.toLowerCase();

  return (
    (params.scenarioType ?? "interview") === "interview" &&
    params.interviewType === "job-interview" &&
    (/cashier|crew|barista|retail|customer service|front counter|restaurant/.test(roleLower) ||
      /service|retail|restaurant|hospitality/.test(industryLower) ||
      /availability|transportation|rude customer|order|lunch rush/.test(promptLower))
  );
}

function answerQualityScore(transcript: string, serviceMode: boolean) {
  const lower = transcript.toLowerCase();
  const explicitMiss =
    /i don't know|i do not know|not sure|no idea|i can't answer|cannot answer|i have no technical background|i don't have technical background|i dont have technical background/.test(
      lower,
    );
  if (explicitMiss) {
    return 8;
  }

  if (serviceMode) {
    const hasReliability =
      /on time|reliable|always show up|punctual|available|weekend|night|flexible schedule|transportation|ride/.test(
        lower,
      );
    const hasCustomerFocus =
      /customer|polite|calm|respectful|friendly|help|listen|apologize|fix/.test(lower);
    const hasTeamwork = /team|coworker|help each other|communicate|support/.test(lower);
    const direct = transcript.trim().split(/\s+/).length >= 8;

    return clamp(42 + (hasReliability ? 22 : 0) + (hasCustomerFocus ? 20 : 0) + (hasTeamwork ? 12 : 0) + (direct ? 8 : -18));
  }

  const hasEvidence = /metric|data|result|impact|revenue|users|retention|latency/i.test(transcript);
  const hasStructure = /first|second|third|because|therefore|for example/i.test(transcript);
  const hasDecision = /I would|my recommendation|I decided|I will/i.test(transcript);
  const weakSubstance = transcript.trim().split(/\s+/).length < 12;
  return clamp(
    45 +
      (hasEvidence ? 20 : 0) +
      (hasStructure ? 20 : 0) +
      (hasDecision ? 15 : 0) -
      (weakSubstance ? 20 : 0),
  );
}

function roleLevelWeightedBoost(
  transcript: string,
  framework: InterviewFramework,
  priorPrompt: string,
) {
  const lower = transcript.toLowerCase();

  if (framework.roleLevel === 1) {
    const reliability = /on time|reliable|show up|availability|transportation/.test(lower);
    const politeness = /thank you|appreciate|happy to|respectful/.test(lower);
    const energy = /excited|motivated|ready|eager/.test(lower);
    return clamp((reliability ? 10 : 0) + (politeness ? 8 : 0) + (energy ? 6 : 0), 0, 22);
  }

  if (framework.roleLevel === 2) {
    const initiative = /i took initiative|i started|i stepped up|i proposed/.test(lower);
    const teamwork = /team|collaborat|worked with/.test(lower);
    const problemSolve = /problem|resolve|fixed|improved/.test(lower);
    return clamp((initiative ? 8 : 0) + (teamwork ? 8 : 0) + (problemSolve ? 8 : 0), 0, 24);
  }

  if (framework.roleLevel === 3) {
    const structure = /first|second|third|approach|framework|step/.test(lower);
    const ownership = /i owned|i led|i delivered|i was responsible/.test(lower);
    const execution = /shipped|launched|implemented|executed/.test(lower);
    return clamp((structure ? 9 : 0) + (ownership ? 9 : 0) + (execution ? 8 : 0), 0, 26);
  }

  if (framework.roleLevel === 4) {
    const precision = /tradeoff|constraint|assumption|edge case|failure mode/.test(lower);
    const depth = /because|therefore|counterexample|alternative/.test(lower);
    const ambiguity = /given uncertainty|incomplete data|estimate|bound/.test(lower);
    return clamp((precision ? 10 : 0) + (depth ? 10 : 0) + (ambiguity ? 8 : 0), 0, 28);
  }

  const judgment = /decision|principle|long[- ]term|stakeholder|risk/.test(lower);
  const vision = /strategy|north star|roadmap|organizational/.test(lower);
  const tradeoffs = /tradeoff|upside|downside|mitigation/.test(lower);
  return clamp((judgment ? 10 : 0) + (vision ? 9 : 0) + (tradeoffs ? 9 : 0), 0, 28);
}

function isExpectedBaselinePrompt(prompt: string) {
  return /why|background|walk me through|opening statement|introduce|attracts you/i.test(
    prompt.toLowerCase(),
  );
}

function adaptabilityScore(transcript: string, priorPrompt: string) {
  if (!priorPrompt) {
    return 65;
  }

  const promptWords = new Set(
    priorPrompt
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 4),
  );
  const lowerTranscript = transcript.toLowerCase();
  let overlap = 0;
  promptWords.forEach((word) => {
    if (lowerTranscript.includes(word)) {
      overlap += 1;
    }
  });

  return clamp(52 + overlap * 10);
}

function persuasionScore(transcript: string, serviceMode: boolean) {
  if (serviceMode) {
    const lower = transcript.toLowerCase();
    const hasOwnership = /i would|i will|i'd|i can/.test(lower);
    const hasCalmUnderPressure = /stay calm|focused|prioritize|one step at a time|ask for help/.test(lower);
    const hasLearningMindset = /learn|improve|feedback|coachable|adapt/.test(lower);
    return clamp(50 + (hasOwnership ? 15 : 0) + (hasCalmUnderPressure ? 20 : 0) + (hasLearningMindset ? 15 : 0));
  }

  const hasCallToAction = /next step|recommend|proposal|commit|execute|ship|launch/i.test(transcript);
  const hasTradeoffLanguage = /tradeoff|risk|upside|downside|constraint|mitigation/i.test(transcript);
  const hasAudienceSignal = /for the team|for customers|for the business|for users/i.test(transcript);
  return clamp(50 + (hasCallToAction ? 20 : 0) + (hasTradeoffLanguage ? 20 : 0) + (hasAudienceSignal ? 10 : 0));
}

export function scoreCommunicationTurn(params: {
  input: ProcessCommunicationTurnInput;
  analysis: SpeechAnalysis;
  priorPrompt: string;
  scenarioType?: string;
  interviewType: string;
  roleContext?: string;
  industry?: string;
  framework: InterviewFramework;
}): ScoreBreakdown {
  const serviceMode = isServiceContext({
    scenarioType: params.scenarioType,
    interviewType: params.interviewType,
    roleContext: params.roleContext,
    industry: params.industry,
    priorPrompt: params.priorPrompt,
  });
  const lower = params.input.transcript.toLowerCase();
  const explicitMiss =
    /i don't know|i do not know|not sure|no idea|i can't answer|cannot answer|i have no technical background|i don't have technical background|i dont have technical background/.test(
      lower,
    );
  const answerQuality = answerQualityScore(params.input.transcript, serviceMode);
  const roleBoost = roleLevelWeightedBoost(
    params.input.transcript,
    params.framework,
    params.priorPrompt,
  );
  const clarityStructure = clamp((params.analysis.clarity + params.analysis.structure) / 2);
  const confidence = clamp(params.analysis.confidence - (explicitMiss ? 40 : 0));
  const composure = clamp(params.analysis.composure - (explicitMiss ? 25 : 0));
  const adaptability = adaptabilityScore(params.input.transcript, params.priorPrompt);
  const concision = clamp(params.analysis.responseLength - (explicitMiss ? 30 : 0));
  const persuasion = persuasionScore(params.input.transcript, serviceMode);

  const overall = clamp(
    (answerQuality + roleBoost) * 0.24 +
      clarityStructure * 0.16 +
      confidence * 0.14 +
      composure * 0.14 +
      adaptability * 0.12 +
      concision * 0.1 +
      persuasion * 0.1,
  );

  const baselinePrompt = isExpectedBaselinePrompt(params.priorPrompt);
  if (explicitMiss && baselinePrompt) {
    const forcedLow = 20;
    return {
      answerQuality: Math.min(answerQuality, 10),
      clarityStructure: Math.min(clarityStructure, 20),
      confidence: Math.min(confidence, 15),
      composure: Math.min(composure, 20),
      adaptability: Math.min(adaptability, 25),
      concision: Math.min(concision, 25),
      persuasion: Math.min(persuasion, 10),
      overall: forcedLow,
    };
  }

  return {
    answerQuality,
    clarityStructure,
    confidence,
    composure,
    adaptability,
    concision,
    persuasion,
    overall,
  };
}
