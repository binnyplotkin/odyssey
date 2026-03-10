import { EventTemplate, SimulationState, TurnInput, TurnResult, WorldDefinition } from "@/types/simulation";

export interface SpeechToTextAdapter {
  transcribe(input: { audioBase64: string; mimeType: string }): Promise<string>;
}

export interface TextGenerationAdapter {
  generateTurn(params: {
    world: WorldDefinition;
    state: SimulationState;
    activeEvent: EventTemplate | null;
    input: TurnInput;
    onTextDelta?: (delta: string) => void | Promise<void>;
  }): Promise<Pick<TurnResult, "narration" | "dialogue" | "uiChoices" | "audioDirectives">>;
}

export interface TextToSpeechAdapter {
  synthesize(params: { text: string; voice: string }): Promise<{ audioBase64: string; mimeType: string } | null>;
}

export interface WorldLoader {
  listWorlds(): Promise<WorldDefinition[]>;
  getWorld(worldId: string): Promise<WorldDefinition | null>;
}

export interface EventSelector {
  select(world: WorldDefinition, state: SimulationState): EventTemplate | null;
}

export interface StateReducer {
  applyTurn(params: {
    world: WorldDefinition;
    state: SimulationState;
    input: TurnInput;
    activeEvent: EventTemplate | null;
  }): { nextState: SimulationState; summary: string };
}

export interface MemorySummarizer {
  summarize(previous: string[], addition: string): string[];
}

export interface PolicyGuard {
  check(input: TurnInput, world: WorldDefinition): { allowed: boolean; reason?: string };
}
