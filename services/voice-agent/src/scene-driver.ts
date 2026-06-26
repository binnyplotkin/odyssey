import { getCharacterStore, getSceneStore, type CharacterRecord } from "@odyssey/db";
import {
  buildSceneDecisionRequest,
  buildSpeakerTurnRequest,
  createInitialSceneState,
  defaultSceneDecision,
  getScene,
  resolveOrchestratorExecutor,
  resolveSceneDecision,
  updateSceneMemory,
  type SceneTurnForPlanning,
} from "@odyssey/orchestration";
import type { OrchestratorDecision, Scene, SceneState } from "@odyssey/types";

const RECENT_TURNS_LIMIT = 6;
/** Don't speculate off a stray opener ("uh", "so") — wait for some real intent. */
const MIN_SPECULATE_CHARS = 8;
/** Accept a speculation only if it was computed off ≥ this fraction of the final
 *  turn (and is a prefix of it) — so the speaker was chosen from ~the whole intent,
 *  not a short lead-in that happens to prefix-match. */
const SPECULATION_COVERAGE = 0.6;

/** Lowercase, collapse whitespace, drop trailing punctuation — for prefix matching
 *  a speculated partial against the final transcript. */
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+$/g, "")
    .trim();
}

/** What the worker's `speak()` needs to voice one character's turn; resolves to the
 *  generated reply text (fed back into the scene's running transcript). */
export interface SceneSpeakInput {
  characterId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /** Orchestrator direction for this turn (sceneCue + beat). Omitted when there's
   *  nothing to inject (e.g. a sandbox solo turn before a director cue exists). */
  promptChunk?: string;
  /** Who's speaking — surfaced to the client so it can label the turn. */
  speaker: { slug: string; name: string };
}
export type SceneSpeakFn = (input: SceneSpeakInput, replyId: string) => Promise<string>;

/**
 * Drives a multi-character SCENE over a LiveKit room. Each user turn it asks the
 * orchestrator who speaks next — IN-PROCESS (no HTTP hop): fastpath when the roster
 * is solo, Cerebras/Groq when it's a real choice — resolves that character, and
 * hands the worker a turn to voice via `runVoiceStream`. Holds the live SceneState +
 * running transcript in memory (B1: the loop doesn't persist to the DB yet).
 *
 * The single-character voice cell is the degenerate case of this (1-char fastpath);
 * a "world" is just a scene with a bigger roster.
 */
export class SceneDriver {
  readonly scene: Scene;
  #sceneState: SceneState;
  #recentTurns: SceneTurnForPlanning[] = [];
  #sceneMemory: string[] = [];
  // B4: the in-flight speculative decision (orchestrated off a partial transcript
  // during the endpoint hold) + the text it was computed from, so drive() can
  // accept it when the final transcript matches and skip the orchestrate latency.
  #speculation: { basedOnText: string; promise: Promise<OrchestratorDecision> } | null = null;

  private constructor(scene: Scene) {
    this.scene = scene;
    this.#sceneState = createInitialSceneState(scene);
  }

  /** Resolve a scene id — hardcoded registry first, then the DB graph→roster bridge. */
  static async load(sceneId: string): Promise<SceneDriver | null> {
    const scene =
      getScene(sceneId) ??
      (await getSceneStore()
        .resolveOrchestratorScene(sceneId)
        .catch(() => null));
    return scene ? new SceneDriver(scene) : null;
  }

  /** Synthesize a one-actor scene for a `character-sandbox:<slug>` room, so the
   *  single-character cell runs through the SAME driver as a multi-character scene
   *  (it's just the 1-char fastpath). The character's voice + brain are resolved by
   *  runVoiceStream from the id at speak time, so the scene `voice` field here is
   *  only a non-empty placeholder. */
  static fromCharacter(character: CharacterRecord): SceneDriver {
    const slug = character.slug;
    const blurb = (character.summary ?? character.title).slice(0, 280);
    const scene: Scene = {
      id: `character-sandbox:${slug}`,
      title: character.title,
      description: (character.summary ?? character.title).slice(0, 600),
      characters: [
        {
          characterSlug: slug,
          displayName: character.title,
          voice: character.voiceId ?? slug,
          blurb,
        },
      ],
      openingBeat: "The user has just arrived.",
      defaultAmbience: null,
    };
    return new SceneDriver(scene);
  }

  /** Seed the running transcript with an opening character line (e.g. the greet)
   *  that had no preceding user turn — so the next turn's history includes it,
   *  WITHOUT recording the director instruction that prompted it as a user turn. */
  recordOpening(reply: string): void {
    const solo = this.#presentRoster()[0];
    if (!solo || !reply) return;
    this.#recentTurns.push({ speakerSlug: solo, text: reply });
    this.#trim();
  }

  /**
   * B4: speculatively orchestrate off a partial transcript DURING the endpoint hold,
   * so the speaker is usually already chosen when the turn completes. Fire-and-forget
   * — drive() decides whether to accept it. No-op for a solo roster (the fastpath has
   * no orchestrate latency to hide) or for a partial we're already speculating on.
   */
  speculate(partialText: string): void {
    const text = partialText.trim();
    if (text.length < MIN_SPECULATE_CHARS) return;
    if (this.#presentRoster().length <= 1) return;
    if (this.#speculation?.basedOnText === text) return;
    this.#speculation = { basedOnText: text, promise: this.#decide(text, "speculate") };
  }

  /** One finished user turn → orchestrate → voice the chosen character (if any). */
  async drive(userText: string, speak: SceneSpeakFn): Promise<void> {
    const spec = this.#speculation;
    this.#speculation = null;

    this.#recentTurns.push({ speakerSlug: "user", text: userText });
    this.#trim();
    this.#sceneMemory = updateSceneMemory({
      previousMemory: this.#sceneMemory,
      recentTurns: this.#recentTurns,
    });

    // Use the speculation if it was computed off ~the same intent as the final turn;
    // its orchestrate ran under the hold, so the await is usually instant (the gap is
    // hidden). Otherwise pay the orchestrate on the final transcript.
    let rawDecision: OrchestratorDecision;
    if (spec && this.#acceptsSpeculation(spec.basedOnText, userText)) {
      const waitedAt = Date.now();
      rawDecision = await spec.promise;
      console.log(
        `[voice-agent] speculative HIT (waited ${Date.now() - waitedAt}ms) → ${rawDecision.action} ${rawDecision.speakerId ?? ""}`.trimEnd(),
      );
    } else {
      if (spec) {
        spec.promise.catch(() => undefined); // discard the stale in-flight speculation
        console.log("[voice-agent] speculative MISS — orchestrating on final transcript");
      }
      rawDecision = await this.#decide(userText);
    }
    const resolution = resolveSceneDecision(
      { scene: this.scene, sceneState: this.#sceneState },
      rawDecision,
    );
    this.#sceneState = resolution.sceneState;

    if (resolution.decision.action !== "speak" || !resolution.speakerSlug) {
      console.log(`[voice-agent] scene: ${resolution.decision.action} (no speaker)`);
      return;
    }

    const character =
      (await getCharacterStore().getBySlug(resolution.speakerSlug).catch(() => null)) ??
      (await getCharacterStore().getById(resolution.speakerSlug).catch(() => null));
    if (!character) {
      console.warn(
        `[voice-agent] scene: speaker "${resolution.speakerSlug}" did not resolve — skipping turn`,
      );
      return;
    }

    const turn = buildSpeakerTurnRequest({
      scene: this.scene,
      sceneState: this.#sceneState,
      decision: resolution.decision,
      recentTurns: this.#recentTurns,
    });
    if (!turn) return;

    const displayName =
      this.scene.characters.find((c) => c.characterSlug === resolution.speakerSlug)?.displayName ??
      character.title ??
      resolution.speakerSlug;

    console.log(`[voice-agent] scene: ${resolution.speakerSlug} speaks`);
    // Sandbox solo with no director direction → don't inject a stale "Direction: …"
    // line (preserves the pre-unification single-char floor, which sent no
    // promptChunk). Once the orchestrator supplies a per-turn `beat`/`sceneCue`
    // (Phase 3), it flows through to the character unchanged.
    const sandboxNoCue =
      this.scene.id.startsWith("character-sandbox:") &&
      !resolution.decision.beat &&
      !resolution.decision.sceneCue;
    const replyText = await speak(
      {
        characterId: character.id,
        message: turn.message,
        history: turn.history,
        promptChunk: sandboxNoCue ? undefined : turn.promptChunk,
        speaker: { slug: resolution.speakerSlug, name: displayName },
      },
      `s${Date.now()}`,
    );
    this.#recentTurns.push({ speakerSlug: resolution.speakerSlug, text: replyText });
    this.#trim();
  }

  /** Slugs in the roster that are currently present — a real choice needs ≥ 2. */
  #presentRoster(): string[] {
    return this.#sceneState.presentCharacterSlugs.filter((slug) =>
      this.scene.characters.some((c) => c.characterSlug === slug),
    );
  }

  /** Accept a speculation only when its text is a prefix of the final turn AND
   *  covers most of it — so the speaker was chosen off ~the whole intent. */
  #acceptsSpeculation(basedOnText: string, finalText: string): boolean {
    const based = normalizeForMatch(basedOnText);
    const final = normalizeForMatch(finalText);
    if (!based || !final) return false;
    return final.startsWith(based) && based.length >= final.length * SPECULATION_COVERAGE;
  }

  /** Solo roster → fastpath (no LLM); otherwise the orchestrator LLM, timed so we
   *  can SEE the turn-driving cost (the gap B4 hides under the hold). The phase tag
   *  distinguishes a speculative pre-call (under the hold) from a final-turn call. */
  async #decide(userText: string, phase: "final" | "speculate" = "final"): Promise<OrchestratorDecision> {
    const present = this.#presentRoster();
    if (present.length <= 1) {
      const solo = present[0];
      return solo
        ? { action: "speak", speakerId: solo }
        : defaultSceneDecision(this.scene, this.#sceneState);
    }

    const request = buildSceneDecisionRequest({
      scene: this.scene,
      sceneState: this.#sceneState,
      recentTurns: this.#recentTurns,
      sceneMemory: this.#sceneMemory,
      lastUserMessage: userText,
    });
    const { executor } = resolveOrchestratorExecutor();
    if (!executor) return defaultSceneDecision(this.scene, this.#sceneState);

    const startedAt = Date.now();
    try {
      const decision = await executor.execute(request);
      console.log(
        `[voice-agent] orchestrate[${phase}] ${Date.now() - startedAt}ms → ${decision.action} ${decision.speakerId ?? ""}`.trimEnd(),
      );
      return decision;
    } catch (err) {
      console.error("[voice-agent] orchestrate failed", err);
      return defaultSceneDecision(this.scene, this.#sceneState);
    }
  }

  #trim(): void {
    const cap = RECENT_TURNS_LIMIT * 2;
    if (this.#recentTurns.length > cap) {
      this.#recentTurns = this.#recentTurns.slice(-cap);
    }
  }
}
