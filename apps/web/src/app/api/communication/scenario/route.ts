import { NextRequest, NextResponse } from "next/server";
import {
  AudioCommunicationSimulationEngine,
  CommunicationScenarioInput,
  OpenAIWebKnowledgeRetriever,
} from "@odyssey/engine";
import { communicationSessions } from "@/lib/communication-session-store";

const engine = new AudioCommunicationSimulationEngine({
  knowledgeRetriever: new OpenAIWebKnowledgeRetriever(),
});

function parseInput(body: Partial<CommunicationScenarioInput>): CommunicationScenarioInput {
  const level = Number(body.difficultyLevel ?? 5);
  const interviewerCount = Number(body.interviewerCount ?? 2);

  return {
    scenarioType: body.scenarioType,
    realismMode: body.realismMode,
    jobType: body.jobType ?? "Product Manager",
    interviewType: body.interviewType ?? "job-interview",
    industry: body.industry ?? "Technology",
    difficultyLevel: Math.max(1, Math.min(10, Math.round(level))) as
      | 1
      | 2
      | 3
      | 4
      | 5
      | 6
      | 7
      | 8
      | 9
      | 10,
    interviewerCount: Math.max(1, Math.min(5, Math.round(interviewerCount))),
    tone: body.tone ?? "balanced",
    setting: body.setting,
    goal: body.goal,
    timeLimitMinutes: body.timeLimitMinutes ?? 12,
    specificityLevel: body.specificityLevel,
    constraints: body.constraints,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<CommunicationScenarioInput> & {
      enableRetrieval?: "off" | "auto" | "on";
    };
    const input = parseInput(body);
    const session = await engine.startSessionWithRetrieval(input, body.enableRetrieval ?? "auto");
    communicationSessions.set(session.sessionId, session);

    return NextResponse.json({
      sessionId: session.sessionId,
      scenario: session.scenario,
      currentPrompt: session.currentPrompt,
      activeDifficulty: session.activeDifficulty,
      remainingSeconds: session.remainingSeconds,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create simulation scenario." },
      { status: 500 },
    );
  }
}
