import { EventSelector } from "@/lib/simulation/interfaces";
import { EventTemplate, SimulationState, WorldDefinition } from "@/types/simulation";

function eventMatchesState(event: EventTemplate, state: SimulationState) {
  const trigger = event.triggerWhen;

  if (
    trigger.politicalStabilityBelow !== undefined &&
    state.politicalStability >= trigger.politicalStabilityBelow
  ) {
    return false;
  }

  if (trigger.treasuryBelow !== undefined && state.treasury >= trigger.treasuryBelow) {
    return false;
  }

  if (
    trigger.militaryPressureAbove !== undefined &&
    state.militaryPressure <= trigger.militaryPressureAbove
  ) {
    return false;
  }

  if (
    trigger.publicSentimentBelow !== undefined &&
    state.publicSentiment >= trigger.publicSentimentBelow
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
