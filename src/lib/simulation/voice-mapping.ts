import type { CharacterDefinition, WorldDefinition } from "@/types/simulation";

export type VoiceProvider = "elevenlabs" | "openai";

export type VoiceProfile = {
  provider: VoiceProvider;
  voiceId: string;
  label?: string;
};

type VoiceBlueprint = {
  label: string;
  envKey: string;
  fallbackId: string;
};

type ElevenLabsVoice = {
  voiceId: string;
  name: string;
  category: string;
  searchable: string;
};

type VoiceCacheState = {
  expiresAt: number;
  allowProfessionalVoices: boolean;
  rawVoices: ElevenLabsVoice[];
  filteredVoices: ElevenLabsVoice[];
};

const globalVoiceCache = globalThis as typeof globalThis & {
  __pandoraElevenVoiceCache?: VoiceCacheState;
};

const ELEVENLABS_VOICE_CACHE_TTL_MS = 5 * 60 * 1000;

const NARRATOR_BLUEPRINT: VoiceBlueprint = {
  label: "Narrator",
  envKey: "ELEVENLABS_VOICE_NARRATOR",
  fallbackId: "21m00Tcm4TlvDq8ikWAM",
};

const ARCHETYPE_BLUEPRINTS: Record<string, VoiceBlueprint> = {
  strategist: {
    label: "Strategist",
    envKey: "ELEVENLABS_VOICE_STRATEGIST",
    fallbackId: "pNInz6obpgDQGcFmaJgB",
  },
  commander: {
    label: "Commander",
    envKey: "ELEVENLABS_VOICE_COMMANDER",
    fallbackId: "VR6AewLTigWG4xSOukaG",
  },
  "moral-witness": {
    label: "Moral Witness",
    envKey: "ELEVENLABS_VOICE_MORAL_WITNESS",
    fallbackId: "EXAVITQu4vr4xnSDxMaL",
  },
  "rival-noble": {
    label: "Rival Noble",
    envKey: "ELEVENLABS_VOICE_RIVAL_NOBLE",
    fallbackId: "ErXwobaYiN019PkySvjV",
  },
  default: {
    label: "Character",
    envKey: "ELEVENLABS_VOICE_CHARACTER_DEFAULT",
    fallbackId: "TxGEqnHWrfWFTfGW9XjX",
  },
};

const VOICE_POOL: VoiceBlueprint[] = [
  ARCHETYPE_BLUEPRINTS.strategist,
  ARCHETYPE_BLUEPRINTS.commander,
  ARCHETYPE_BLUEPRINTS["moral-witness"],
  ARCHETYPE_BLUEPRINTS["rival-noble"],
  ARCHETYPE_BLUEPRINTS.default,
];

const ARCHETYPE_HINTS: Record<string, string[]> = {
  strategist: ["measured", "calm", "analytical", "authoritative"],
  commander: ["commanding", "intense", "bold", "military"],
  "moral-witness": ["warm", "soft", "wise", "reflective"],
  "rival-noble": ["polished", "aristocratic", "smooth", "sharp"],
  default: ["balanced", "clear", "confident"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function allowProfessionalVoices() {
  return process.env.ELEVENLABS_ALLOW_PROFESSIONAL_VOICES === "true";
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function uniqueTokens(tokens: string[]) {
  return Array.from(new Set(tokens));
}

function stableHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

function resolveVoiceId(blueprint: VoiceBlueprint) {
  return (
    process.env[blueprint.envKey] ??
    process.env.ELEVENLABS_VOICE_ID ??
    blueprint.fallbackId
  );
}

function toVoiceProfile(blueprint: VoiceBlueprint): VoiceProfile {
  return {
    provider: "elevenlabs",
    voiceId: resolveVoiceId(blueprint),
    label: blueprint.label,
  };
}

function buildSearchableVoiceText(voice: Record<string, unknown>) {
  const labels = asRecord(voice.labels) ?? {};
  const labelTokens = Object.entries(labels)
    .flatMap(([key, raw]) => {
      if (typeof raw !== "string") {
        return [key];
      }

      return [key, raw];
    })
    .join(" ");

  return [
    typeof voice.name === "string" ? voice.name : "",
    typeof voice.category === "string" ? voice.category : "",
    typeof voice.description === "string" ? voice.description : "",
    typeof voice.preview_url === "string" ? voice.preview_url : "",
    labelTokens,
  ]
    .join(" ")
    .toLowerCase();
}

async function fetchAvailableElevenLabsVoices() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const allowProfessional = allowProfessionalVoices();

  if (!apiKey) {
    return [];
  }

  const now = Date.now();
  const cached = globalVoiceCache.__pandoraElevenVoiceCache;

  if (
    cached &&
    cached.expiresAt > now &&
    cached.allowProfessionalVoices === allowProfessional
  ) {
    return cached.filteredVoices;
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    method: "GET",
    headers: {
      "xi-api-key": apiKey,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load ElevenLabs voices (${response.status}).`);
  }

  const payload = asRecord(await response.json()) ?? {};
  const voicesRaw = Array.isArray(payload.voices) ? payload.voices : [];

  const voices: ElevenLabsVoice[] = voicesRaw
    .map((entry) => {
      const record = asRecord(entry) ?? {};
      const voiceId =
        (typeof record.voice_id === "string" && record.voice_id.trim()) ||
        (typeof record.voiceId === "string" && record.voiceId.trim()) ||
        "";
      const name = (typeof record.name === "string" && record.name.trim()) || "Voice";
      const category =
        (typeof record.category === "string" && record.category.toLowerCase()) ||
        "unknown";

      if (!voiceId) {
        return null;
      }

      return {
        voiceId,
        name,
        category,
        searchable: buildSearchableVoiceText(record),
      };
    })
    .filter((voice): voice is ElevenLabsVoice => Boolean(voice));

  const filtered = allowProfessional
    ? voices
    : voices.filter((voice) => voice.category !== "professional");

  globalVoiceCache.__pandoraElevenVoiceCache = {
    allowProfessionalVoices: allowProfessional,
    rawVoices: voices,
    filteredVoices: filtered,
    expiresAt: now + ELEVENLABS_VOICE_CACHE_TTL_MS,
  };

  return filtered;
}

export async function getVoiceDiscoveryDebugInfo() {
  const hasApiKey = Boolean(process.env.ELEVENLABS_API_KEY);
  const allowProfessional = allowProfessionalVoices();
  const now = Date.now();
  const cached = globalVoiceCache.__pandoraElevenVoiceCache;
  const cacheHit = Boolean(
    cached &&
      cached.expiresAt > now &&
      cached.allowProfessionalVoices === allowProfessional,
  );

  if (!hasApiKey) {
    return {
      hasApiKey: false,
      allowProfessionalVoices: allowProfessional,
      cache: {
        hit: false,
        expiresAt: null as string | null,
        ttlSeconds: Math.round(ELEVENLABS_VOICE_CACHE_TTL_MS / 1000),
      },
      counts: {
        raw: 0,
        filtered: 0,
      },
      voices: [] as Array<{ voiceId: string; name: string; category: string }>,
      error: null as string | null,
    };
  }

  try {
    await fetchAvailableElevenLabsVoices();

    const snapshot = globalVoiceCache.__pandoraElevenVoiceCache;
    const rawVoices = snapshot?.rawVoices ?? [];
    const filteredVoices = snapshot?.filteredVoices ?? [];

    return {
      hasApiKey: true,
      allowProfessionalVoices: allowProfessional,
      cache: {
        hit: cacheHit,
        expiresAt: snapshot ? new Date(snapshot.expiresAt).toISOString() : null,
        ttlSeconds: Math.round(ELEVENLABS_VOICE_CACHE_TTL_MS / 1000),
      },
      counts: {
        raw: rawVoices.length,
        filtered: filteredVoices.length,
      },
      voices: filteredVoices.map((voice) => ({
        voiceId: voice.voiceId,
        name: voice.name,
        category: voice.category,
      })),
      error: null as string | null,
    };
  } catch (error) {
    return {
      hasApiKey: true,
      allowProfessionalVoices: allowProfessional,
      cache: {
        hit: cacheHit,
        expiresAt: cached ? new Date(cached.expiresAt).toISOString() : null,
        ttlSeconds: Math.round(ELEVENLABS_VOICE_CACHE_TTL_MS / 1000),
      },
      counts: {
        raw: 0,
        filtered: 0,
      },
      voices: [] as Array<{ voiceId: string; name: string; category: string }>,
      error: error instanceof Error ? error.message : "Failed to discover ElevenLabs voices.",
    };
  }
}

function scoreVoiceAgainstTokens(voice: ElevenLabsVoice, tokens: string[]) {
  let score = 0;

  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (voice.searchable.includes(` ${token} `)) {
      score += 5;
      continue;
    }

    if (voice.searchable.includes(token)) {
      score += token.length >= 5 ? 3 : 2;
    }
  }

  return score;
}

function pickVoiceFromPool(params: {
  voices: ElevenLabsVoice[];
  seed: string;
  tokens: string[];
  usedVoiceIds: Set<string>;
  preferredVoiceId?: string;
}) {
  const { voices, seed, tokens, usedVoiceIds, preferredVoiceId } = params;

  if (!voices.length) {
    return null;
  }

  if (preferredVoiceId) {
    const preferred = voices.find((voice) => voice.voiceId === preferredVoiceId);

    if (preferred) {
      return preferred;
    }
  }

  const available = voices.filter((voice) => !usedVoiceIds.has(voice.voiceId));
  const candidatePool = available.length ? available : voices;

  const ranked = candidatePool
    .map((voice) => ({
      voice,
      score: scoreVoiceAgainstTokens(voice, tokens),
      tieBreaker: stableHash(`${seed}:${voice.voiceId}`),
    }))
    .sort((a, b) => b.score - a.score || a.tieBreaker - b.tieBreaker);

  return ranked[0]?.voice ?? null;
}

function characterTraitTokens(character: CharacterDefinition) {
  const archetypeSlug = slugify(character.archetype);
  const archetypeHints = ARCHETYPE_HINTS[archetypeSlug] ?? ARCHETYPE_HINTS.default;

  return uniqueTokens([
    ...tokenize(character.archetype),
    ...tokenize(character.title),
    ...tokenize(character.speakingStyle),
    ...character.motivations.flatMap((motivation) => tokenize(motivation)),
    ...archetypeHints.flatMap((hint) => tokenize(hint)),
  ]);
}

function narratorTraitTokens(world: WorldDefinition) {
  return uniqueTokens([
    ...tokenize(world.setting),
    ...tokenize(world.premise),
    ...tokenize(world.introNarration),
    ...world.tonalConstraints.flatMap((constraint) => tokenize(constraint)),
    "narrator",
    "storyteller",
    "dramatic",
    "authoritative",
    "clear",
  ]);
}

export function getNarratorVoiceProfile() {
  return toVoiceProfile(NARRATOR_BLUEPRINT);
}

export function getCharacterVoiceProfile(archetype: string, index = 0) {
  const normalized = slugify(archetype);
  const mapped =
    ARCHETYPE_BLUEPRINTS[normalized] ??
    VOICE_POOL[Math.abs(index) % VOICE_POOL.length] ??
    ARCHETYPE_BLUEPRINTS.default;

  return toVoiceProfile(mapped);
}

export function normalizeVoiceProfile(
  value: unknown,
  fallback?: VoiceProfile,
): VoiceProfile | undefined {
  if (!value) {
    return fallback;
  }

  if (typeof value === "string") {
    return {
      provider: "elevenlabs",
      voiceId: value,
      label: fallback?.label,
    };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const candidate = value as Record<string, unknown>;
  const providerRaw = candidate.provider;
  const provider: VoiceProvider =
    providerRaw === "openai" || providerRaw === "elevenlabs"
      ? providerRaw
      : fallback?.provider ?? "elevenlabs";
  const voiceId =
    (typeof candidate.voiceId === "string" && candidate.voiceId.trim()) ||
    fallback?.voiceId ||
    "";

  if (!voiceId) {
    return fallback;
  }

  return {
    provider,
    voiceId,
    label:
      (typeof candidate.label === "string" && candidate.label.trim()) ||
      fallback?.label,
  };
}

export async function assignDynamicVoiceProfiles(world: WorldDefinition) {
  const fallbackNarrator = getNarratorVoiceProfile();
  const fallbackCharacters = world.characters.map((character, index) => ({
    ...character,
    voice: normalizeVoiceProfile(
      character.voice,
      getCharacterVoiceProfile(character.archetype, index),
    ),
  }));

  const fallbackWorld: WorldDefinition = {
    ...world,
    narratorVoice: normalizeVoiceProfile(world.narratorVoice, fallbackNarrator),
    characters: fallbackCharacters,
  };

  if (!process.env.ELEVENLABS_API_KEY) {
    return fallbackWorld;
  }

  let availableVoices: ElevenLabsVoice[];

  try {
    availableVoices = await fetchAvailableElevenLabsVoices();
  } catch {
    return fallbackWorld;
  }

  if (!availableVoices.length) {
    return fallbackWorld;
  }

  const usedVoiceIds = new Set<string>();
  const existingNarrator = normalizeVoiceProfile(world.narratorVoice);

  const selectedNarrator =
    pickVoiceFromPool({
      voices: availableVoices,
      seed: `narrator:${world.id}`,
      tokens: narratorTraitTokens(world),
      usedVoiceIds,
      preferredVoiceId:
        existingNarrator?.provider === "elevenlabs"
          ? existingNarrator.voiceId
          : fallbackNarrator.voiceId,
    }) ?? availableVoices[0];

  usedVoiceIds.add(selectedNarrator.voiceId);

  const narratorVoice: VoiceProfile = {
    provider: "elevenlabs",
    voiceId: selectedNarrator.voiceId,
    label: selectedNarrator.name,
  };

  const characters = world.characters.map((character, index) => {
    const existing = normalizeVoiceProfile(character.voice);
    const preferredVoiceId =
      existing?.provider === "elevenlabs" ? existing.voiceId : undefined;
    const selected =
      pickVoiceFromPool({
        voices: availableVoices,
        seed: `character:${world.id}:${character.id}:${index}`,
        tokens: characterTraitTokens(character),
        usedVoiceIds,
        preferredVoiceId,
      }) ?? availableVoices[0];

    usedVoiceIds.add(selected.voiceId);

    return {
      ...character,
      voice: {
        provider: "elevenlabs" as const,
        voiceId: selected.voiceId,
        label: selected.name,
      },
    };
  });

  return {
    ...world,
    narratorVoice,
    characters,
  };
}
