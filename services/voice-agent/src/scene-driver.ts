import { getCharacterStore, getSceneStore } from "@odyssey/db";
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

/** What the worker's `speak()` needs to voice one character's turn; resolves to the
 *  generated reply text (fed back into the scene's running transcript). */
export interface SceneSpeakInput {
  characterId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  promptChunk: string;
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

  /** One finished user turn → orchestrate → voice the chosen character (if any). */
  async drive(userText: string, speak: SceneSpeakFn): Promise<void> {
    this.#recentTurns.push({ speakerSlug: "user", text: userText });
    this.#trim();
    this.#sceneMemory = updateSceneMemory({
      previousMemory: this.#sceneMemory,
      recentTurns: this.#recentTurns,
    });

    const rawDecision = await this.#decide(userText);
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

    console.log(`[voice-agent] scene: ${resolution.speakerSlug} speaks`);
    const replyText = await speak(
      {
        characterId: character.id,
        message: turn.message,
        history: turn.history,
        promptChunk: turn.promptChunk,
      },
      `s${Date.now()}`,
    );
    this.#recentTurns.push({ speakerSlug: resolution.speakerSlug, text: replyText });
    this.#trim();
  }

  /** Solo roster → fastpath (no LLM); otherwise the orchestrator LLM, timed so we
   *  can SEE the turn-driving cost (the gap we may later hide under the hold). */
  async #decide(userText: string): Promise<OrchestratorDecision> {
    const present = this.#sceneState.presentCharacterSlugs.filter((slug) =>
      this.scene.characters.some((c) => c.characterSlug === slug),
    );
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
        `[voice-agent] orchestrate ${Date.now() - startedAt}ms → ${decision.action} ${decision.speakerId ?? ""}`.trimEnd(),
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
