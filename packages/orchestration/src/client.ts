import {
  ORCHESTRATOR_JSON_SCHEMA,
  orchestratorDecisionSchema,
  sceneStateSchema,
  type OrchestratorDecision,
  type Scene,
  type SceneState,
} from "@odyssey/types";

export type SceneTurnForPlanning = {
  speakerSlug: string;
  speakerName?: string;
  text: string;
};

export type SceneDecisionMessage = {
  role: "system" | "user";
  content: string;
};

export type SceneDecisionRequest = {
  messages: SceneDecisionMessage[];
  responseSchema: typeof ORCHESTRATOR_JSON_SCHEMA;
  trace: {
    sceneId: string;
    turnIndex: number;
    presentCharacterSlugs: string[];
    recentTurnCount: number;
    sceneMemoryCount: number;
    lastUserMessage?: string;
  };
};

export type SceneDecisionResolution = {
  decision: OrchestratorDecision;
  sceneState: SceneState;
  speakerSlug: string | null;
  events: SceneEventDraft[];
  degraded: boolean;
  reason?: string;
};

export type SceneEventDraftType =
  | "scene.decision.speak"
  | "scene.decision.narrate"
  | "scene.decision.wait"
  | "scene.decision.end";

export type SceneEventDraft = {
  type: SceneEventDraftType;
  source: "orchestration";
  payload: {
    sceneId: string;
    action: OrchestratorDecision["action"];
    speakerSlug: string | null;
    previousSceneState: SceneState;
    nextSceneState: SceneState;
    decision: OrchestratorDecision;
    degraded?: boolean;
    reason?: string;
  };
};

export type SpeakerTurnRequest = {
  characterSlug: string;
  speakerName: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  promptChunk: string;
  voiceSlug: string;
};

export type SceneSessionSnapshot = {
  version: 1;
  sceneId: string;
  sceneState: SceneState;
  sceneMemory: string[];
  updatedAt: string;
};

const RECENT_TURNS_LIMIT = 6;
const SCENE_MEMORY_LIMIT = 12;
const SCENE_MEMORY_ENTRY_MAX_CHARS = 280;

export function createInitialSceneState(scene: Scene): SceneState {
  return {
    sceneId: scene.id,
    beat: scene.openingBeat,
    presentCharacterSlugs: scene.characters.map((c) => c.characterSlug),
    ambience: scene.defaultAmbience,
    lastSpeakerSlug: null,
    turnIndex: 0,
  };
}

export function defaultSceneDecision(
  scene: Scene,
  state: SceneState,
): OrchestratorDecision {
  return {
    action: "wait-for-user",
    ambience: state.ambience ?? scene.defaultAmbience,
  };
}

export function buildSceneSessionSnapshot(
  sceneState: SceneState,
  options: string | { updatedAt?: string; sceneMemory?: string[] } = {},
): SceneSessionSnapshot {
  const updatedAt = typeof options === "string"
    ? options
    : options.updatedAt ?? new Date().toISOString();
  const sceneMemory = typeof options === "string"
    ? []
    : sanitizeSceneMemory(options.sceneMemory ?? []);
  return {
    version: 1,
    sceneId: sceneState.sceneId,
    sceneState,
    sceneMemory,
    updatedAt,
  };
}

export function readSceneStateFromSnapshot(
  value: unknown,
  sceneId: string,
): SceneState | null {
  const direct = sceneStateSchema.safeParse(value);
  if (direct.success && direct.data.sceneId === sceneId) return direct.data;

  if (!value || typeof value !== "object") return null;
  const candidate = value as { sceneId?: unknown; sceneState?: unknown };
  if (candidate.sceneId !== sceneId) return null;

  const parsed = sceneStateSchema.safeParse(candidate.sceneState);
  if (!parsed.success) return null;
  return parsed.data.sceneId === sceneId ? parsed.data : null;
}

export function readSceneMemoryFromSnapshot(
  value: unknown,
  sceneId: string,
): string[] {
  if (!value || typeof value !== "object") return [];
  const candidate = value as { sceneId?: unknown; sceneMemory?: unknown };
  if (candidate.sceneId !== sceneId || !Array.isArray(candidate.sceneMemory)) {
    return [];
  }
  return sanitizeSceneMemory(candidate.sceneMemory);
}

export function updateSceneMemory(input: {
  previousMemory?: string[];
  recentTurns?: SceneTurnForPlanning[];
  maxEntries?: number;
}): string[] {
  const maxEntries = input.maxEntries ?? SCENE_MEMORY_LIMIT;
  const entries = sanitizeSceneMemory(input.previousMemory ?? []);
  for (const turn of input.recentTurns ?? []) {
    const text = compactWhitespace(turn.text);
    if (!text) continue;
    const speaker = compactWhitespace(turn.speakerName ?? turn.speakerSlug);
    entries.push(truncateMemoryEntry(`${speaker}: ${text}`));
  }

  const deduped: string[] = [];
  for (const entry of entries) {
    const existingIndex = deduped.indexOf(entry);
    if (existingIndex !== -1) deduped.splice(existingIndex, 1);
    deduped.push(entry);
  }
  return deduped.slice(-maxEntries);
}

export function buildSceneDecisionRequest(input: {
  scene: Scene;
  sceneState: SceneState;
  recentTurns?: SceneTurnForPlanning[];
  sceneMemory?: string[];
  lastUserMessage?: string;
}): SceneDecisionRequest {
  const recentTurns = (input.recentTurns ?? []).slice(-RECENT_TURNS_LIMIT);
  const sceneMemory = sanitizeSceneMemory(input.sceneMemory ?? []);
  return {
    messages: [
      {
        role: "system",
        content: buildOrchestratorSystemPrompt(input.scene, input.sceneState, sceneMemory),
      },
      {
        role: "user",
        content: buildOrchestratorUserPrompt(recentTurns, input.lastUserMessage),
      },
    ],
    responseSchema: ORCHESTRATOR_JSON_SCHEMA,
    trace: {
      sceneId: input.scene.id,
      turnIndex: input.sceneState.turnIndex,
      presentCharacterSlugs: input.sceneState.presentCharacterSlugs,
      recentTurnCount: recentTurns.length,
      sceneMemoryCount: sceneMemory.length,
      ...(input.lastUserMessage ? { lastUserMessage: input.lastUserMessage } : {}),
    },
  };
}

export function resolveSceneDecision(
  input: {
    scene: Scene;
    sceneState: SceneState;
  },
  rawDecision: unknown,
): SceneDecisionResolution {
  const parsed = orchestratorDecisionSchema.safeParse(stripNullOptionalDecisionFields(rawDecision));
  if (!parsed.success) {
    return fallbackResolution(input, "invalid-decision-shape");
  }

  const decision = parsed.data;
  if (decision.action === "speak") {
    const speakerSlug = decision.speakerId?.trim() ?? "";
    const present = input.scene.characters.some(
      (c) =>
        c.characterSlug === speakerSlug &&
        input.sceneState.presentCharacterSlugs.includes(c.characterSlug),
    );
    if (!speakerSlug || !present) {
      return fallbackResolution(
        input,
        speakerSlug ? `unknown-speaker:${speakerSlug}` : "missing-speaker",
      );
    }
    return applyDecision(input, decision, speakerSlug);
  }

  if (decision.action === "narrate" && !decision.narration?.trim()) {
    return fallbackResolution(input, "empty-narration");
  }

  return applyDecision(input, decision, null);
}

export function fallbackSceneDecisionResolution(
  input: {
    scene: Scene;
    sceneState: SceneState;
  },
  reason: string,
): SceneDecisionResolution {
  return fallbackResolution(input, reason);
}

function stripNullOptionalDecisionFields(rawDecision: unknown): unknown {
  if (!rawDecision || typeof rawDecision !== "object" || Array.isArray(rawDecision)) {
    return rawDecision;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawDecision)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

export function buildSpeakerTurnRequest(input: {
  scene: Scene;
  sceneState: SceneState;
  decision: OrchestratorDecision;
  recentTurns: SceneTurnForPlanning[];
}): SpeakerTurnRequest | null {
  if (input.decision.action !== "speak") return null;
  const speakerSlug = input.decision.speakerId?.trim();
  if (!speakerSlug) return null;

  const character = input.scene.characters.find(
    (c) =>
      c.characterSlug === speakerSlug &&
      input.sceneState.presentCharacterSlugs.includes(c.characterSlug),
  );
  if (!character) return null;

  const previousTurn = [...input.recentTurns]
    .reverse()
    .find((t) => t.speakerSlug !== speakerSlug);
  const beat = input.decision.beat ?? input.sceneState.beat;
  const message = previousTurn?.text ?? beat;
  const history = input.recentTurns.slice(-RECENT_TURNS_LIMIT).map((turn) => ({
    role: turn.speakerSlug === speakerSlug ? ("assistant" as const) : ("user" as const),
    content: turn.text,
  }));
  const promptChunk = input.decision.sceneCue
    ? `Scene direction (orchestrator): ${input.decision.sceneCue}\nBeat: ${beat}`
    : `Beat: ${beat}`;

  return {
    characterSlug: speakerSlug,
    speakerName: character.displayName,
    message,
    history,
    promptChunk,
    voiceSlug: character.voice,
  };
}

function applyDecision(
  input: {
    scene: Scene;
    sceneState: SceneState;
  },
  decision: OrchestratorDecision,
  speakerSlug: string | null,
  meta?: { degraded?: boolean; reason?: string },
): SceneDecisionResolution {
  const nextState: SceneState = {
    ...input.sceneState,
    beat: decision.beatLabel ?? input.sceneState.beat,
    ambience:
      decision.ambience !== undefined
        ? decision.ambience
        : input.sceneState.ambience,
    lastSpeakerSlug: speakerSlug ?? input.sceneState.lastSpeakerSlug,
    turnIndex: input.sceneState.turnIndex + 1,
  };

  return {
    decision,
    sceneState: nextState,
    speakerSlug,
    events: [
      {
        type: eventTypeForAction(decision.action),
        source: "orchestration",
        payload: {
          sceneId: input.scene.id,
          action: decision.action,
          speakerSlug,
          previousSceneState: input.sceneState,
          nextSceneState: nextState,
          decision,
          ...(meta?.degraded ? { degraded: meta.degraded } : {}),
          ...(meta?.reason ? { reason: meta.reason } : {}),
        },
      },
    ],
    degraded: meta?.degraded ?? false,
    reason: meta?.reason,
  };
}

function fallbackResolution(
  input: {
    scene: Scene;
    sceneState: SceneState;
  },
  reason: string,
): SceneDecisionResolution {
  const fallback = defaultSceneDecision(input.scene, input.sceneState);
  return applyDecision(input, fallback, null, { degraded: true, reason });
}

function eventTypeForAction(action: OrchestratorDecision["action"]): SceneEventDraftType {
  switch (action) {
    case "speak":
      return "scene.decision.speak";
    case "narrate":
      return "scene.decision.narrate";
    case "end-scene":
      return "scene.decision.end";
    case "wait-for-user":
    default:
      return "scene.decision.wait";
  }
}

function buildOrchestratorSystemPrompt(
  scene: Scene,
  state: SceneState,
  sceneMemory: string[],
): string {
  const roster = scene.characters
    .filter((c) => state.presentCharacterSlugs.includes(c.characterSlug))
    .map((c) => `  - slug="${c.characterSlug}" name="${c.displayName}" - ${c.blurb}`)
    .join("\n");

  return [
    "You are the orchestrator of a voice-driven, multi-character scene.",
    "Your job is to decide what happens next: who speaks, what beat the",
    "scene is on, and what the audio bed should be. You do NOT write",
    "dialogue - when you choose `action: \"speak\"`, give a short `beat`",
    "(one sentence of direction) and the character LLM writes the words.",
    "",
    "When you choose `action: \"speak\"`, set `speakerId` to the character's",
    "slug from the roster below (NOT their display name).",
    "",
    `Scene: "${scene.title}"`,
    scene.description,
    "",
    "Characters present:",
    roster,
    "",
    `Current beat: ${state.beat}`,
    state.lastSpeakerSlug
      ? `Last to speak: ${state.lastSpeakerSlug}`
      : "Scene has just opened.",
    state.ambience ? `Current ambience: ${state.ambience}` : "No ambience playing.",
    ...(sceneMemory.length
      ? ["", "Scene memory (older context, oldest to newest):", ...sceneMemory.map((m) => `  - ${m}`)]
      : []),
    "",
    "Decision rules:",
    "- Default to advancing the scene with `action: \"speak\"`. Pick a",
    "  speaker whose move makes the scene move - usually NOT the last",
    "  speaker.",
    "- Use `action: \"wait-for-user\"` when a character has directly",
    "  posed something to the user, or after 2-3 consecutive AI turns to",
    "  give the user space to respond.",
    "- Use `action: \"narrate\"` sparingly - for scene transitions or",
    "  bridging beats. Keep narration under two sentences.",
    "- Use `action: \"end-scene\"` only when the beat has clearly",
    "  resolved or the user has indicated they want to leave.",
    "- Change `ambience` only when the emotional register of the scene",
    "  shifts. Don't churn it.",
    "- Update `beatLabel` only when the beat has materially advanced.",
    "",
    "Return your decision as JSON matching the provided schema.",
  ].join("\n");
}

function buildOrchestratorUserPrompt(
  recentTurns: SceneTurnForPlanning[],
  lastUserMessage?: string,
): string {
  const lines: string[] = [];
  if (recentTurns.length === 0) {
    lines.push("(no dialogue yet - open the scene)");
  } else {
    lines.push("Recent dialogue:");
    for (const turn of recentTurns) {
      const who = turn.speakerName ?? turn.speakerSlug;
      lines.push(`  ${who}: ${turn.text}`);
    }
  }
  if (lastUserMessage) {
    lines.push("");
    lines.push(`The user just said: "${lastUserMessage}"`);
    lines.push("Bias your decision toward whoever the user is addressing.");
  }
  lines.push("");
  lines.push("What happens next?");
  return lines.join("\n");
}

function sanitizeSceneMemory(memory: unknown[]): string[] {
  return memory
    .map((entry) => (typeof entry === "string" ? truncateMemoryEntry(entry) : ""))
    .filter(Boolean)
    .slice(-SCENE_MEMORY_LIMIT);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateMemoryEntry(value: string): string {
  const compact = compactWhitespace(value);
  if (compact.length <= SCENE_MEMORY_ENTRY_MAX_CHARS) return compact;
  return `${compact.slice(0, SCENE_MEMORY_ENTRY_MAX_CHARS - 3).trimEnd()}...`;
}

export type {
  OrchestratorDecision,
  Scene,
  SceneState,
};

export { getScene, listScenes } from "./scenes";
