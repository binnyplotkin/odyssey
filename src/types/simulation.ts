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

const characterDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  archetype: z.string(),
  factionId: z.string(),
  motivations: z.array(z.string()).min(1),
  emotionalBaseline: z.object({
    anger: z.number().min(0).max(100),
    fear: z.number().min(0).max(100),
    hope: z.number().min(0).max(100),
    loyalty: z.number().min(0).max(100),
  }),
  speakingStyle: z.string(),
  voice: voiceProfileSchema.optional(),
});

const factionDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  influence: z.number().min(0).max(100),
  disposition: z.enum(["supportive", "neutral", "hostile", "volatile"]),
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
  category: z.enum([
    "politics",
    "economy",
    "military",
    "morality",
    "personal",
  ]),
  summary: z.string(),
  urgency: z.number().min(0).max(100),
  triggerWhen: z
    .object({
      politicalStabilityBelow: z.number().optional(),
      treasuryBelow: z.number().optional(),
      militaryPressureAbove: z.number().optional(),
      publicSentimentBelow: z.number().optional(),
    })
    .default({}),
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
  safetyProfile: z.object({
    historicalThemes: z.array(z.string()),
    disallowedContent: z.array(z.string()),
  }),
  roles: z.array(roleDefinitionSchema).min(1),
  factions: z.array(factionDefinitionSchema).min(1),
  characters: z.array(characterDefinitionSchema).min(1),
  eventTemplates: z.array(eventTemplateSchema).min(1),
  initialState: z.object({
    politicalStability: z.number().min(0).max(100),
    publicSentiment: z.number().min(0).max(100),
    treasury: z.number().min(0).max(100),
    militaryPressure: z.number().min(0).max(100),
    factionInfluence: z.record(z.string(), z.number().min(0).max(100)),
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
  politicalStability: z.number().min(0).max(100),
  publicSentiment: z.number().min(0).max(100),
  treasury: z.number().min(0).max(100),
  militaryPressure: z.number().min(0).max(100),
  factionInfluence: z.record(z.string(), z.number().min(0).max(100)),
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
export type CharacterDefinition = z.infer<typeof characterDefinitionSchema>;
export type FactionDefinition = z.infer<typeof factionDefinitionSchema>;
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
