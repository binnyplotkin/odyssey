import { StateReducer } from "./interfaces";
import { clamp } from "@odyssey/utils";
import { SimulationState, TurnInput, WorldDefinition } from "@odyssey/types";
import { getMetricValue, setMetricValue } from "./metric-helpers";

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
    world,
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

    setMetricValue(nextState, "morale", updateCharacterState(
      getMetricValue(nextState, "morale"),
      mercyScore * 4 - Math.max(forceScore, 0),
    ));
    setMetricValue(nextState, "stability", updateCharacterState(
      getMetricValue(nextState, "stability"),
      Math.max(forceScore, 0) * 2 + mercyScore,
    ));
    setMetricValue(nextState, "resources", updateCharacterState(
      getMetricValue(nextState, "resources"),
      scoreText(input.text, ["tax", "levy", "seize", "ration"], ["spend", "grant", "compensate"]) *
        5,
    ));
    setMetricValue(nextState, "pressure", updateCharacterState(
      getMetricValue(nextState, "pressure"),
      -forceScore * 3 + scoreText(input.text, ["delay", "appease", "ignore"], ["mobilize"]) * 2,
    ));

    if (activeEvent) {
      nextState.activeEventId = activeEvent.id;
      nextState.lastEventIds = [...nextState.lastEventIds, activeEvent.id].slice(-5);
    }

    // Apply group volatility scaling to groupInfluence deltas
    for (const group of world.groups) {
      const current = nextState.groupInfluence[group.id];
      if (current === undefined) continue;
      const groupVolatility = (group.volatility ?? 50) / 50;
      const influenceDelta = Math.round((mercyScore + forceScore) * groupVolatility);
      nextState.groupInfluence[group.id] = clamp(current + influenceDelta);
    }

    Object.entries(nextState.relationships).forEach(([characterId, relationship]) => {
      const isActiveActor = activeEvent?.actorIds.includes(characterId) ?? false;
      const character = world.characters.find((c) => c.id === characterId);
      // volatility scales emotion swing: 50 = default (1x), 100 = 2x, 0 = 0x
      const volatilityMultiplier = (character?.emotionalBaseline.volatility ?? 50) / 50;

      const trustDelta = mercyScore * (isActiveActor ? 3 : 1) - Math.max(forceScore, 0);
      const fearDelta = Math.max(forceScore, 0) * 3 - Math.max(mercyScore, 0);
      const loyaltyDelta = trustDelta > 0 ? 2 : -1;

      relationship.trust = updateCharacterState(relationship.trust, trustDelta);
      relationship.fear = updateCharacterState(relationship.fear, fearDelta);
      relationship.loyalty = updateCharacterState(relationship.loyalty, loyaltyDelta);

      const characterState = nextState.characterStates[characterId];
      if (characterState) {
        characterState.anger = updateCharacterState(characterState.anger, Math.round(Math.max(forceScore, 0) * volatilityMultiplier));
        characterState.hope = updateCharacterState(characterState.hope, Math.round(mercyScore * 2 * volatilityMultiplier));
        characterState.fear = updateCharacterState(characterState.fear, Math.round(fearDelta * volatilityMultiplier));
        characterState.loyalty = updateCharacterState(characterState.loyalty, Math.round(loyaltyDelta * volatilityMultiplier));
      }
    });

    const summary = [
      `Morale ${mercyScore >= 0 ? "rose" : "fell"} to ${getMetricValue(nextState, "morale")}.`,
      `Stability shifted to ${getMetricValue(nextState, "stability")}.`,
      `Resources now ${getMetricValue(nextState, "resources")}.`,
      `Pressure is now ${getMetricValue(nextState, "pressure")}.`,
    ].join(" ");

    return { nextState, summary };
  }
}
