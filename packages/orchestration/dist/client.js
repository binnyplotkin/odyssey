import { ORCHESTRATOR_JSON_SCHEMA, orchestratorDecisionSchema, sceneStateSchema, } from "@odyssey/types";
const RECENT_TURNS_LIMIT = 6;
const SCENE_MEMORY_LIMIT = 12;
const SCENE_MEMORY_ENTRY_MAX_CHARS = 280;
export function createInitialSceneState(scene) {
    return {
        sceneId: scene.id,
        beat: scene.openingBeat,
        presentCharacterSlugs: scene.characters.map((c) => c.characterSlug),
        ambience: scene.defaultAmbience,
        lastSpeakerSlug: null,
        turnIndex: 0,
    };
}
export function defaultSceneDecision(scene, state) {
    var _a;
    return {
        action: "wait-for-user",
        ambience: (_a = state.ambience) !== null && _a !== void 0 ? _a : scene.defaultAmbience,
    };
}
export function buildSceneSessionSnapshot(sceneState, options = {}) {
    var _a, _b;
    const updatedAt = typeof options === "string"
        ? options
        : (_a = options.updatedAt) !== null && _a !== void 0 ? _a : new Date().toISOString();
    const sceneMemory = typeof options === "string"
        ? []
        : sanitizeSceneMemory((_b = options.sceneMemory) !== null && _b !== void 0 ? _b : []);
    return {
        version: 1,
        sceneId: sceneState.sceneId,
        sceneState,
        sceneMemory,
        updatedAt,
    };
}
export function readSceneStateFromSnapshot(value, sceneId) {
    const direct = sceneStateSchema.safeParse(value);
    if (direct.success && direct.data.sceneId === sceneId)
        return direct.data;
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    if (candidate.sceneId !== sceneId)
        return null;
    const parsed = sceneStateSchema.safeParse(candidate.sceneState);
    if (!parsed.success)
        return null;
    return parsed.data.sceneId === sceneId ? parsed.data : null;
}
export function readSceneMemoryFromSnapshot(value, sceneId) {
    if (!value || typeof value !== "object")
        return [];
    const candidate = value;
    if (candidate.sceneId !== sceneId || !Array.isArray(candidate.sceneMemory)) {
        return [];
    }
    return sanitizeSceneMemory(candidate.sceneMemory);
}
export function updateSceneMemory(input) {
    var _a, _b, _c, _d;
    const maxEntries = (_a = input.maxEntries) !== null && _a !== void 0 ? _a : SCENE_MEMORY_LIMIT;
    const entries = sanitizeSceneMemory((_b = input.previousMemory) !== null && _b !== void 0 ? _b : []);
    for (const turn of (_c = input.recentTurns) !== null && _c !== void 0 ? _c : []) {
        const text = compactWhitespace(turn.text);
        if (!text)
            continue;
        const speaker = compactWhitespace((_d = turn.speakerName) !== null && _d !== void 0 ? _d : turn.speakerSlug);
        entries.push(truncateMemoryEntry(`${speaker}: ${text}`));
    }
    const deduped = [];
    for (const entry of entries) {
        const existingIndex = deduped.indexOf(entry);
        if (existingIndex !== -1)
            deduped.splice(existingIndex, 1);
        deduped.push(entry);
    }
    return deduped.slice(-maxEntries);
}
export function buildSceneDecisionRequest(input) {
    var _a, _b;
    const recentTurns = ((_a = input.recentTurns) !== null && _a !== void 0 ? _a : []).slice(-RECENT_TURNS_LIMIT);
    const sceneMemory = sanitizeSceneMemory((_b = input.sceneMemory) !== null && _b !== void 0 ? _b : []);
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
        trace: Object.assign({ sceneId: input.scene.id, turnIndex: input.sceneState.turnIndex, presentCharacterSlugs: input.sceneState.presentCharacterSlugs, recentTurnCount: recentTurns.length, sceneMemoryCount: sceneMemory.length }, (input.lastUserMessage ? { lastUserMessage: input.lastUserMessage } : {})),
    };
}
export function resolveSceneDecision(input, rawDecision) {
    var _a, _b, _c;
    const parsed = orchestratorDecisionSchema.safeParse(stripNullOptionalDecisionFields(rawDecision));
    if (!parsed.success) {
        return fallbackResolution(input, "invalid-decision-shape");
    }
    const decision = parsed.data;
    if (decision.action === "speak") {
        const speakerSlug = (_b = (_a = decision.speakerId) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : "";
        const present = input.scene.characters.some((c) => c.characterSlug === speakerSlug &&
            input.sceneState.presentCharacterSlugs.includes(c.characterSlug));
        if (!speakerSlug || !present) {
            return fallbackResolution(input, speakerSlug ? `unknown-speaker:${speakerSlug}` : "missing-speaker");
        }
        return applyDecision(input, decision, speakerSlug);
    }
    if (decision.action === "narrate" && !((_c = decision.narration) === null || _c === void 0 ? void 0 : _c.trim())) {
        return fallbackResolution(input, "empty-narration");
    }
    return applyDecision(input, decision, null);
}
export function fallbackSceneDecisionResolution(input, reason) {
    return fallbackResolution(input, reason);
}
function stripNullOptionalDecisionFields(rawDecision) {
    if (!rawDecision || typeof rawDecision !== "object" || Array.isArray(rawDecision)) {
        return rawDecision;
    }
    const out = {};
    for (const [key, value] of Object.entries(rawDecision)) {
        if (value !== null)
            out[key] = value;
    }
    return out;
}
export function buildSpeakerTurnRequest(input) {
    var _a, _b, _c;
    if (input.decision.action !== "speak")
        return null;
    const speakerSlug = (_a = input.decision.speakerId) === null || _a === void 0 ? void 0 : _a.trim();
    if (!speakerSlug)
        return null;
    const character = input.scene.characters.find((c) => c.characterSlug === speakerSlug &&
        input.sceneState.presentCharacterSlugs.includes(c.characterSlug));
    if (!character)
        return null;
    const previousTurn = [...input.recentTurns]
        .reverse()
        .find((t) => t.speakerSlug !== speakerSlug);
    const beat = (_b = input.decision.beat) !== null && _b !== void 0 ? _b : input.sceneState.beat;
    const message = (_c = previousTurn === null || previousTurn === void 0 ? void 0 : previousTurn.text) !== null && _c !== void 0 ? _c : beat;
    const history = input.recentTurns.slice(-RECENT_TURNS_LIMIT).map((turn) => ({
        role: turn.speakerSlug === speakerSlug ? "assistant" : "user",
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
function applyDecision(input, decision, speakerSlug, meta) {
    var _a, _b;
    const nextState = Object.assign(Object.assign({}, input.sceneState), { beat: (_a = decision.beatLabel) !== null && _a !== void 0 ? _a : input.sceneState.beat, ambience: decision.ambience !== undefined
            ? decision.ambience
            : input.sceneState.ambience, lastSpeakerSlug: speakerSlug !== null && speakerSlug !== void 0 ? speakerSlug : input.sceneState.lastSpeakerSlug, turnIndex: input.sceneState.turnIndex + 1 });
    return {
        decision,
        sceneState: nextState,
        speakerSlug,
        events: [
            {
                type: eventTypeForAction(decision.action),
                source: "orchestration",
                payload: Object.assign(Object.assign({ sceneId: input.scene.id, action: decision.action, speakerSlug, previousSceneState: input.sceneState, nextSceneState: nextState, decision }, ((meta === null || meta === void 0 ? void 0 : meta.degraded) ? { degraded: meta.degraded } : {})), ((meta === null || meta === void 0 ? void 0 : meta.reason) ? { reason: meta.reason } : {})),
            },
        ],
        degraded: (_b = meta === null || meta === void 0 ? void 0 : meta.degraded) !== null && _b !== void 0 ? _b : false,
        reason: meta === null || meta === void 0 ? void 0 : meta.reason,
    };
}
function fallbackResolution(input, reason) {
    const fallback = defaultSceneDecision(input.scene, input.sceneState);
    return applyDecision(input, fallback, null, { degraded: true, reason });
}
function eventTypeForAction(action) {
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
function buildOrchestratorSystemPrompt(scene, state, sceneMemory) {
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
function buildOrchestratorUserPrompt(recentTurns, lastUserMessage) {
    var _a;
    const lines = [];
    if (recentTurns.length === 0) {
        lines.push("(no dialogue yet - open the scene)");
    }
    else {
        lines.push("Recent dialogue:");
        for (const turn of recentTurns) {
            const who = (_a = turn.speakerName) !== null && _a !== void 0 ? _a : turn.speakerSlug;
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
function sanitizeSceneMemory(memory) {
    return memory
        .map((entry) => (typeof entry === "string" ? truncateMemoryEntry(entry) : ""))
        .filter(Boolean)
        .slice(-SCENE_MEMORY_LIMIT);
}
function compactWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function truncateMemoryEntry(value) {
    const compact = compactWhitespace(value);
    if (compact.length <= SCENE_MEMORY_ENTRY_MAX_CHARS)
        return compact;
    return `${compact.slice(0, SCENE_MEMORY_ENTRY_MAX_CHARS - 3).trimEnd()}...`;
}
export { getScene, listScenes } from "./scenes";
