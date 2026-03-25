import { z } from "zod";

const relationshipStateSchema = z.object({
  trust: z.number().min(0).max(100),
  fear: z.number().min(0).max(100),
  loyalty: z.number().min(0).max(100),
  recentMemory: z.array(z.string()).max(6),
});

const voiceProfileSchema = z.object({
  provider: z.enum(["elevenlabs", "openai"]),
  voiceId: z.string().min(1),
  label: z.string().optional(),
});

// ── v2 schemas ──────────────────────────────────────────────

const narratorConfigSchema = z.object({
  perspective: z.enum(["first", "second", "third", "omniscient"]),
  tense: z.enum(["present", "past"]),
  style: z.string(),
});

const metricDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  initialValue: z.number().min(0).max(100),
  direction: z.enum(["higher-better", "lower-better"]),
});

const eventCategoryDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});

const progressionModelSchema = z.object({
  type: z.enum(["linear", "branching", "open-ended", "cyclical"]),
  phases: z.number().int().min(1).max(20),
});

const difficultyConfigSchema = z.object({
  level: z.enum(["easy", "medium", "hard", "senior", "extreme"]),
  adaptive: z.boolean(),
});

const triggerConditionSchema = z.object({
  metricId: z.string(),
  condition: z.enum(["above", "below"]),
  threshold: z.number().min(0).max(100),
});

const relationshipDefinitionSchema = z.object({
  id: z.string(),
  sourceCharacterId: z.string(),
  targetCharacterId: z.string(),
  metrics: z.object({
    trust: z.number().min(0).max(100),
    fear: z.number().min(0).max(100),
    loyalty: z.number().min(0).max(100),
    respect: z.number().min(0).max(100),
  }),
  tone: z.string().optional(),
  stance: z.array(z.string()).optional(),
  recentMemory: z.array(z.string()).max(6),
});

const behaviorTriggerSchema = z.object({
  condition: z.string(),
  behavior: z.string(),
  priority: z.number().optional(),
});

const npcRelationshipSchema = z.object({
  targetCharacterId: z.string(),
  attitude: z.string(),
  context: z.string().optional(),
});

// ── entity schemas ──────────────────────────────────────────

const characterDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  archetype: z.string(),
  // v2: supports multiple groups; legacy groupId accepted via union
  groupId: z.string().optional(),
  groupIds: z.array(z.string()).min(1).optional(),
  motivations: z.array(z.string()).min(1),
  emotionalBaseline: z.object({
    anger: z.number().min(0).max(100),
    fear: z.number().min(0).max(100),
    hope: z.number().min(0).max(100),
    loyalty: z.number().min(0).max(100),
    volatility: z.number().min(0).max(100).optional(),
  }),
  speakingStyle: z.string(),
  voice: voiceProfileSchema.optional(),
  // v2 additions (all optional)
  backstory: z.string().optional(),
  visualDescription: z.string().optional(),
  knowledgeDomains: z.array(z.string()).optional(),
  behaviorTriggers: z.array(behaviorTriggerSchema).optional(),
  dialogueExamples: z.array(z.string()).max(6).optional(),
  secrets: z.array(z.string()).optional(),
  deathCondition: z.string().optional(),
  tags: z.array(z.string()).optional(),
  npcRelationships: z.array(npcRelationshipSchema).optional(),
});

const dispositionTriggerSchema = z.object({
  condition: z.string(),
  dispositionShift: z.enum(["supportive", "neutral", "hostile", "volatile"]),
  priority: z.number().optional(),
});

const groupRelationshipSchema = z.object({
  targetGroupId: z.string(),
  attitude: z.string(),
  context: z.string().optional(),
});

const groupDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  influence: z.number().min(0).max(100),
  disposition: z.enum(["supportive", "neutral", "hostile", "volatile"]),
  // v2 additions (all optional)
  goals: z.array(z.string()).min(1).optional(),
  leaderId: z.string().optional(),
  powerType: z.enum(["military", "economic", "religious", "political", "popular"]).optional(),
  backstory: z.string().optional(),
  volatility: z.number().min(0).max(100).optional(),
  cohesion: z.number().min(0).max(100).optional(),
  dispositionTriggers: z.array(dispositionTriggerSchema).optional(),
  demands: z.array(z.string()).optional(),
  groupRelationships: z.array(groupRelationshipSchema).optional(),
  assets: z.array(z.string()).optional(),
  collectiveVoice: z.string().optional(),
  visualIdentity: z.string().optional(),
  collapseCondition: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const roleDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()).min(1),
});

const eventTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  summary: z.string(),
  urgency: z.number().min(0).max(100),
  // legacy format — kept for backward compat, prefer triggerConditions
  triggerWhen: z
    .object({
      stabilityBelow: z.number().optional(),
      resourcesBelow: z.number().optional(),
      pressureAbove: z.number().optional(),
      moraleBelow: z.number().optional(),
      // legacy aliases
      politicalStabilityBelow: z.number().optional(),
      treasuryBelow: z.number().optional(),
      militaryPressureAbove: z.number().optional(),
      publicSentimentBelow: z.number().optional(),
    })
    .default({}),
  // v2 format — array of metric-based conditions
  triggerConditions: z.array(triggerConditionSchema).optional(),
  stakes: z.array(z.string()).min(1),
  narratorPrompt: z.string(),
  actorIds: z.array(z.string()).min(1),
});

export const worldDefinitionSchema = z.object({
  id: z.string(),
  title: z.string(),
  setting: z.string(),
  premise: z.string(),
  introNarration: z.string(),
  norms: z.array(z.string()).min(1),
  powerStructures: z.array(z.string()).min(1),
  tonalConstraints: z.array(z.string()).min(1),
  narratorVoice: voiceProfileSchema.optional(),
  narratorConfig: narratorConfigSchema.optional(),
  safetyProfile: z.object({
    historicalThemes: z.array(z.string()),
    disallowedContent: z.array(z.string()),
  }),
  // v2 — dynamic metrics (when absent, engine falls back to legacy 4)
  metrics: z.array(metricDefinitionSchema).optional(),
  // v2 — dynamic event categories (when absent, engine falls back to legacy 5)
  eventCategories: z.array(eventCategoryDefinitionSchema).optional(),
  progressionModel: progressionModelSchema.optional(),
  difficulty: difficultyConfigSchema.optional(),
  roles: z.array(roleDefinitionSchema).min(1),
  groups: z.array(groupDefinitionSchema).default([]),
  characters: z.array(characterDefinitionSchema).min(1),
  // v2 — top-level relationship definitions (when absent, falls back to initialState.relationships)
  relationships: z.array(relationshipDefinitionSchema).optional(),
  eventTemplates: z.array(eventTemplateSchema).min(1),
  initialState: z.object({
    // legacy flat metrics — kept for backward compat
    stability: z.number().min(0).max(100).optional(),
    morale: z.number().min(0).max(100).optional(),
    resources: z.number().min(0).max(100).optional(),
    pressure: z.number().min(0).max(100).optional(),
    // legacy aliases retained for compatibility with older engine paths
    politicalStability: z.number().min(0).max(100).optional(),
    publicSentiment: z.number().min(0).max(100).optional(),
    treasury: z.number().min(0).max(100).optional(),
    militaryPressure: z.number().min(0).max(100).optional(),
    // v2 — dynamic metric values keyed by metric id
    metricValues: z.record(z.string(), z.number().min(0).max(100)).default({}),
    groupInfluence: z.record(z.string(), z.number().min(0).max(100)).default({}),
    // legacy alias retained for compatibility
    factionInfluence: z.record(z.string(), z.number().min(0).max(100)).optional(),
    characterStates: z.record(
      z.string(),
      z.object({
        anger: z.number().min(0).max(100),
        fear: z.number().min(0).max(100),
        hope: z.number().min(0).max(100),
        loyalty: z.number().min(0).max(100),
      }),
    ),
    relationships: z.record(z.string(), relationshipStateSchema),
  }),
});

export const turnInputSchema = z.object({
  mode: z.enum(["voice", "text"]),
  text: z.string().min(1),
  transcriptConfidence: z.number().min(0).max(1).optional(),
  clientTimestamp: z.string(),
});

export const narrationSegmentSchema = z.object({
  id: z.string(),
  speaker: z.literal("narrator"),
  text: z.string(),
});

export const dialogueSegmentSchema = z.object({
  id: z.string(),
  speaker: z.string(),
  role: z.string(),
  text: z.string(),
  emotion: z.enum(["calm", "urgent", "skeptical", "angry", "hopeful", "grieved"]),
});

export const audioDirectiveSchema = z.object({
  type: z.enum(["speak", "await-input"]),
  voice: z.string(),
  text: z.string(),
});

export const visibleStateSchema = z.object({
  // legacy flat metrics — kept for backward compat
  stability: z.number().min(0).max(100).optional(),
  morale: z.number().min(0).max(100).optional(),
  resources: z.number().min(0).max(100).optional(),
  pressure: z.number().min(0).max(100).optional(),
  // legacy aliases retained for compatibility with UI/engine callers
  politicalStability: z.number().min(0).max(100).optional(),
  publicSentiment: z.number().min(0).max(100).optional(),
  treasury: z.number().min(0).max(100).optional(),
  militaryPressure: z.number().min(0).max(100).optional(),
  // v2 — dynamic metric values
  metricValues: z.record(z.string(), z.number().min(0).max(100)).default({}),
  groupInfluence: z.record(z.string(), z.number().min(0).max(100)).default({}),
  // legacy alias retained for compatibility
  factionInfluence: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

export const simulationStateSchema = worldDefinitionSchema.shape.initialState.extend({
  turnCount: z.number().int().min(0),
  activeEventId: z.string().nullable(),
  lastEventIds: z.array(z.string()).max(5),
});

export const turnResultSchema = z.object({
  transcript: z.string(),
  narration: z.array(narrationSegmentSchema),
  dialogue: z.array(dialogueSegmentSchema),
  uiChoices: z.array(z.string()),
  visibleState: visibleStateSchema,
  privateStateVersion: z.number().int().min(1),
  event: eventTemplateSchema
    .pick({
      id: true,
      title: true,
      category: true,
      summary: true,
    })
    .nullable(),
  audioDirectives: z.array(audioDirectiveSchema),
});

export const sessionRecordSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  roleId: z.string(),
  status: z.enum(["active", "paused", "complete"]),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  currentStateVersion: z.number().int().min(1),
  state: simulationStateSchema,
});

export const turnRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  stateVersion: z.number().int().min(1),
  input: turnInputSchema,
  result: turnResultSchema,
  stateDeltaSummary: z.string(),
  createdAt: z.string(),
});

export type RelationshipState = z.infer<typeof relationshipStateSchema>;
export type NarratorConfig = z.infer<typeof narratorConfigSchema>;
export type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
export type EventCategoryDefinition = z.infer<typeof eventCategoryDefinitionSchema>;
export type ProgressionModel = z.infer<typeof progressionModelSchema>;
export type DifficultyConfig = z.infer<typeof difficultyConfigSchema>;
export type TriggerCondition = z.infer<typeof triggerConditionSchema>;
export type RelationshipDefinition = z.infer<typeof relationshipDefinitionSchema>;
export type BehaviorTrigger = z.infer<typeof behaviorTriggerSchema>;
export type NpcRelationship = z.infer<typeof npcRelationshipSchema>;
export type DispositionTrigger = z.infer<typeof dispositionTriggerSchema>;
export type GroupRelationship = z.infer<typeof groupRelationshipSchema>;
export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;
export type GroupDefinition = z.infer<typeof groupDefinitionSchema>;
export type RoleDefinition = z.infer<typeof roleDefinitionSchema>;
export type EventTemplate = z.infer<typeof eventTemplateSchema>;
export type WorldDefinition = z.infer<typeof worldDefinitionSchema>;
export type SimulationState = z.infer<typeof simulationStateSchema>;
export type TurnInput = z.infer<typeof turnInputSchema>;
export type TurnResult = z.infer<typeof turnResultSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type TurnRecord = z.infer<typeof turnRecordSchema>;

export const worldDefinitionListSchema = z.array(worldDefinitionSchema);
export const visibleWorldSchema = worldDefinitionSchema.pick({
  id: true,
  title: true,
  setting: true,
  premise: true,
  introNarration: true,
  roles: true,
  narratorVoice: true,
  metrics: true,
});

export const worldBuildRequestSchema = z.object({
  prompt: z.string().min(1),
});

export const worldBuildResponseSchema = z.object({
  world: visibleWorldSchema,
  worldId: z.string(),
  roleId: z.string(),
  published: z.literal(true),
});

export const worldRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  status: z.enum(["published", "draft"]).default("published"),
  definition: worldDefinitionSchema,
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type VisibleWorld = z.infer<typeof visibleWorldSchema>;
export type BuildWorldRequest = z.infer<typeof worldBuildRequestSchema>;
export type BuildWorldResponse = z.infer<typeof worldBuildResponseSchema>;
export type WorldRecord = z.infer<typeof worldRecordSchema>;
