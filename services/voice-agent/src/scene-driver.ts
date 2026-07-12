import {
  getCharacterStore,
  getSceneStore,
  normalizeSoundDesign,
  soundDesignToSceneSounds,
  type CharacterRecord,
} from "@odyssey/db";
import {
  buildSceneDecisionRequest,
  buildSceneSessionSnapshot,
  buildSpeakerTurnRequest,
  createInitialSceneState,
  defaultSceneDecision,
  getScene,
  PROACTIVE_SILENCE_MARKER,
  resolveOrchestratorExecutor,
  resolveSceneDecision,
  updateSceneMemory,
  type SceneSessionSnapshot,
  type SceneTurnForPlanning,
} from "@odyssey/orchestration";
import type { OrchestratorDecision, Scene, SceneState, SfxCue } from "@odyssey/types";

const RECENT_TURNS_LIMIT = 6;
/** Don't speculate off a stray opener ("uh", "so") — wait for some real intent. */
const MIN_SPECULATE_CHARS = 8;
/** Accept a speculation only if it was computed off ≥ this fraction of the final
 *  turn (and is a prefix of it) — so the speaker was chosen from ~the whole intent,
 *  not a short lead-in that happens to prefix-match. */
const SPECULATION_COVERAGE = 0.6;

/** Solo scenes get a latency-hidden director cue (Phase 3). =0 restores the 0ms
 *  single-character fastpath with no per-turn direction. */
const SOLO_CUE_ENABLED = process.env.VOICE_AGENT_SOLO_CUE !== "0";
/** On a solo FINAL-turn speculation MISS, pay the orchestrator inline for the cue
 *  (default off → serve the no-cue floor, zero added hot-path latency). */
const SOLO_CUE_ON_MISS = process.env.VOICE_AGENT_SOLO_CUE_ON_MISS === "1";

/** What the character "sees" as the latest message on a proactive turn — a state,
 *  not a request, so they continue in-voice rather than answer a meta-instruction.
 *  The actual direction rides in the promptChunk (the orchestrator's beat). */
const PROACTIVE_TURN_MESSAGE = "(The user has gone quiet.)";

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

/** What a drive() turn resolved to — the orchestrator's action, and whether a
 *  character actually spoke (so the caller can arm a follow-up or stop). */
export type SceneDriveOutcome = {
  action: OrchestratorDecision["action"];
  spoke: boolean;
};

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
  // Optional persistence hook — invoked with a fresh snapshot after every decision.
  #onState: ((snapshot: SceneSessionSnapshot) => void) | null = null;
  #onSfx: ((cues: SfxCue[]) => void) | null = null;

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
    // sm-sound: the character's sandbox soundscape — the sound nodes placed
    // on the character canvas, mapped to the full director roster (beds +
    // one-shots) exactly like scene-placed audio nodes. character-store
    // normalizes legacy single-bed rows into `sounds`, so one shape here.
    // Scene-placed sounds win in real scenes structurally — fromCharacter
    // is only used when there IS no scene.
    const sounds = soundDesignToSceneSounds(character.soundDesign);
    // isDefault lives on the character entries, not the mapped roster.
    const entries = normalizeSoundDesign(character.soundDesign)?.sounds ?? [];
    const defaultBed =
      entries.find((s) => s.role === "bed" && s.isDefault) ??
      entries.find((s) => s.role === "bed") ??
      null;
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
      defaultAmbience: defaultBed?.slug ?? null,
      ...(sounds.length > 0 ? { sounds } : {}),
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

  /** Wire a callback invoked with a fresh scene snapshot after every decision, so the
   *  caller can persist it (fire-and-forget). Optional — unset = in-memory only. */
  onState(cb: (snapshot: SceneSessionSnapshot) => void): void {
    this.#onState = cb;
  }

  /** Wire a callback invoked with the decision's (roster-validated) sfx cues,
   *  fired BEFORE the speaker's turn so `at:"now"` cues truly precede the voice.
   *  Optional — unset = sfx decisions are ignored (e.g. non-LiveKit hosts). */
  onSfx(cb: (cues: SfxCue[]) => void): void {
    this.#onSfx = cb;
  }

  #emitSfx(cues: SfxCue[] | undefined): void {
    if (!this.#onSfx || !cues?.length) return;
    try {
      this.#onSfx(cues);
    } catch {
      // best-effort — audio must never disrupt the turn
    }
  }

  #persistState(): void {
    if (!this.#onState) return;
    try {
      this.#onState(
        buildSceneSessionSnapshot(this.#sceneState, { sceneMemory: this.#sceneMemory }),
      );
    } catch {
      // best-effort — persistence must never disrupt the turn
    }
  }

  /**
   * B4: speculatively orchestrate off a partial transcript DURING the endpoint hold,
   * so the decision (speaker + director `beat`) is usually ready when the turn
   * completes. Fire-and-forget — drive() decides whether to accept it. Solo scenes
   * speculate too (to fetch a latency-hidden director cue) unless the solo cue is
   * disabled; no-op for a partial we're already speculating on.
   */
  speculate(partialText: string): void {
    const text = partialText.trim();
    if (text.length < MIN_SPECULATE_CHARS) return;
    if (!SOLO_CUE_ENABLED && this.#presentRoster().length <= 1) return;
    if (this.#speculation?.basedOnText === text) return;
    this.#speculation = { basedOnText: text, promise: this.#decide(text, "speculate") };
  }

  /** One finished user turn → orchestrate → voice the chosen character (if any). */
  async drive(userText: string, speak: SceneSpeakFn): Promise<SceneDriveOutcome> {
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
    this.#persistState();
    this.#emitSfx(resolution.decision.sfx);

    if (resolution.decision.action !== "speak" || !resolution.speakerSlug) {
      console.log(`[voice-agent] scene: ${resolution.decision.action} (no speaker)`);
      return { action: resolution.decision.action, spoke: false };
    }

    const character =
      (await getCharacterStore().getBySlug(resolution.speakerSlug).catch(() => null)) ??
      (await getCharacterStore().getById(resolution.speakerSlug).catch(() => null));
    if (!character) {
      console.warn(
        `[voice-agent] scene: speaker "${resolution.speakerSlug}" did not resolve — skipping turn`,
      );
      return { action: "speak", spoke: false };
    }

    const turn = buildSpeakerTurnRequest({
      scene: this.scene,
      sceneState: this.#sceneState,
      decision: resolution.decision,
      recentTurns: this.#recentTurns,
    });
    if (!turn) return { action: "speak", spoke: false };

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
    return { action: "speak", spoke: true };
  }

  /**
   * Proactive director turn — fired with NO user utterance (a silence tick). The
   * director decides whether the scene advances (a character follows up / re-engages
   * / presses) or holds (`wait-for-user`). Latency is invisible — nobody is waiting.
   * The silence is NOT recorded as a user turn. Returns true iff a character spoke.
   */
  async driveProactive(speak: SceneSpeakFn): Promise<boolean> {
    const decision = await this.#decide(PROACTIVE_SILENCE_MARKER, "proactive");
    const resolution = resolveSceneDecision(
      { scene: this.scene, sceneState: this.#sceneState },
      decision,
    );
    this.#sceneState = resolution.sceneState;
    this.#persistState();
    this.#emitSfx(resolution.decision.sfx);

    if (resolution.decision.action !== "speak" || !resolution.speakerSlug) {
      console.log(`[voice-agent] proactive: ${resolution.decision.action} (hold)`);
      return false;
    }

    const character =
      (await getCharacterStore().getBySlug(resolution.speakerSlug).catch(() => null)) ??
      (await getCharacterStore().getById(resolution.speakerSlug).catch(() => null));
    if (!character) {
      console.warn(`[voice-agent] proactive: speaker "${resolution.speakerSlug}" did not resolve`);
      return false;
    }
    const displayName =
      this.scene.characters.find((c) => c.characterSlug === resolution.speakerSlug)?.displayName ??
      character.title ??
      resolution.speakerSlug;

    const beat = resolution.decision.beat ?? this.#sceneState.beat;
    const hasCue = Boolean(resolution.decision.beat || resolution.decision.sceneCue);
    const directive = resolution.decision.sceneCue
      ? `Direction: ${beat}\nScene note: ${resolution.decision.sceneCue}`
      : `Direction: ${beat}`;
    const history = this.#recentTurns.slice(-RECENT_TURNS_LIMIT).map((turn) => ({
      role: turn.speakerSlug === resolution.speakerSlug ? ("assistant" as const) : ("user" as const),
      content: turn.text,
    }));

    console.log(`[voice-agent] proactive: ${resolution.speakerSlug} follows up`);
    const replyText = await speak(
      {
        characterId: character.id,
        message: PROACTIVE_TURN_MESSAGE,
        history,
        promptChunk: hasCue ? directive : undefined,
        speaker: { slug: resolution.speakerSlug, name: displayName },
      },
      `p${Date.now()}`,
    );
    if (replyText) {
      this.#recentTurns.push({ speakerSlug: resolution.speakerSlug, text: replyText });
      this.#trim();
    }
    return true;
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

  /** Ask the orchestrator who speaks + the director `beat`. A solo roster used to
   *  fastpath with no LLM (0ms, no direction); now it also fetches a director cue,
   *  but only when it's worth it — disabled entirely if SOLO_CUE is off, and on the
   *  hot path (final) skipped unless a HIT was speculated under the hold (drive()) or
   *  SOLO_CUE_ON_MISS forces an inline call. The phase tag distinguishes a speculative
   *  pre-call (under the hold) from a final-turn call. */
  async #decide(
    userText: string,
    phase: "final" | "speculate" | "proactive" = "final",
  ): Promise<OrchestratorDecision> {
    const present = this.#presentRoster();
    const solo = present.length <= 1 ? (present[0] ?? null) : null;
    const soloFloor: OrchestratorDecision | null =
      present.length === 0
        ? defaultSceneDecision(this.scene, this.#sceneState)
        : solo
          ? { action: "speak", speakerId: solo }
          : null;

    const { executor } = resolveOrchestratorExecutor();
    if (!executor) return soloFloor ?? defaultSceneDecision(this.scene, this.#sceneState);

    // Solo → the lone character carries the turn. Reactive solo skips the LLM on the
    // hot path (the cue rides a speculative HIT) unless opted in. Proactive solo
    // ALWAYS calls it — no user is waiting, so latency is invisible and the director
    // gets to choose advance-or-hold.
    if (solo) {
      if (phase === "speculate" && !SOLO_CUE_ENABLED) return soloFloor!;
      if (phase === "final" && (!SOLO_CUE_ENABLED || !SOLO_CUE_ON_MISS)) return soloFloor!;
    }

    const request = buildSceneDecisionRequest({
      scene: this.scene,
      sceneState: this.#sceneState,
      recentTurns: this.#recentTurns,
      sceneMemory: this.#sceneMemory,
      lastUserMessage: userText,
    });

    const startedAt = Date.now();
    try {
      const decision = await executor.execute(request);
      console.log(
        `[voice-agent] orchestrate[${phase}] ${Date.now() - startedAt}ms → ${decision.action} ${decision.speakerId ?? ""}`.trimEnd(),
      );
      // Reactive solo: pin the speaker (the user addressed them). Proactive solo:
      // respect a `wait-for-user` decision — that's the silence/monologue brake.
      return solo && phase !== "proactive"
        ? { ...decision, action: "speak", speakerId: solo }
        : decision;
    } catch (err) {
      console.error("[voice-agent] orchestrate failed", err);
      return soloFloor ?? defaultSceneDecision(this.scene, this.#sceneState);
    }
  }

  #trim(): void {
    const cap = RECENT_TURNS_LIMIT * 2;
    if (this.#recentTurns.length > cap) {
      this.#recentTurns = this.#recentTurns.slice(-cap);
    }
  }
}
