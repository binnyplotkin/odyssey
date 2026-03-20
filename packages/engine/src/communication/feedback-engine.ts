import {
  InterviewFramework,
  ScoreBreakdown,
  SimulationFeedbackReport,
  SimulationTurnRecord,
} from "./types";

function aggregateBreakdown(turns: SimulationTurnRecord[]): ScoreBreakdown {
  const totals = turns.reduce(
    (acc, turn) => {
      acc.answerQuality += turn.score.answerQuality;
      acc.clarityStructure += turn.score.clarityStructure;
      acc.confidence += turn.score.confidence;
      acc.composure += turn.score.composure;
      acc.adaptability += turn.score.adaptability;
      acc.concision += turn.score.concision;
      acc.persuasion += turn.score.persuasion;
      acc.overall += turn.score.overall;
      return acc;
    },
    {
      answerQuality: 0,
      clarityStructure: 0,
      confidence: 0,
      composure: 0,
      adaptability: 0,
      concision: 0,
      persuasion: 0,
      overall: 0,
    },
  );

  const divisor = Math.max(1, turns.length);
  return {
    answerQuality: Math.round(totals.answerQuality / divisor),
    clarityStructure: Math.round(totals.clarityStructure / divisor),
    confidence: Math.round(totals.confidence / divisor),
    composure: Math.round(totals.composure / divisor),
    adaptability: Math.round(totals.adaptability / divisor),
    concision: Math.round(totals.concision / divisor),
    persuasion: Math.round(totals.persuasion / divisor),
    overall: Math.round(totals.overall / divisor),
  };
}

function topStrengths(breakdown: ScoreBreakdown) {
  const pairs: Array<[string, number]> = [
    ["Clarity & structure", breakdown.clarityStructure],
    ["Confidence", breakdown.confidence],
    ["Composure", breakdown.composure],
    ["Adaptability", breakdown.adaptability],
    ["Concision", breakdown.concision],
    ["Persuasion", breakdown.persuasion],
  ];
  return pairs
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);
}

function topWeaknesses(breakdown: ScoreBreakdown) {
  const pairs: Array<[string, number]> = [
    ["Answer quality", breakdown.answerQuality],
    ["Clarity & structure", breakdown.clarityStructure],
    ["Confidence", breakdown.confidence],
    ["Composure", breakdown.composure],
    ["Adaptability", breakdown.adaptability],
    ["Concision", breakdown.concision],
    ["Persuasion", breakdown.persuasion],
  ];
  return pairs
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([label]) => label);
}

function isServiceScenario(turns: SimulationTurnRecord[]) {
  const joinedPrompts = turns.map((turn) => turn.prompt.toLowerCase()).join(" ");
  return /availability|transportation|rude customer|order|crew member|manager lisa|lunch rush/.test(
    joinedPrompts,
  );
}

function buildServiceEvaluation(turns: SimulationTurnRecord[]) {
  const latest = turns[turns.length - 1];
  const sorted = [...turns].sort((a, b) => b.score.overall - a.score.overall);
  const lowest = [...turns].sort((a, b) => a.score.overall - b.score.overall);
  const best = sorted[0];
  const weak = lowest[0];
  const vague =
    turns.find((turn) => turn.transcript.trim().split(/\s+/).length < 10) ?? weak ?? latest;
  const avg = (values: number[]) =>
    Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));

  return {
    confidence: avg(turns.map((turn) => turn.score.confidence)),
    clarity: avg(turns.map((turn) => turn.score.clarityStructure)),
    professionalism: avg(turns.map((turn) => turn.score.composure)),
    customerServiceReadiness: avg(turns.map((turn) => (turn.score.adaptability + turn.score.persuasion) / 2)),
    reliabilityHireability: avg(turns.map((turn) => turn.score.answerQuality)),
    strongestMoment: best
      ? `Turn ${best.turnNumber}: "${best.prompt}" (${best.score.overall}/100).`
      : "No strong moment captured yet.",
    weakestMoment: weak
      ? `Turn ${weak.turnNumber}: "${weak.prompt}" (${weak.score.overall}/100).`
      : "No weak moment captured yet.",
    bestAnswer: best?.transcript ?? "No answer captured.",
    tooVagueAnswer: vague?.transcript ?? "No vague answer detected.",
    followUpSuggestion:
      "Practice direct 20-30 second answers that include reliability, availability, and a calm customer-service approach.",
  };
}

export function buildSimulationFeedbackReport(
  turns: SimulationTurnRecord[],
  framework?: InterviewFramework,
): SimulationFeedbackReport {
  const breakdown = aggregateBreakdown(turns);
  const allCorrect = turns.length > 0 && turns.every((turn) => turn.answeredCorrectly);
  const overallScore = allCorrect ? 100 : breakdown.overall;
  const communicationScore = Math.round(
    breakdown.clarityStructure * 0.4 + breakdown.confidence * 0.3 + breakdown.composure * 0.3,
  );
  const hireabilityScore = Math.round(
    breakdown.answerQuality * 0.35 +
      breakdown.adaptability * 0.2 +
      breakdown.concision * 0.15 +
      communicationScore * 0.3,
  );
  const strengths = topStrengths(breakdown).map(
    (item) => `${item}: consistently above your session average.`,
  );
  const weaknesses = topWeaknesses(breakdown).map(
    (item) => `${item}: prioritize this in your next practice round.`,
  );
  const keyMoments = turns.slice(-3).map(
    (turn) =>
      `Turn ${turn.turnNumber}: scored ${turn.score.overall}/100 after prompt "${turn.prompt}"`,
  );
  const serviceEvaluation = isServiceScenario(turns) ? buildServiceEvaluation(turns) : undefined;
  const roleSpecificFeedback = framework
    ? framework.evaluationCriteria.map((criterion) =>
        breakdown.overall >= 75
          ? `${criterion}: strong signal in this session.`
          : `${criterion}: needs stronger evidence in your answers.`,
      )
    : ["Provide more role-specific examples tied to outcomes."];
  const missedOpportunities = turns
    .filter((turn) => turn.score.overall < 65)
    .slice(0, 3)
    .map((turn) => `Turn ${turn.turnNumber}: missed chance to answer "${turn.prompt}" with a concrete example.`);

  return {
    overallScore,
    breakdown,
    communicationScore,
    hireabilityScore,
    roleSpecificFeedback,
    missedOpportunities,
    serviceEvaluation,
    strengths,
    weaknesses,
    keyMoments,
    improvedAnswerExamples: [
      "Answer in 3 steps: context, decision, measurable impact.",
      "State your recommendation in the first sentence, then justify it with one metric.",
      "Name one risk and one mitigation to show judgment under pressure.",
    ],
    recommendedNextScenario:
      breakdown.overall >= 80
        ? "Increase difficulty by one level and move to panel presentation mode."
        : "Repeat this scenario at current difficulty and focus on weaker categories.",
  };
}
