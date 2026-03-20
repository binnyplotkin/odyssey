import { createId } from "@odyssey/utils";
import {
  CommunicationScenarioType,
  InterviewerPersonality,
  ScenarioTone,
  SimulationPersona,
} from "./types";

const personaNamePool = [
  "Avery Chen",
  "Jordan Patel",
  "Maya Thompson",
  "Noah Rivera",
  "Priya Kapoor",
];

function roleForType(type: CommunicationScenarioType, index: number) {
  if (type === "startup-pitch") {
    return index === 0 ? "Lead Investor" : "Partner";
  }
  if (type === "press-interview") {
    return index === 0 ? "Anchor" : "Senior Reporter";
  }
  if (type === "technical-interview") {
    return index === 0 ? "Staff Engineer" : "Engineering Manager";
  }
  if (type === "case-interview") {
    return index === 0 ? "Case Interviewer" : "Principal";
  }
  if (type === "panel-presentation") {
    return index === 0 ? "Panel Chair" : "Panel Member";
  }
  if (type === "high-stakes-qa") {
    return index === 0 ? "Primary Examiner" : "Examiner";
  }
  return index === 0 ? "Hiring Manager" : "Interviewer";
}

function toneToTemperament(tone: ScenarioTone, index: number) {
  if (tone === "aggressive") {
    return index === 0 ? "aggressive" : "skeptical";
  }
  if (tone === "supportive") {
    return index === 0 ? "warm" : "calm";
  }
  return index % 2 === 0 ? "skeptical" : "calm";
}

function personalityToTemperament(personality: InterviewerPersonality, index: number) {
  switch (personality) {
    case "warm-supportive":
      return index === 0 ? "warm" : "calm";
    case "neutral-efficient":
      return index % 2 === 0 ? "calm" : "skeptical";
    case "skeptical-probing":
      return index === 0 ? "skeptical" : "calm";
    case "intimidating-high-pressure":
      return index === 0 ? "aggressive" : "skeptical";
    case "disengaged-distracted":
      return "calm";
    case "highly-analytical":
      return "skeptical";
    default:
      return toneToTemperament("balanced", index);
  }
}

function difficultyToInterruptionTendency(level: number, index: number) {
  const base = 0.1 + level * 0.055;
  return Math.min(0.9, base + index * 0.07);
}

export function createPersonasForScenario(params: {
  interviewType: CommunicationScenarioType;
  tone: ScenarioTone;
  difficultyLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  interviewerCount: number;
  interviewerPersonality?: InterviewerPersonality;
}): SimulationPersona[] {
  return Array.from({ length: params.interviewerCount }).map((_, index) => {
    const temperament = params.interviewerPersonality
      ? personalityToTemperament(params.interviewerPersonality, index)
      : toneToTemperament(params.tone, index);
    const aggressive = temperament === "aggressive";
    const skeptical = temperament === "skeptical";
    const objectionStyle = aggressive
      ? "interrupting"
      : skeptical
        ? "probing"
        : "passive";

    return {
      id: createId("persona"),
      name: personaNamePool[index % personaNamePool.length],
      role: roleForType(params.interviewType, index),
      temperament,
      agenda:
        index === 0
          ? "Test strategic quality of decisions under pressure."
          : "Test communication quality and adaptability.",
      objectionStyle,
      patienceThreshold: Math.max(8, 92 - params.difficultyLevel * 6 - index * 5),
      interruptionTendency: difficultyToInterruptionTendency(params.difficultyLevel, index),
      emotionalTone: aggressive
        ? "adversarial"
        : skeptical
          ? "critical"
          : params.tone === "supportive"
            ? "supportive"
            : "neutral",
    };
  });
}
