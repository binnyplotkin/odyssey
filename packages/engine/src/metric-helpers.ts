import type { CharacterDefinition, MetricDefinition, RelationshipState, SimulationState, WorldDefinition } from "@odyssey/types";

/** Legacy metric IDs for worlds that predate the dynamic metrics system. */
const LEGACY_METRICS: MetricDefinition[] = [
  { id: "stability", label: "Stability", initialValue: 50, direction: "higher-better" },
  { id: "morale", label: "Morale", initialValue: 50, direction: "higher-better" },
  { id: "resources", label: "Resources", initialValue: 50, direction: "higher-better" },
  { id: "pressure", label: "Pressure", initialValue: 50, direction: "lower-better" },
];

const LEGACY_CATEGORIES = [
  { id: "politics", label: "Politics" },
  { id: "economy", label: "Economy" },
  { id: "military", label: "Military" },
  { id: "morality", label: "Morality" },
  { id: "personal", label: "Personal" },
];

/** Return the effective metric definitions for a world. */
export function resolveMetrics(world: WorldDefinition): MetricDefinition[] {
  return world.metrics ?? LEGACY_METRICS;
}

/** Return the effective event categories for a world. */
export function resolveCategories(world: WorldDefinition) {
  return world.eventCategories ?? LEGACY_CATEGORIES;
}

/**
 * Read a metric value from simulation state.
 * Checks `metricValues` first, then falls back to legacy flat fields.
 */
export function getMetricValue(state: SimulationState, metricId: string): number {
  if (state.metricValues[metricId] !== undefined) {
    return state.metricValues[metricId];
  }

  // Legacy flat field fallback
  const legacyMap: Record<string, number | undefined> = {
    stability: state.stability,
    morale: state.morale,
    resources: state.resources,
    pressure: state.pressure,
  };

  return legacyMap[metricId] ?? 50;
}

/** Write a metric value to simulation state (mutates in place). */
export function setMetricValue(state: SimulationState, metricId: string, value: number) {
  state.metricValues[metricId] = value;

  // Also write to legacy flat fields for backward compat
  const legacyKey = metricId as keyof typeof state;
  if (legacyKey === "stability" || legacyKey === "morale" || legacyKey === "resources" || legacyKey === "pressure") {
    (state as Record<string, unknown>)[legacyKey] = value;
  }
}

/**
 * Build a visible-state snapshot from simulation state + world metrics.
 * Emits both legacy flat fields and metricValues for backward compat.
 */
export function buildVisibleState(state: SimulationState, world: WorldDefinition) {
  const metrics = resolveMetrics(world);
  const metricValues: Record<string, number> = {};
  for (const metric of metrics) {
    metricValues[metric.id] = getMetricValue(state, metric.id);
  }

  return {
    stability: getMetricValue(state, "stability"),
    morale: getMetricValue(state, "morale"),
    resources: getMetricValue(state, "resources"),
    pressure: getMetricValue(state, "pressure"),
    metricValues,
    groupInfluence: state.groupInfluence,
  };
}

/**
 * Resolve initial relationships for a world.
 * If the world has a v2 top-level `relationships` array, convert it into the
 * runtime `Record<string, RelationshipState>` format keyed by target character ID.
 * Falls back to `initialState.relationships` for legacy worlds.
 */
export function resolveRelationships(world: WorldDefinition): Record<string, RelationshipState> {
  // If v2 relationships exist, convert the array into a keyed record
  if (world.relationships?.length) {
    const record: Record<string, RelationshipState> = {};
    for (const rel of world.relationships) {
      // Key by targetCharacterId to match the legacy runtime format
      record[rel.targetCharacterId] = {
        trust: rel.metrics.trust,
        fear: rel.metrics.fear,
        loyalty: rel.metrics.loyalty,
        recentMemory: [...rel.recentMemory],
      };
    }
    // Merge with any existing initialState.relationships (initialState takes precedence for overlap)
    return { ...record, ...world.initialState.relationships };
  }

  return world.initialState.relationships;
}

/** Resolve a character's group IDs from either v2 groupIds or legacy groupId. */
export function resolveGroupIds(character: CharacterDefinition): string[] {
  if (character.groupIds?.length) return character.groupIds;
  if (character.groupId) return [character.groupId];
  return [];
}

/** Evaluate a behavior trigger condition against character state. */
export function evaluateBehaviorCondition(
  condition: string,
  characterState: { anger: number; fear: number; hope: number; loyalty: number },
): boolean {
  const match = condition.match(/^(anger|fear|hope|loyalty)\s*(>|<|>=|<=)\s*(\d+)$/);
  if (!match) return false;
  const [, metric, operator, thresholdStr] = match;
  const value = characterState[metric as keyof typeof characterState];
  const threshold = Number(thresholdStr);
  switch (operator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    default: return false;
  }
}

/** Build character context string for LLM prompt injection. */
export function buildCharacterContext(
  world: WorldDefinition,
  state: SimulationState,
): string {
  const lines: string[] = [];
  for (const character of world.characters) {
    const charState = state.characterStates[character.id];
    const relationship = state.relationships[character.id];
    const parts: string[] = [
      `${character.name} (${character.title}, ${character.archetype})`,
      `Speaking style: ${character.speakingStyle}`,
      `Motivations: ${character.motivations.join(", ")}`,
    ];

    if (character.backstory) {
      parts.push(`Backstory: ${character.backstory}`);
    }
    if (character.visualDescription) {
      parts.push(`Appearance: ${character.visualDescription}`);
    }
    if (character.knowledgeDomains?.length) {
      parts.push(`Expertise: ${character.knowledgeDomains.join(", ")}`);
    }
    if (character.dialogueExamples?.length) {
      parts.push(`Example lines: ${character.dialogueExamples.map((d) => `"${d}"`).join(" | ")}`);
    }
    if (charState) {
      parts.push(`Emotional state: anger ${charState.anger}, fear ${charState.fear}, hope ${charState.hope}, loyalty ${charState.loyalty}`);
      // Evaluate active behavior triggers
      if (character.behaviorTriggers?.length) {
        const active = character.behaviorTriggers
          .filter((bt) => evaluateBehaviorCondition(bt.condition, charState))
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        if (active.length > 0) {
          parts.push(`Active behaviors: ${active.map((bt) => bt.behavior).join("; ")}`);
        }
      }
    }
    if (relationship) {
      parts.push(`Relationship with player: trust ${relationship.trust}, fear ${relationship.fear}, loyalty ${relationship.loyalty}`);
      if (relationship.recentMemory.length > 0) {
        parts.push(`Recent memory: ${relationship.recentMemory[relationship.recentMemory.length - 1]}`);
      }
    }
    if (character.npcRelationships?.length) {
      const npcRels = character.npcRelationships.map((r) => {
        const target = world.characters.find((c) => c.id === r.targetCharacterId);
        return `${r.attitude} toward ${target?.name ?? r.targetCharacterId}${r.context ? ` (${r.context})` : ""}`;
      });
      parts.push(`NPC relationships: ${npcRels.join("; ")}`);
    }
    if (character.deathCondition) {
      parts.push(`Removal condition: ${character.deathCondition}`);
    }

    lines.push(parts.join(". ") + ".");
  }
  return lines.join("\n");
}

/** Evaluate a group-level condition (e.g. "influence < 30") against group state. */
export function evaluateGroupCondition(
  condition: string,
  groupState: { influence: number; cohesion?: number },
): boolean {
  const match = condition.match(/^(influence|cohesion)\s*(>|<|>=|<=)\s*(\d+)$/);
  if (!match) return false;
  const [, metric, operator, thresholdStr] = match;
  const value = metric === "cohesion" ? (groupState.cohesion ?? 50) : groupState.influence;
  const threshold = Number(thresholdStr);
  switch (operator) {
    case ">": return value > threshold;
    case "<": return value < threshold;
    case ">=": return value >= threshold;
    case "<=": return value <= threshold;
    default: return false;
  }
}

/** Build group context string for LLM prompt injection. */
export function buildGroupContext(
  world: WorldDefinition,
  state: SimulationState,
): string {
  const lines: string[] = [];
  for (const group of world.groups) {
    const influence = state.groupInfluence[group.id] ?? group.influence;
    const parts: string[] = [
      `${group.name} (${group.disposition}, influence ${influence})`,
      `Description: ${group.description}`,
    ];

    if (group.powerType) parts.push(`Power type: ${group.powerType}`);
    if (group.goals?.length) parts.push(`Goals: ${group.goals.join(", ")}`);
    if (group.backstory) parts.push(`Backstory: ${group.backstory}`);
    if (group.collectiveVoice) parts.push(`Collective voice: ${group.collectiveVoice}`);
    if (group.visualIdentity) parts.push(`Visual identity: ${group.visualIdentity}`);
    if (group.assets?.length) parts.push(`Assets: ${group.assets.join(", ")}`);
    if (group.demands?.length) parts.push(`Active demands: ${group.demands.join("; ")}`);
    if (group.cohesion !== undefined) parts.push(`Internal cohesion: ${group.cohesion}`);
    if (group.volatility !== undefined) parts.push(`Volatility: ${group.volatility}`);

    if (group.leaderId) {
      const leader = world.characters.find((c) => c.id === group.leaderId);
      if (leader) parts.push(`Leader: ${leader.name}`);
    }

    // Evaluate active disposition triggers
    if (group.dispositionTriggers?.length) {
      const active = group.dispositionTriggers
        .filter((dt) => evaluateGroupCondition(dt.condition, { influence, cohesion: group.cohesion }))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      if (active.length > 0) {
        parts.push(`Active disposition shifts: ${active.map((dt) => `${dt.condition} → ${dt.dispositionShift}`).join("; ")}`);
      }
    }

    if (group.groupRelationships?.length) {
      const rels = group.groupRelationships.map((r) => {
        const target = world.groups.find((g) => g.id === r.targetGroupId);
        return `${r.attitude} toward ${target?.name ?? r.targetGroupId}${r.context ? ` (${r.context})` : ""}`;
      });
      parts.push(`Inter-group relations: ${rels.join("; ")}`);
    }

    if (group.collapseCondition) parts.push(`Collapse condition: ${group.collapseCondition}`);

    lines.push(parts.join(". ") + ".");
  }
  return lines.join("\n");
}

/** Format metrics as a human-readable string for LLM prompts. */
export function formatMetricsForPrompt(state: SimulationState, world: WorldDefinition): string {
  const metrics = resolveMetrics(world);
  return metrics.map((m) => `${m.label.toLowerCase()} ${getMetricValue(state, m.id)}`).join(", ");
}
