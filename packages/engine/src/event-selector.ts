import { EventSelector } from "./interfaces";
import { EventTemplate, SimulationState, WorldDefinition } from "@odyssey/types";
import { getMetricValue } from "./metric-helpers";

function eventMatchesState(event: EventTemplate, state: SimulationState, world: WorldDefinition) {
  // v2: skip completed events (reached maxOccurrences)
  if (state.completedEventIds?.includes(event.id)) return false;

  // v2: max occurrences check
  if (event.maxOccurrences !== undefined) {
    const count = (state.eventOccurrenceCounts ?? {})[event.id] ?? 0;
    if (count >= event.maxOccurrences) return false;
  }

  // v2: cooldown check
  if (event.cooldownTurns !== undefined) {
    const lastFired = (state.eventLastFiredTurn ?? {})[event.id];
    if (lastFired !== undefined && (state.turnCount - lastFired) < event.cooldownTurns) return false;
  }

  // Temporal: turn range filter
  if (event.turnRange) {
    if (state.turnCount < event.turnRange.min) return false;
    if (state.turnCount > event.turnRange.max) return false;
  }

  // Temporal: expiry check
  if (event.expiresAfterTurns !== undefined && state.turnCount > event.expiresAfterTurns) {
    return false;
  }

  // Chaining: prerequisite events must have fired (uses occurrence counts for reliability)
  if (event.prerequisiteEventIds?.length) {
    const counts = state.eventOccurrenceCounts ?? {};
    if (!event.prerequisiteEventIds.every((id) => (counts[id] ?? 0) > 0)) {
      return false;
    }
  }

  // Mutual exclusion: skip if a mutually exclusive event just fired
  if (event.mutuallyExclusiveWith?.length) {
    if (event.mutuallyExclusiveWith.some((id) => state.lastEventIds.includes(id))) {
      return false;
    }
  }

  // v2: character active check — skip if any actor is inactive
  const charActive = state.characterActive ?? {};
  if (event.actorIds?.length && Object.keys(charActive).length > 0) {
    if (event.actorIds.some((id) => charActive[id] === false)) return false;
  }

  // v2 group conditions (reads runtime state, falls back to world definition)
  if (event.groupConditions?.length) {
    for (const gc of event.groupConditions) {
      const group = world.groups.find((g) => g.id === gc.groupId);
      let value: number;
      if (gc.metric === "influence") {
        value = state.groupInfluence[gc.groupId] ?? group?.influence ?? 50;
      } else if (gc.metric === "cohesion") {
        value = (state.groupCohesion ?? {})[gc.groupId] ?? group?.cohesion ?? 50;
      } else {
        value = (state.groupVolatility ?? {})[gc.groupId] ?? group?.volatility ?? 50;
      }
      if (gc.condition === "below" && value >= gc.threshold) return false;
      if (gc.condition === "above" && value <= gc.threshold) return false;
    }
  }

  // v2 format: array of metric-based conditions
  if (event.triggerConditions && event.triggerConditions.length > 0) {
    for (const cond of event.triggerConditions) {
      const value = getMetricValue(state, cond.metricId);
      if (cond.condition === "below" && value >= cond.threshold) return false;
      if (cond.condition === "above" && value <= cond.threshold) return false;
    }
    return !state.lastEventIds.includes(event.id);
  }

  // Legacy format: flat object with optional fields
  const trigger = event.triggerWhen;

  if (
    trigger.stabilityBelow !== undefined &&
    getMetricValue(state, "stability") >= trigger.stabilityBelow
  ) {
    return false;
  }

  if (trigger.resourcesBelow !== undefined && getMetricValue(state, "resources") >= trigger.resourcesBelow) {
    return false;
  }

  if (
    trigger.pressureAbove !== undefined &&
    getMetricValue(state, "pressure") <= trigger.pressureAbove
  ) {
    return false;
  }

  if (
    trigger.moraleBelow !== undefined &&
    getMetricValue(state, "morale") >= trigger.moraleBelow
  ) {
    return false;
  }

  return !state.lastEventIds.includes(event.id);
}

export class RuleBasedEventSelector implements EventSelector {
  select(world: WorldDefinition, state: SimulationState) {
    const eligible = world.eventTemplates.filter((event) =>
      eventMatchesState(event, state, world),
    );

    if (eligible.length === 0) {
      return world.eventTemplates[0] ?? null;
    }

    // Weighted selection: higher weight = more likely
    const hasWeights = eligible.some((e) => (e.weight ?? 1) !== 1);
    if (hasWeights) {
      // Sort by urgency first, then use weight as a multiplier for selection
      const sorted = eligible.sort((left, right) => {
        const scoreLeft = left.urgency * (left.weight ?? 1);
        const scoreRight = right.urgency * (right.weight ?? 1);
        return scoreRight - scoreLeft;
      });
      return sorted[0] ?? null;
    }

    return eligible.sort((left, right) => right.urgency - left.urgency)[0] ?? null;
  }
}
