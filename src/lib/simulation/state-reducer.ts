import { StateReducer } from "@/lib/simulation/interfaces";
import { clamp } from "@/lib/utils";
import { SimulationState, TurnInput, WorldDefinition } from "@/types/simulation";

function scoreText(input: string, positiveWords: string[], negativeWords: string[]) {
  const lowered = input.toLowerCase();
  const positive = positiveWords.filter((word) => lowered.includes(word)).length;
  const negative = negativeWords.filter((word) => lowered.includes(word)).length;
  return positive - negative;
}

function updateCharacterState(value: number, delta: number) {
  return clamp(value + delta);
}

function copyState(state: SimulationState): SimulationState {
  return JSON.parse(JSON.stringify(state)) as SimulationState;
}

export class HeuristicStateReducer implements StateReducer {
  applyTurn({
    state,
    input,
    activeEvent,
  }: {
    world: WorldDefinition;
    state: SimulationState;
    input: TurnInput;
    activeEvent: { id: string; actorIds: string[]; category: string } | null;
  }) {
    const nextState = copyState(state);
    nextState.turnCount += 1;

    const mercyScore = scoreText(
      input.text,
      ["mercy", "pardon", "forgive", "release", "feed", "reduce taxes", "negotiate"],
      ["execute", "hang", "punish", "tax harder", "burn", "crush"],
    );

    const forceScore = scoreText(
      input.text,
      ["mobilize", "march", "punish", "seize", "command", "discipline"],
      ["delay", "wait", "hesitate", "retreat"],
    );

    nextState.publicSentiment = updateCharacterState(
      nextState.publicSentiment,
      mercyScore * 4 - Math.max(forceScore, 0),
    );
    nextState.politicalStability = updateCharacterState(
      nextState.politicalStability,
      Math.max(forceScore, 0) * 2 + mercyScore,
    );
    nextState.treasury = updateCharacterState(
      nextState.treasury,
      scoreText(input.text, ["tax", "levy", "seize", "ration"], ["spend", "grant", "compensate"]) *
        5,
    );
    nextState.militaryPressure = updateCharacterState(
      nextState.militaryPressure,
      -forceScore * 3 + scoreText(input.text, ["delay", "appease", "ignore"], ["mobilize"]) * 2,
    );

    if (activeEvent) {
      nextState.activeEventId = activeEvent.id;
      nextState.lastEventIds = [...nextState.lastEventIds, activeEvent.id].slice(-5);
    }

    Object.entries(nextState.relationships).forEach(([characterId, relationship]) => {
      const isActiveActor = activeEvent?.actorIds.includes(characterId) ?? false;
      const trustDelta = mercyScore * (isActiveActor ? 3 : 1) - Math.max(forceScore, 0);
      const fearDelta = Math.max(forceScore, 0) * 3 - Math.max(mercyScore, 0);
      const loyaltyDelta = trustDelta > 0 ? 2 : -1;

      relationship.trust = updateCharacterState(relationship.trust, trustDelta);
      relationship.fear = updateCharacterState(relationship.fear, fearDelta);
      relationship.loyalty = updateCharacterState(relationship.loyalty, loyaltyDelta);

      const characterState = nextState.characterStates[characterId];
      if (characterState) {
        characterState.anger = updateCharacterState(characterState.anger, Math.max(forceScore, 0));
        characterState.hope = updateCharacterState(characterState.hope, mercyScore * 2);
        characterState.fear = updateCharacterState(characterState.fear, fearDelta);
        characterState.loyalty = updateCharacterState(characterState.loyalty, loyaltyDelta);
      }
    });

    const summary = [
      `Public sentiment ${mercyScore >= 0 ? "rose" : "fell"} to ${nextState.publicSentiment}.`,
      `Political stability shifted to ${nextState.politicalStability}.`,
      `Treasury is now ${nextState.treasury}.`,
      `Military pressure is now ${nextState.militaryPressure}.`,
    ].join(" ");

    return { nextState, summary };
  }
}
