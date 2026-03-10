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

export class TurnProcessor {
  constructor(
    private readonly stateReducer: StateReducer,
    private readonly eventSelector: EventSelector,
    private readonly memorySummarizer: MemorySummarizer,
    private readonly policyGuard: PolicyGuard,
    private readonly textGenerator = new OpenAITextGenerator(),
  ) {}

  async process(world: WorldDefinition, session: SessionRecord, input: TurnInput) {
    const policy = this.policyGuard.check(input, world);

    if (!policy.allowed) {
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
        audioDirectives: [
          { type: "speak", voice: "alloy", text: policy.reason ?? "That request cannot be carried out." },
        ],
      });

      return {
        session,
        turn: {
          id: createId("turn"),
          sessionId: session.id,
          stateVersion: session.currentStateVersion,
          input,
          result: blocked,
          stateDeltaSummary: "No state change due to policy guard.",
          createdAt: new Date().toISOString(),
        } satisfies TurnRecord,
      };
    }

    const activeEvent = this.eventSelector.select(world, session.state);
    const { nextState, summary } = this.stateReducer.applyTurn({
      world,
      state: session.state,
      input,
      activeEvent,
    });

    if (activeEvent) {
      activeEvent.actorIds.forEach((actorId) => {
        const relationship = nextState.relationships[actorId];
        if (relationship) {
          relationship.recentMemory = this.memorySummarizer.summarize(
            relationship.recentMemory,
            `Turn ${nextState.turnCount}: ${summary}`,
          );
        }
      });
    }

    const generated = await this.textGenerator.generateTurn({
      world,
      state: nextState,
      activeEvent,
      input,
    });

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
      audioDirectives: generated.audioDirectives,
    });

    const updatedSession: SessionRecord = {
      ...session,
      currentStateVersion: session.currentStateVersion + 1,
      lastActiveAt: new Date().toISOString(),
      state: nextState,
    };

    return {
      session: updatedSession,
      turn: {
        id: createId("turn"),
        sessionId: session.id,
        stateVersion: updatedSession.currentStateVersion,
        input,
        result,
        stateDeltaSummary: summary,
        createdAt: updatedSession.lastActiveAt,
      } satisfies TurnRecord,
    };
  }
}
