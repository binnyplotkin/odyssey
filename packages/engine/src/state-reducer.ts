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

    // v2: ensure all v2 fields are initialized (safe for inline state objects)
    nextState.eventOccurrenceCounts ??= {};
    nextState.eventLastFiredTurn ??= {};
    nextState.completedEventIds ??= [];
    nextState.groupDispositions ??= {};
    nextState.groupCohesion ??= {};
    nextState.groupVolatility ??= {};
    nextState.characterActive ??= {};
    nextState.currentPhase ??= 1;
    nextState.turnsInPhase ??= 0;
    nextState.worldFlags ??= {};
    nextState.narrativeMomentum ??= "stable";
    nextState.decisionsLog ??= [];
    nextState.playerReputation ??= 50;
    nextState.activeObjectives ??= [];
    nextState.npcRelationshipDeltas ??= [];
    nextState.environmentState ??= {};

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

      // v2: event tracking
      nextState.eventOccurrenceCounts[activeEvent.id] = (nextState.eventOccurrenceCounts[activeEvent.id] ?? 0) + 1;
      nextState.eventLastFiredTurn[activeEvent.id] = nextState.turnCount;

      // Check if event reached maxOccurrences
      const eventDef = world.eventTemplates.find((e) => e.id === activeEvent.id);
      if (eventDef?.maxOccurrences !== undefined && nextState.eventOccurrenceCounts[activeEvent.id] >= eventDef.maxOccurrences) {
        if (!nextState.completedEventIds.includes(activeEvent.id)) {
          nextState.completedEventIds.push(activeEvent.id);
        }
      }
    }

    // v2: progression tracking
    nextState.turnsInPhase += 1;

    // v2: decisions log (cap at 50 entries)
    nextState.decisionsLog.push({
      turnNumber: nextState.turnCount,
      eventId: activeEvent?.id ?? "free-action",
      choice: input.text.slice(0, 200),
    });
    if (nextState.decisionsLog.length > 50) {
      nextState.decisionsLog = nextState.decisionsLog.slice(-50);
    }

    // v2: player reputation
    nextState.playerReputation = clamp(nextState.playerReputation + mercyScore * 2 + forceScore);

    // v2: time context
    if (nextState.timeContext) {
      const timeSteps = ["morning", "afternoon", "evening", "night"] as const;
      const currentIdx = timeSteps.indexOf(nextState.timeContext.timeOfDay ?? "morning");
      const nextIdx = (currentIdx + 1) % timeSteps.length;
      nextState.timeContext.timeOfDay = timeSteps[nextIdx];
      if (nextIdx === 0) {
        nextState.timeContext.day += 1;
      }
    }

    // Apply group volatility scaling to groupInfluence deltas
    for (const group of world.groups) {
      const current = nextState.groupInfluence[group.id];
      if (current === undefined) continue;
      const groupVol = nextState.groupVolatility[group.id] ?? group.volatility ?? 50;
      const groupVolatilityMultiplier = groupVol / 50;
      const influenceDelta = Math.round((mercyScore + forceScore) * groupVolatilityMultiplier);
      nextState.groupInfluence[group.id] = clamp(current + influenceDelta);

      // v2: update runtime group cohesion and volatility based on influence changes
      const cohesion = nextState.groupCohesion[group.id] ?? group.cohesion ?? 50;
      const volatility = nextState.groupVolatility[group.id] ?? group.volatility ?? 50;
      // Cohesion erodes slightly when influence changes sharply
      nextState.groupCohesion[group.id] = clamp(cohesion + (influenceDelta > 0 ? 1 : -1));
      // Volatility increases with large swings
      nextState.groupVolatility[group.id] = clamp(volatility + (Math.abs(influenceDelta) > 2 ? 1 : -1));

      // v2: evaluate disposition triggers against runtime state
      if (group.dispositionTriggers?.length) {
        const influence = nextState.groupInfluence[group.id];
        const runtimeCohesion = nextState.groupCohesion[group.id] ?? group.cohesion ?? 50;
        for (const dt of [...group.dispositionTriggers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))) {
          const condMatch = dt.condition.match(/^(influence|cohesion)\s*(>|<|>=|<=)\s*(\d+)$/);
          if (!condMatch) continue;
          const [, metric, operator, thresholdStr] = condMatch;
          const val = metric === "cohesion" ? runtimeCohesion : influence;
          const threshold = Number(thresholdStr);
          let triggered = false;
          switch (operator) {
            case ">": triggered = val > threshold; break;
            case "<": triggered = val < threshold; break;
            case ">=": triggered = val >= threshold; break;
            case "<=": triggered = val <= threshold; break;
          }
          if (triggered) {
            nextState.groupDispositions[group.id] = dt.dispositionShift;
            break;
          }
        }
      }
    }

    Object.entries(nextState.relationships).forEach(([characterId, relationship]) => {
      const isActiveActor = activeEvent?.actorIds.includes(characterId) ?? false;
      const character = world.characters.find((c) => c.id === characterId);
      // volatility scales emotion swing: 50 = default (1x), 100 = 2x, 0 = 0x
      const volatilityMultiplier = (character?.emotionalBaseline.volatility ?? 50) / 50;

      const trustDelta = mercyScore * (isActiveActor ? 3 : 1) - Math.max(forceScore, 0);
      const fearDelta = Math.max(forceScore, 0) * 3 - Math.max(mercyScore, 0);
      const loyaltyDelta = trustDelta > 0 ? 2 : -1;

      const prevTrust = relationship.trust;
      const prevFear = relationship.fear;
      const prevLoyalty = relationship.loyalty;
      relationship.trust = updateCharacterState(relationship.trust, trustDelta);
      relationship.fear = updateCharacterState(relationship.fear, fearDelta);
      relationship.loyalty = updateCharacterState(relationship.loyalty, loyaltyDelta);

      // v2: respect tracks combined trust + loyalty signals
      if (relationship.respect !== undefined) {
        const respectDelta = Math.round((trustDelta + loyaltyDelta) / 2);
        relationship.respect = updateCharacterState(relationship.respect, respectDelta);
      }

      // v2: NPC relationship deltas (cap at 100 entries)
      const eventTitle = activeEvent ? world.eventTemplates.find((e) => e.id === activeEvent.id)?.title : undefined;
      if (relationship.trust !== prevTrust) {
        nextState.npcRelationshipDeltas.push({ characterId, metricId: "trust", delta: relationship.trust - prevTrust, reason: eventTitle, turnNumber: nextState.turnCount });
      }
      if (relationship.fear !== prevFear) {
        nextState.npcRelationshipDeltas.push({ characterId, metricId: "fear", delta: relationship.fear - prevFear, reason: eventTitle, turnNumber: nextState.turnCount });
      }
      if (relationship.loyalty !== prevLoyalty) {
        nextState.npcRelationshipDeltas.push({ characterId, metricId: "loyalty", delta: relationship.loyalty - prevLoyalty, reason: eventTitle, turnNumber: nextState.turnCount });
      }
      if (nextState.npcRelationshipDeltas.length > 100) {
        nextState.npcRelationshipDeltas = nextState.npcRelationshipDeltas.slice(-100);
      }

      const characterState = nextState.characterStates[characterId];
      if (characterState) {
        characterState.anger = updateCharacterState(characterState.anger, Math.round(Math.max(forceScore, 0) * volatilityMultiplier));
        characterState.hope = updateCharacterState(characterState.hope, Math.round(mercyScore * 2 * volatilityMultiplier));
        characterState.fear = updateCharacterState(characterState.fear, Math.round(fearDelta * volatilityMultiplier));
        characterState.loyalty = updateCharacterState(characterState.loyalty, Math.round(loyaltyDelta * volatilityMultiplier));
      }
    });

    // v2: narrative momentum heuristic
    const stability = getMetricValue(nextState, "stability");
    const pressure = getMetricValue(nextState, "pressure");
    if (stability < 25 && pressure > 70) {
      nextState.narrativeMomentum = "climax";
    } else if (mercyScore + forceScore > 0) {
      nextState.narrativeMomentum = "rising";
    } else if (mercyScore + forceScore < 0) {
      nextState.narrativeMomentum = "falling";
    } else {
      nextState.narrativeMomentum = "stable";
    }

    const summary = [
      `Morale ${mercyScore >= 0 ? "rose" : "fell"} to ${getMetricValue(nextState, "morale")}.`,
      `Stability shifted to ${getMetricValue(nextState, "stability")}.`,
      `Resources now ${getMetricValue(nextState, "resources")}.`,
      `Pressure is now ${getMetricValue(nextState, "pressure")}.`,
    ].join(" ");

    return { nextState, summary };
  }
}
