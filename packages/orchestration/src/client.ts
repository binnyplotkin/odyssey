import {
  ORCHESTRATOR_JSON_SCHEMA,
  orchestratorDecisionSchema,
  sceneStateSchema,
  type OrchestratorDecision,
  type Scene,
  type SceneCharacter,
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
  // History is the context BEFORE the turn we're responding to. Exclude the
  // `previousTurn` we just lifted into `message`, or it's fed twice (here AND as the
  // appended user message downstream — run-voice-stream `[...history, {message}]`).
  const history = input.recentTurns
    .filter((turn) => turn !== previousTurn)
    .slice(-RECENT_TURNS_LIMIT)
    .map((turn) => ({
      role: turn.speakerSlug === speakerSlug ? ("assistant" as const) : ("user" as const),
      content: turn.text,
    }));
  // The orchestrator's per-turn DRIVE direction (`beat`), framed so the character
  // acts on it in their own voice; `sceneCue` is an optional scene-level note;
  // the speaker's authored agenda rides along so the character knows what THEY
  // want here. All route through the per-turn <context> block, never the cached
  // voice envelope, so voice is preserved by construction.
  const promptChunk = buildDirectiveChunk({
    beat,
    sceneCue: input.decision.sceneCue,
    speaker: character,
  });

  return {
    characterSlug: speakerSlug,
    speakerName: character.displayName,
    message,
    history,
    promptChunk,
    voiceSlug: character.voice,
  };
}

/**
 * Validate the decision's audio cues against the scene's roster
 * (Scene.sounds). Only engages when a roster exists — legacy scenes
 * (static registry, character sandboxes) keep free-string behavior.
 * Invalid cues are dropped, never fatal: an hallucinated sound id
 * shouldn't cost the turn.
 */
function sanitizeAudioCues(
  scene: Scene,
  decision: OrchestratorDecision,
): { decision: OrchestratorDecision; notes: string[] } {
  if (!scene.sounds) return { decision, notes: [] };
  const notes: string[] = [];
  const sanitized = { ...decision };

  const bedSlugs = new Set(
    scene.sounds.filter((s) => s.role === "bed").map((s) => s.slug),
  );
  // An ambience id must be a roster bed; dropping the field keeps the
  // current bed playing. (Nulls never reach here — the strict schema makes
  // the model emit null for every unused field, so nulls are stripped
  // upstream and mean "no change".)
  if (typeof sanitized.ambience === "string" && !bedSlugs.has(sanitized.ambience)) {
    notes.push(`ambience-not-in-roster:${sanitized.ambience}`);
    delete sanitized.ambience;
  }

  if (sanitized.sfx?.length) {
    const oneshotSlugs = new Set(
      scene.sounds.filter((s) => s.role === "oneshot").map((s) => s.slug),
    );
    const kept = sanitized.sfx.filter((cue) => oneshotSlugs.has(cue.id));
    const dropped = sanitized.sfx.filter((cue) => !oneshotSlugs.has(cue.id));
    if (dropped.length > 0) {
      notes.push(`sfx-not-in-roster:${dropped.map((c) => c.id).join(",")}`);
      sanitized.sfx = kept;
    }
  }

  return { decision: sanitized, notes };
}

/**
 * The per-turn directive injected into the speaker's <context> block:
 * the director's `beat`, the optional scene note, and the speaker's own
 * authored agenda (scene-node intention). Shared by the reactive path
 * (buildSpeakerTurnRequest) and the proactive path (SceneDriver) so the
 * two never drift.
 */
export function buildDirectiveChunk(input: {
  beat: string;
  sceneCue?: string;
  speaker?: Pick<SceneCharacter, "motivations" | "behaviorTriggers">;
}): string {
  const lines = [`Direction: ${input.beat}`];
  if (input.sceneCue) lines.push(`Scene note: ${input.sceneCue}`);
  if (input.speaker?.motivations) {
    lines.push(`Your agenda in this scene: ${input.speaker.motivations}`);
  }
  for (const t of (input.speaker?.behaviorTriggers ?? []).slice(0, 3)) {
    lines.push(`When ${t.condition}: ${t.behavior}`);
  }
  return lines.join("\n");
}

function applyDecision(
  input: {
    scene: Scene;
    sceneState: SceneState;
  },
  rawDecision: OrchestratorDecision,
  speakerSlug: string | null,
  meta?: { degraded?: boolean; reason?: string },
): SceneDecisionResolution {
  const { decision, notes } = sanitizeAudioCues(input.scene, rawDecision);
  const reason =
    [meta?.reason, ...notes].filter(Boolean).join("; ") || undefined;

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
          ...(reason ? { reason } : {}),
        },
      },
    ],
    degraded: meta?.degraded ?? false,
    reason,
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
  const present = scene.characters.filter((c) =>
    state.presentCharacterSlugs.includes(c.characterSlug),
  );
  const roster = present
    .map((c) => {
      const lines = [`  - slug="${c.characterSlug}" name="${c.displayName}" - ${c.blurb}`];
      // Authored intention (scene-node data). Kept to compact sub-lines so
      // a 4-character roster stays token-tight.
      const facts = [
        c.motivations ? `wants: ${c.motivations}` : null,
        c.roleInScene ? `role: ${c.roleInScene}` : null,
        c.emotionalBaseline ? `baseline: ${c.emotionalBaseline}` : null,
      ].filter(Boolean);
      if (facts.length) lines.push(`      ${facts.join("   ")}`);
      for (const t of c.behaviorTriggers ?? []) {
        lines.push(`      will: ${t.behavior} (when ${t.condition})`);
      }
      return lines.join("\n");
    })
    .join("\n");
  const anyIntent = present.some((c) => c.motivations || c.behaviorTriggers?.length);

  return [
    "You are the DIRECTOR of a voice-driven scene. You decide what happens next -",
    "who speaks, and the MOVE that makes the scene alive right now. You do NOT write",
    "dialogue: when you choose `action: \"speak\"` you set `speakerId` and a `beat` -",
    "a one-line DIRECTION for that character - and the character LLM speaks it in",
    "their own voice.",
    "",
    "Direct, don't transcribe. The `beat` is the character's intent THIS turn: what",
    "they react to and how they push the scene forward. Make it active - invent the",
    "goal for this character in the moment, don't wait to be asked. A strong turn",
    "usually ends by putting something back to the user: a question, a challenge, an",
    "invitation. Good beats:",
    "  - \"Turn the question back on them - ask why they're really asking.\"",
    "  - \"Name the thing they're avoiding; press, don't soothe.\"",
    "  - \"Draw out what they came here looking for.\"",
    "Set `beat` on EVERY `speak`. But vary the move - not every turn is a question;",
    "sometimes reveal, sometimes press, sometimes land a hard truth. Never script the",
    "words - that's the character's job; the `beat` is intent, not lines.",
    "",
    "Set `speakerId` to the character's slug from the roster below (NOT their name).",
    "",
    `Scene: "${scene.title}"`,
    scene.description,
    ...(scene.objective ? [`This scene is driving toward: ${scene.objective}`] : []),
    ...(present.some((c) => c.knowledgeHorizon)
      ? [
          "The characters live in this scene's dramatic present - their later life",
          "has NOT happened yet. Never direct a character to recount events beyond",
          "this moment; if the dialogue drifts there, steer it back to now.",
        ]
      : []),
    ...buildArcBlock(scene, state),
    "",
    "Characters present:",
    roster,
    "",
    `Current situation: ${state.beat}`,
    ...(state.directorNote
      ? [`Director's note (your own earlier reflection): ${state.directorNote}`]
      : []),
    state.lastSpeakerSlug
      ? `Last to speak: ${state.lastSpeakerSlug}`
      : "Scene has just opened.",
    state.ambience ? `Current ambience: ${state.ambience}` : "No ambience playing.",
    ...buildSoundsBlock(scene),
    ...(sceneMemory.length
      ? ["", "Scene memory (older context, oldest to newest):", ...sceneMemory.map((m) => `  - ${m}`)]
      : []),
    "",
    "Decision rules:",
    "- Default to advancing the scene with `action: \"speak\"` and an active `beat`.",
    "  Pick the speaker whose move makes the scene move - usually NOT the last speaker.",
    ...(present.length > 1
      ? [
          "- When the dialogue names, addresses, or NOTICES a present character who",
          "  hasn't spoken (overheard, glimpsed, asked about), that character stepping",
          "  in is usually the strongest move - don't let another character answer",
          "  for them.",
        ]
      : []),
    ...(anyIntent
      ? [
          "- Write `beat`s in service of what the speaker WANTS (their `wants:` line)",
          "  and what the scene is driving toward - intention first, reaction second.",
          "  Honor `will:` triggers when their condition is live in the dialogue.",
        ]
      : []),
    ...(scene.drive === "gentle"
      ? [
          "- Follow the user's lead - let them set the pace; press only when invited.",
        ]
      : scene.drive === "insistent"
        ? [
            "- Press actively - characters pursue their goals even against user",
            "  resistance; don't wait to be asked.",
          ]
        : []),
    ...(scene.arc?.length
      ? [
          "- Steer toward the [next] arc beat when the moment allows - set up its",
          "  conditions, don't force or announce it, and never skip ahead of the arc.",
        ]
      : []),
    "- Use `action: \"wait-for-user\"` when the last turn already put something to the",
    "  user, or after 2-3 consecutive AI turns - give the user room to answer.",
    "- Use `action: \"narrate\"` sparingly - scene transitions or bridging beats only.",
    "  Keep narration under two sentences.",
    "- Use `action: \"end-scene\"` only when the situation has clearly resolved or the",
    "  user has indicated they want to leave.",
    "- Change `ambience` only when the emotional register shifts. Don't churn it.",
    ...(scene.sounds?.length
      ? [
          "- `ambience` must be one of the bed ids above (or null for silence).",
          "- Cue `sfx` sparingly - a one-shot lands hardest at a real moment (a",
          "  revelation, an arrival, the world reacting). Use only the one-shot ids",
          "  above. `at: \"now\"` plays before the speaker; `at: \"with-speaker\"`",
          "  layers under them. Most turns need no sfx.",
        ]
      : []),
    "- Update `beatLabel` only when the scene's situation has materially advanced",
    "  (distinct from `beat`, which is this turn's direction for the speaker).",
    "",
    "Return your decision as JSON matching the provided schema.",
  ].join("\n");
}

/**
 * The authored arc with progress markers — rendered into both the fast
 * director's prompt and the dramaturg's review. `[landed]` beats come
 * from state.arcLanded (label match); the first un-landed beat is
 * `[next]`, the rest `[ahead]`. Exported for the dramaturg module.
 */
export function buildArcBlock(scene: Scene, state: SceneState): string[] {
  if (!scene.arc?.length) return [];
  const landed = new Set((state.arcLanded ?? []).map((l) => l.toLowerCase()));
  let nextSeen = false;
  const lines = scene.arc.map((beat) => {
    const isLanded = landed.has(beat.label.toLowerCase());
    let marker: string;
    if (isLanded) {
      marker = "[landed]";
    } else if (!nextSeen) {
      marker = "[next]  ";
      nextSeen = true;
    } else {
      marker = "[ahead] ";
    }
    const summary = beat.summary ? ` - ${beat.summary}` : "";
    return `  ${marker} ${beat.label}${summary}`;
  });
  return ["Scene arc (authored beats, in order):", ...lines];
}

/** The director's audio roster — only rendered when the scene has placed
 *  sounds (Scene.sounds). Beds are cued via `ambience`, one-shots via
 *  `sfx`. Descriptions are the LLM-facing text authored on the asset;
 *  cue hints are scene-level authoring on the node. */
function buildSoundsBlock(scene: Scene): string[] {
  if (!scene.sounds?.length) return [];
  const beds = scene.sounds.filter((s) => s.role === "bed");
  const oneshots = scene.sounds.filter((s) => s.role === "oneshot");
  const line = (s: NonNullable<Scene["sounds"]>[number]) => {
    const desc = s.description?.trim() || s.name;
    const hint = s.triggerHint ? ` (cue: ${s.triggerHint})` : "";
    return `  - id="${s.slug}" - ${desc}${hint}`;
  };
  return [
    "",
    "Sounds available (cue by id):",
    ...(beds.length ? ["  beds (for `ambience`):", ...beds.map(line)] : []),
    ...(oneshots.length ? ["  one-shots (for `sfx`):", ...oneshots.map(line)] : []),
  ];
}

/** Sentinel passed as `lastUserMessage` when the orchestrator is consulted with no
 *  user utterance (a proactive/silence tick): the director should advance-or-hold,
 *  not respond to a message. */
export const PROACTIVE_SILENCE_MARKER = "(the user has gone quiet)";

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
  if (lastUserMessage === PROACTIVE_SILENCE_MARKER) {
    lines.push("");
    lines.push("The user has gone quiet - no new message. Decide whether the scene");
    lines.push("should advance NOW (a character follows up, re-engages, or presses)");
    lines.push("or `wait-for-user` if the last turn already invited them in and the");
    lines.push("silence is natural. Don't fill every silence.");
  } else if (lastUserMessage) {
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
