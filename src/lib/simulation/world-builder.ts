import { getOpenAIClient } from "@/lib/openai/client";
import {
  assignDynamicVoiceProfiles,
  getCharacterVoiceProfile,
  getNarratorVoiceProfile,
  normalizeVoiceProfile,
} from "@/lib/simulation/voice-mapping";
import type { WorldDefinition } from "@/types/simulation";
import { worldDefinitionSchema } from "@/types/simulation";

function normalizePrompt(prompt: string) {
  return prompt.trim().replace(/\s+/g, " ");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
}

function titleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/^i\s+(wish|want|would like)\s+(i\s+could\s+)?/i, "")
    .replace(/^to\s+/i, "")
    .trim();

  if (!cleaned) {
    return "Custom World";
  }

  return cleaned
    .split(" ")
    .slice(0, 8)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function assertWorldIntegrity(world: WorldDefinition) {
  const factionIds = new Set(world.factions.map((faction) => faction.id));
  const characterIds = new Set(world.characters.map((character) => character.id));

  const missingCharacterFaction = world.characters.find(
    (character) => !factionIds.has(character.factionId),
  );

  if (missingCharacterFaction) {
    throw new Error(
      `Invalid world integrity: character ${missingCharacterFaction.id} references unknown faction ${missingCharacterFaction.factionId}.`,
    );
  }

  for (const event of world.eventTemplates) {
    const unknownActor = event.actorIds.find((actorId) => !characterIds.has(actorId));

    if (unknownActor) {
      throw new Error(
        `Invalid world integrity: event ${event.id} references unknown actor ${unknownActor}.`,
      );
    }
  }

  for (const faction of world.factions) {
    if (world.initialState.factionInfluence[faction.id] === undefined) {
      throw new Error(
        `Invalid world integrity: missing factionInfluence for faction ${faction.id}.`,
      );
    }
  }

  for (const character of world.characters) {
    if (!world.initialState.characterStates[character.id]) {
      throw new Error(
        `Invalid world integrity: missing characterStates entry for ${character.id}.`,
      );
    }

    if (!world.initialState.relationships[character.id]) {
      throw new Error(
        `Invalid world integrity: missing relationships entry for ${character.id}.`,
      );
    }
  }
}

function stripLeadingPlusFromNumbers(input: string) {
  let output = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      output += char;

      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "+") {
      const next = input[index + 1] ?? "";

      if (/[0-9]/.test(next)) {
        let previousSignificant = "";

        for (let cursor = output.length - 1; cursor >= 0; cursor -= 1) {
          const token = output[cursor];

          if (!/\s/.test(token)) {
            previousSignificant = token;
            break;
          }
        }

        if (
          previousSignificant === "" ||
          previousSignificant === ":" ||
          previousSignificant === "," ||
          previousSignificant === "[" ||
          previousSignificant === "e" ||
          previousSignificant === "E"
        ) {
          continue;
        }
      }
    }

    output += char;
  }

  return output;
}

function parseModelWorldOutput(text: string) {
  const attempts: string[] = [];
  const trimmed = text.trim();

  if (trimmed) {
    attempts.push(trimmed);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Continue to sanitized parse attempt.
    }

    const sanitized = stripLeadingPlusFromNumbers(candidate);

    try {
      return JSON.parse(sanitized) as unknown;
    } catch {
      // Continue to next candidate.
    }
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mapDisposition(value: unknown): "supportive" | "neutral" | "hostile" | "volatile" {
  const lowered = asString(value).toLowerCase();

  if (lowered.includes("support")) {
    return "supportive";
  }

  if (
    lowered.includes("hostile") ||
    lowered.includes("enemy") ||
    lowered.includes("oppos")
  ) {
    return "hostile";
  }

  if (
    lowered.includes("volatile") ||
    lowered.includes("unstable") ||
    lowered.includes("swing")
  ) {
    return "volatile";
  }

  return "neutral";
}

function mapEventCategory(value: unknown): "politics" | "economy" | "military" | "morality" | "personal" {
  const lowered = asString(value).toLowerCase();

  if (lowered.includes("econ") || lowered.includes("trade") || lowered.includes("tax")) {
    return "economy";
  }

  if (
    lowered.includes("military") ||
    lowered.includes("war") ||
    lowered.includes("battle") ||
    lowered.includes("border")
  ) {
    return "military";
  }

  if (
    lowered.includes("moral") ||
    lowered.includes("faith") ||
    lowered.includes("ethic") ||
    lowered.includes("relig")
  ) {
    return "morality";
  }

  if (
    lowered.includes("personal") ||
    lowered.includes("romance") ||
    lowered.includes("family")
  ) {
    return "personal";
  }

  return "politics";
}

function resolveFactionId(
  value: unknown,
  factions: Array<{ id: string; name: string }>,
  fallbackId: string,
) {
  const candidate = asString(value);

  if (!candidate) {
    return fallbackId;
  }

  const byId = factions.find((faction) => faction.id === candidate);

  if (byId) {
    return byId.id;
  }

  const candidateSlug = slugify(candidate);
  const byName = factions.find((faction) => slugify(faction.name) === candidateSlug);

  return byName?.id ?? fallbackId;
}

function normalizeGeneratedWorld(raw: unknown, prompt: string) {
  const parsed = asRecord(raw);

  if (!parsed) {
    throw new Error("Generated payload is not a JSON object.");
  }

  const title = asString(parsed.title ?? parsed.name, titleFromPrompt(prompt));
  const safeSlug = slugify(title) || "generated-world";

  const safety = asRecord(parsed.safetyProfile ?? parsed.safety) ?? {};
  const historicalThemes = asStringArray(
    safety.historicalThemes ?? safety.themes ?? parsed.historicalThemes,
  );
  const disallowedContent = asStringArray(
    safety.disallowedContent ?? safety.disallowed ?? safety.prohibitedContent,
  );

  const sourceFactions = Array.isArray(parsed.factions)
    ? parsed.factions
    : Array.isArray(parsed.groups)
      ? parsed.groups
      : [];

  const factions = sourceFactions.map((entry, index) => {
    const record = asRecord(entry) ?? {};
    const name = asString(record.name ?? record.title ?? record.id, `Faction ${index + 1}`);
    const id = asString(record.id, slugify(name) || `faction-${index + 1}`);

    return {
      id,
      name,
      description: asString(
        record.description ?? record.summary ?? record.agenda,
        `${name} is maneuvering to protect its interests.`,
      ),
      influence: clampScore(asNumber(record.influence ?? record.power ?? record.clout, 55)),
      disposition: mapDisposition(record.disposition ?? record.attitude ?? record.stance),
    };
  });

  if (!factions.length) {
    factions.push(
      {
        id: "core-group",
        name: "Core Group",
        description: "Operational leaders focused on stability and coordination.",
        influence: 62,
        disposition: "supportive",
      },
      {
        id: "rival-group",
        name: "Rival Group",
        description: "A competing bloc with different priorities and methods.",
        influence: 58,
        disposition: "volatile",
      },
      {
        id: "stakeholders",
        name: "Stakeholders",
        description: "People impacted by outcomes and sensitive to credibility.",
        influence: 51,
        disposition: "neutral",
      },
    );
  }

  const sourceCharacters = Array.isArray(parsed.characters)
    ? parsed.characters
    : Array.isArray(parsed.actors)
      ? parsed.actors
      : Array.isArray(parsed.npcs)
        ? parsed.npcs
        : [];

  const primaryFactionId = factions[0].id;
  const characters = sourceCharacters.map((entry, index) => {
    const record = asRecord(entry) ?? {};
    const name = asString(record.name ?? record.title ?? record.id, `Figure ${index + 1}`);
    const id = asString(record.id, slugify(name) || `character-${index + 1}`);
    const emotions = asRecord(record.emotionalBaseline ?? record.emotions) ?? {};
    const archetype = asString(record.archetype ?? record.persona ?? record.role, "operator");

    return {
      id,
      name,
      title: asString(record.title ?? record.role, "Advisor"),
      archetype,
      factionId: resolveFactionId(
        record.factionId ?? record.faction ?? record.group,
        factions,
        primaryFactionId,
      ),
      motivations: asStringArray(record.motivations ?? record.goals ?? record.objectives).length
        ? asStringArray(record.motivations ?? record.goals ?? record.objectives)
        : ["Preserve influence while surviving the current crisis."],
      emotionalBaseline: {
        anger: clampScore(asNumber(emotions.anger ?? emotions.rage, 22)),
        fear: clampScore(asNumber(emotions.fear ?? emotions.anxiety, 30)),
        hope: clampScore(asNumber(emotions.hope ?? emotions.optimism, 48)),
        loyalty: clampScore(asNumber(emotions.loyalty ?? emotions.commitment, 55)),
      },
      speakingStyle: asString(
        record.speakingStyle ?? record.voiceStyle ?? record.dialogueStyle,
        "Measured, strategic, and politically cautious.",
      ),
      voice: normalizeVoiceProfile(record.voice ?? record.voiceProfile),
    };
  });

  if (!characters.length) {
    characters.push(
      {
        id: "advisor-1",
        name: "Arden",
        title: "Chancellor",
        archetype: "strategist",
        factionId: primaryFactionId,
        motivations: ["Protect regime legitimacy and prevent unrest."],
        emotionalBaseline: { anger: 18, fear: 28, hope: 50, loyalty: 70 },
        speakingStyle: "Deliberate and diplomatic.",
        voice: undefined,
      },
      {
        id: "advisor-2",
        name: "Sera",
        title: "Marshal",
        archetype: "commander",
        factionId: factions[1]?.id ?? primaryFactionId,
        motivations: ["Maintain security and discipline."],
        emotionalBaseline: { anger: 24, fear: 26, hope: 44, loyalty: 66 },
        speakingStyle: "Direct and tactical.",
        voice: undefined,
      },
      {
        id: "advisor-3",
        name: "Elan",
        title: "High Priest",
        archetype: "moral witness",
        factionId: primaryFactionId,
        motivations: ["Protect moral order and civilian welfare."],
        emotionalBaseline: { anger: 12, fear: 20, hope: 60, loyalty: 58 },
        speakingStyle: "Calm and morally pointed.",
        voice: undefined,
      },
    );
  }

  const sourceRoles = Array.isArray(parsed.roles)
    ? parsed.roles
    : Array.isArray(parsed.playerRoles)
      ? parsed.playerRoles
      : [];

  const roles = sourceRoles.map((entry, index) => {
    const record = asRecord(entry) ?? {};
    const roleTitle = asString(record.title ?? record.name ?? record.role, `Role ${index + 1}`);
    return {
      id: asString(record.id, slugify(roleTitle) || `role-${index + 1}`),
      title: roleTitle,
      summary: asString(
        record.summary ?? record.description,
        "You make high-stakes decisions in a volatile environment.",
      ),
      responsibilities: asStringArray(record.responsibilities ?? record.duties).length
        ? asStringArray(record.responsibilities ?? record.duties)
        : [
            "Choose actions under pressure with real tradeoffs.",
            "Balance short-term wins against long-term consequences.",
          ],
    };
  });

  if (!roles.length) {
    roles.push({
      id: "protagonist",
      title: `Lead Decision-Maker of ${title}`,
      summary: "You navigate conflict, uncertainty, and competing incentives.",
      responsibilities: [
        "Set strategy and make critical calls.",
        "Manage resources, trust, and momentum.",
      ],
    });
  }

  const characterNameToId = new Map(
    characters.map((character) => [slugify(character.name), character.id]),
  );

  const sourceEvents = Array.isArray(parsed.eventTemplates)
    ? parsed.eventTemplates
    : Array.isArray(parsed.events)
      ? parsed.events
      : Array.isArray(parsed.scenes)
        ? parsed.scenes
        : [];

  const events = sourceEvents.map((entry, index) => {
    const record = asRecord(entry) ?? {};
    const eventTitle = asString(record.title ?? record.name, `Event ${index + 1}`);
    const actorIdsSource = Array.isArray(record.actorIds)
      ? record.actorIds
      : Array.isArray(record.actors)
        ? record.actors
        : [];

    const actorIds = actorIdsSource
      .map((actor) => {
        if (typeof actor === "string") {
          return characterNameToId.get(slugify(actor)) ?? actor;
        }

        const actorRecord = asRecord(actor);
        return asString(actorRecord?.id ?? actorRecord?.name);
      })
      .map((id) => id.trim())
      .filter((id) => characters.some((character) => character.id === id));

    const normalizedActorIds = actorIds.length
      ? actorIds
      : characters.slice(0, 2).map((character) => character.id);

    const triggerRaw = asRecord(record.triggerWhen ?? record.trigger ?? record.triggers) ?? {};

    return {
      id: asString(record.id, slugify(eventTitle) || `event-${index + 1}`),
      title: eventTitle,
      category: mapEventCategory(record.category ?? record.type),
      summary: asString(
        record.summary ?? record.description,
        "A high-stakes dilemma pressures the ruling coalition.",
      ),
      urgency: clampScore(asNumber(record.urgency ?? record.pressure ?? record.risk, 68)),
      triggerWhen: {
        politicalStabilityBelow:
          triggerRaw.politicalStabilityBelow !== undefined
            ? clampScore(asNumber(triggerRaw.politicalStabilityBelow, 0))
            : undefined,
        treasuryBelow:
          triggerRaw.treasuryBelow !== undefined
            ? clampScore(asNumber(triggerRaw.treasuryBelow, 0))
            : undefined,
        militaryPressureAbove:
          triggerRaw.militaryPressureAbove !== undefined
            ? clampScore(asNumber(triggerRaw.militaryPressureAbove, 0))
            : undefined,
        publicSentimentBelow:
          triggerRaw.publicSentimentBelow !== undefined
            ? clampScore(asNumber(triggerRaw.publicSentimentBelow, 0))
            : undefined,
      },
      stakes: asStringArray(record.stakes ?? record.consequences ?? record.outcomes).length
        ? asStringArray(record.stakes ?? record.consequences ?? record.outcomes)
        : ["A misstep could trigger political fracture and material decline."],
      narratorPrompt: asString(
        record.narratorPrompt ?? record.scenePrompt ?? record.prompt,
        "Describe immediate stakes, pressure points, and visible faction reactions.",
      ),
      actorIds: normalizedActorIds,
    };
  });

  if (!events.length) {
    events.push(
      {
        id: "resource-shock",
        title: "Resource Shock",
        category: "economy" as const,
        summary: "A sudden shortage forces emergency tradeoffs.",
        urgency: 72,
        triggerWhen: {
          politicalStabilityBelow: undefined,
          treasuryBelow: 58,
          militaryPressureAbove: undefined,
          publicSentimentBelow: undefined,
        },
        stakes: ["Stabilizing systems now may trigger backlash later."],
        narratorPrompt: "Show immediate constraints, stakeholder pressure, and hidden costs.",
        actorIds: characters.slice(0, 2).map((character) => character.id),
      },
      {
        id: "external-pressure",
        title: "External Pressure",
        category: "military" as const,
        summary: "Outside threats test leadership credibility.",
        urgency: 76,
        triggerWhen: {
          politicalStabilityBelow: undefined,
          treasuryBelow: undefined,
          militaryPressureAbove: 40,
          publicSentimentBelow: undefined,
        },
        stakes: ["Delay may embolden rivals and drain confidence."],
        narratorPrompt: "Convey urgency through alarming updates and divided advisors.",
        actorIds: characters.slice(0, 2).map((character) => character.id),
      },
      {
        id: "internal-fracture",
        title: "Internal Fracture",
        category: "politics" as const,
        summary: "An influential bloc openly challenges your direction.",
        urgency: 70,
        triggerWhen: {
          politicalStabilityBelow: 62,
          treasuryBelow: undefined,
          militaryPressureAbove: undefined,
          publicSentimentBelow: undefined,
        },
        stakes: ["Compromise may calm conflict now but weaken your position later."],
        narratorPrompt: "Describe tense negotiation, power plays, and reputational risk.",
        actorIds: characters.slice(0, 2).map((character) => character.id),
      },
    );
  }

  const state = asRecord(parsed.initialState ?? parsed.state ?? parsed.worldState) ?? {};
  const factionInfluenceRaw = asRecord(state.factionInfluence ?? state.factions) ?? {};
  const characterStatesRaw = asRecord(state.characterStates ?? state.characters) ?? {};
  const relationshipsRaw = asRecord(state.relationships ?? state.relations) ?? {};

  const factionInfluence = Object.fromEntries(
    factions.map((faction) => {
      const valueById = factionInfluenceRaw[faction.id];
      const valueByName = factionInfluenceRaw[slugify(faction.name)];
      const influence = clampScore(
        asNumber(valueById ?? valueByName ?? faction.influence, faction.influence),
      );
      return [faction.id, influence];
    }),
  );

  const characterStates = Object.fromEntries(
    characters.map((character) => {
      const byId = asRecord(characterStatesRaw[character.id]);
      const byName = asRecord(characterStatesRaw[slugify(character.name)]);
      const source = byId ?? byName ?? {};

      return [
        character.id,
        {
          anger: clampScore(asNumber(source.anger, character.emotionalBaseline.anger)),
          fear: clampScore(asNumber(source.fear, character.emotionalBaseline.fear)),
          hope: clampScore(asNumber(source.hope, character.emotionalBaseline.hope)),
          loyalty: clampScore(asNumber(source.loyalty, character.emotionalBaseline.loyalty)),
        },
      ];
    }),
  );

  const relationships = Object.fromEntries(
    characters.map((character) => {
      const byId = asRecord(relationshipsRaw[character.id]);
      const byName = asRecord(relationshipsRaw[slugify(character.name)]);
      const source = byId ?? byName ?? {};
      const defaultLoyalty = character.emotionalBaseline.loyalty;

      return [
        character.id,
        {
          trust: clampScore(asNumber(source.trust, 52)),
          fear: clampScore(asNumber(source.fear, 24)),
          loyalty: clampScore(asNumber(source.loyalty, defaultLoyalty)),
          recentMemory: asStringArray(source.recentMemory).length
            ? asStringArray(source.recentMemory).slice(0, 6)
            : [`You assumed power in ${title} under immediate pressure.`],
        },
      ];
    }),
  );

  const narratorVoice = normalizeVoiceProfile(
    parsed.narratorVoice ?? asRecord(parsed.narrator)?.voice ?? parsed.voiceNarrator,
    getNarratorVoiceProfile(),
  );

  return {
    id: asString(parsed.id, `world_${safeSlug}_${crypto.randomUUID().slice(0, 8)}`),
    title,
    setting: asString(
      parsed.setting ?? parsed.environment ?? parsed.worldSetting,
      `A high-pressure environment where trust, scarcity, and conflict shape outcomes in ${title}.`,
    ),
    premise: asString(
      parsed.premise,
      `You navigate ${title} while balancing relationships, resources, and strategic risk.`,
    ),
    introNarration: asString(
      parsed.introNarration ?? parsed.openingNarration,
      "Everyone is watching your first move, trying to predict whether you can steer this situation without collapse.",
    ),
    norms: asStringArray(parsed.norms).length
      ? asStringArray(parsed.norms)
      : [
          "Influence is negotiated through trust, leverage, and timing.",
          "Every decree creates winners, losers, and second-order effects.",
        ],
    powerStructures: asStringArray(parsed.powerStructures).length
      ? asStringArray(parsed.powerStructures)
      : [
          "No actor has perfect control; coordination and incentives matter.",
          "Credibility depends on outcomes, communication, and follow-through.",
        ],
    tonalConstraints: asStringArray(parsed.tonalConstraints).length
      ? asStringArray(parsed.tonalConstraints)
      : [
          "Keep narration grounded in consequence, tension, and tradeoffs.",
          "Treat all factions as strategic actors with coherent incentives.",
        ],
    narratorVoice,
    safetyProfile: {
      historicalThemes: historicalThemes.length
        ? historicalThemes
        : ["conflict", "scarcity", "trust", "power"],
      disallowedContent: disallowedContent.length
        ? disallowedContent
        : [
            "sexual violence",
            "graphic gore",
            "instructions for real-world harm",
            "degrading sexualized slavery roleplay",
          ],
    },
    roles,
    factions,
    characters: characters.map((character, index) => ({
      ...character,
      voice: normalizeVoiceProfile(
        character.voice,
        getCharacterVoiceProfile(character.archetype, index),
      ),
    })),
    eventTemplates: events,
    initialState: {
      politicalStability: clampScore(
        asNumber(state.politicalStability ?? state.stability ?? state.order, 62),
      ),
      publicSentiment: clampScore(
        asNumber(state.publicSentiment ?? state.morale ?? state.support, 54),
      ),
      treasury: clampScore(asNumber(state.treasury ?? state.wealth ?? state.resources, 50)),
      militaryPressure: clampScore(
        asNumber(state.militaryPressure ?? state.threat ?? state.warPressure, 43),
      ),
      factionInfluence,
      characterStates,
      relationships,
    },
  };
}

async function generateWorldWithModel(prompt: string) {
  const client = getOpenAIClient();

  if (!client) {
    throw new Error(
      "World builder strict mode requires OPENAI_API_KEY. Set it before building worlds.",
    );
  }

  const response = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You build simulation worlds for a strategy engine.",
              "Return strict JSON only. No markdown. No prose outside JSON.",
              "The JSON must include keys:",
              "id,title,setting,premise,introNarration,norms,powerStructures,tonalConstraints,safetyProfile,roles,factions,characters,eventTemplates,initialState.",
              "Constraints:",
              "- Respect the user's prompt and setting. Do not force a historical frame unless requested.",
              "- Every eventTemplate.actorIds must reference existing characters.",
              "- initialState.factionInfluence must include all factions.",
              "- initialState.characterStates and relationships must include all characters.",
              "- Keep all state scores in [0,100].",
              "- Provide at least 1 role, 3 factions, 3 characters, and 3 eventTemplates.",
            ].join(" "),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  if (!response.output_text) {
    throw new Error("Model returned no world payload.");
  }

  const parsed = parseModelWorldOutput(response.output_text);

  if (!parsed) {
    throw new Error("Model returned invalid JSON world payload.");
  }

  return parsed;
}

async function finalizeWorld(raw: unknown, prompt: string) {
  const normalized = normalizeGeneratedWorld(raw, prompt);
  const parsed = worldDefinitionSchema.parse(normalized);
  const voiceEnriched = await assignDynamicVoiceProfiles(parsed);
  const withVoices = worldDefinitionSchema.parse(voiceEnriched);

  const title = withVoices.title.trim() || titleFromPrompt(prompt);
  const safeSlug = slugify(title) || "generated-world";

  const world: WorldDefinition = {
    ...withVoices,
    id: `world_${safeSlug}_${crypto.randomUUID().slice(0, 8)}`,
    title,
  };

  assertWorldIntegrity(world);

  return world;
}

export async function buildWorldDefinitionFromPrompt(prompt: string) {
  const normalizedPrompt = normalizePrompt(prompt);

  if (!normalizedPrompt) {
    throw new Error("Prompt is required.");
  }

  const raw = await generateWorldWithModel(normalizedPrompt);

  try {
    return await finalizeWorld(raw, normalizedPrompt);
  } catch (error) {
    throw new Error(
      `Generated world failed validation: ${error instanceof Error ? error.message : "Unknown error."}`,
    );
  }
}
