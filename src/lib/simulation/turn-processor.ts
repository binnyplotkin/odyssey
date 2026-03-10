import { OpenAITextGenerator } from "@/lib/simulation/generator";
import {
  EventSelector,
  MemorySummarizer,
  PolicyGuard,
  StateReducer,
} from "@/lib/simulation/interfaces";
import { createId } from "@/lib/utils";
import {
  SessionRecord,
  TurnInput,
  TurnRecord,
  turnResultSchema,
  WorldDefinition,
} from "@/types/simulation";

function buildVoiceDirectedAudio(params: {
  world: WorldDefinition;
  narration: Array<{ text: string }>;
  dialogue: Array<{ speaker: string; text: string }>;
  awaitInputText?: string;
}) {
  const narratorVoice = params.world.narratorVoice?.voiceId ?? "alloy";
  const speakerVoiceMap = new Map(
    params.world.characters.map((character) => [
      character.name.toLowerCase(),
      character.voice?.voiceId ?? narratorVoice,
    ]),
  );

  return [
    ...params.narration.map((segment) => ({
      type: "speak" as const,
      voice: narratorVoice,
      text: segment.text,
    })),
    ...params.dialogue.map((segment) => ({
      type: "speak" as const,
      voice: speakerVoiceMap.get(segment.speaker.toLowerCase()) ?? narratorVoice,
      text: `${segment.speaker}. ${segment.text}`,
    })),
    {
      type: "await-input" as const,
      voice: narratorVoice,
      text: params.awaitInputText ?? "The court waits for your next decree.",
    },
  ];
}

export type TurnTraceStep = {
  id: string;
  label: string;
  data: unknown;
};

type TraceRecorder = (step: TurnTraceStep) => void;

export class TurnProcessor {
  constructor(
    private readonly stateReducer: StateReducer,
    private readonly eventSelector: EventSelector,
    private readonly memorySummarizer: MemorySummarizer,
    private readonly policyGuard: PolicyGuard,
    private readonly textGenerator = new OpenAITextGenerator(),
  ) {}

  async process(
    world: WorldDefinition,
    session: SessionRecord,
    input: TurnInput,
    recordTrace?: TraceRecorder,
  ) {
    const trace = (id: string, label: string, data: unknown) => {
      recordTrace?.({ id, label, data });
    };

    const policy = this.policyGuard.check(input, world);
    trace("policy-check", "Policy Guard Check", policy);

    if (!policy.allowed) {
      const blockedAudio = buildVoiceDirectedAudio({
        world,
        narration: [{ text: policy.reason ?? "That request cannot be carried out." }],
        dialogue: [],
      });

      const blocked = turnResultSchema.parse({
        transcript: input.text,
        narration: [
          {
            id: createId("narration"),
            speaker: "narrator",
            text: policy.reason,
          },
        ],
        dialogue: [],
        uiChoices: ["Rephrase the command", "Ask for a lawful alternative"],
        visibleState: {
          politicalStability: session.state.politicalStability,
          publicSentiment: session.state.publicSentiment,
          treasury: session.state.treasury,
          militaryPressure: session.state.militaryPressure,
          factionInfluence: session.state.factionInfluence,
        },
        privateStateVersion: session.currentStateVersion,
        event: null,
        audioDirectives: blockedAudio,
      });

      trace("blocked-result", "Blocked Turn Result", blocked);

      const blockedTurn = {
        id: createId("turn"),
        sessionId: session.id,
        stateVersion: session.currentStateVersion,
        input,
        result: blocked,
        stateDeltaSummary: "No state change due to policy guard.",
        createdAt: new Date().toISOString(),
      } satisfies TurnRecord;

      trace("blocked-turn-record", "Blocked Turn Record", blockedTurn);

      return {
        session,
        turn: blockedTurn,
      };
    }

    const activeEvent = this.eventSelector.select(world, session.state);
    trace("event-selection", "Event Selection", activeEvent);

    const { nextState, summary } = this.stateReducer.applyTurn({
      world,
      state: session.state,
      input,
      activeEvent,
    });

    trace("state-reducer", "State Reducer Output", {
      summary,
      nextState,
    });

    const memoryUpdates: Array<{ actorId: string; before: string[]; after: string[] }> = [];

    if (activeEvent) {
      activeEvent.actorIds.forEach((actorId) => {
        const relationship = nextState.relationships[actorId];
        if (relationship) {
          const before = [...relationship.recentMemory];
          const after = this.memorySummarizer.summarize(
            before,
            `Turn ${nextState.turnCount}: ${summary}`,
          );
          relationship.recentMemory = after;
          memoryUpdates.push({ actorId, before, after });
        }
      });
    }

    trace("memory-updates", "Memory Summarizer Updates", memoryUpdates);

    const generated = await this.textGenerator.generateTurn({
      world,
      state: nextState,
      activeEvent,
      input,
    });
    const awaitInputDirective = generated.audioDirectives.find(
      (directive) => directive.type === "await-input",
    );
    const voiceDirectedAudio = buildVoiceDirectedAudio({
      world,
      narration: generated.narration,
      dialogue: generated.dialogue,
      awaitInputText: awaitInputDirective?.text,
    });

    trace("generation-output", "Text Generation Output", generated);

    const result = turnResultSchema.parse({
      transcript: input.text,
      narration: generated.narration,
      dialogue: generated.dialogue,
      uiChoices: generated.uiChoices,
      visibleState: {
        politicalStability: nextState.politicalStability,
        publicSentiment: nextState.publicSentiment,
        treasury: nextState.treasury,
        militaryPressure: nextState.militaryPressure,
        factionInfluence: nextState.factionInfluence,
      },
      privateStateVersion: session.currentStateVersion + 1,
      event: activeEvent
        ? {
            id: activeEvent.id,
            title: activeEvent.title,
            category: activeEvent.category,
            summary: activeEvent.summary,
          }
        : null,
      audioDirectives: voiceDirectedAudio,
    });

    trace("turn-result", "Turn Result Payload", result);

    const updatedSession: SessionRecord = {
      ...session,
      currentStateVersion: session.currentStateVersion + 1,
      lastActiveAt: new Date().toISOString(),
      state: nextState,
    };

    trace("session-update", "Updated Session State", updatedSession);

    const turnRecord = {
      id: createId("turn"),
      sessionId: session.id,
      stateVersion: updatedSession.currentStateVersion,
      input,
      result,
      stateDeltaSummary: summary,
      createdAt: updatedSession.lastActiveAt,
    } satisfies TurnRecord;

    trace("turn-record", "Turn Record", turnRecord);

    return {
      session: updatedSession,
      turn: turnRecord,
    };
  }
}
