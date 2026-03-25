import { EventSelector } from "./interfaces";
import { EventTemplate, SimulationState, WorldDefinition } from "@odyssey/types";
import { getMetricValue } from "./metric-helpers";

function eventMatchesState(event: EventTemplate, state: SimulationState) {
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
      eventMatchesState(event, state),
    );

    if (eligible.length === 0) {
      return world.eventTemplates[0] ?? null;
    }

    return eligible.sort((left, right) => right.urgency - left.urgency)[0] ?? null;
  }
}
