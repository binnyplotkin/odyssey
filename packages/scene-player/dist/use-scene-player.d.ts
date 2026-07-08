import type { OrchestratorDecision, Scene, SceneState } from "@odyssey/types";
export type TracePayload = Record<string, unknown>;
export type TraceContract = Record<string, unknown>;
/**
 * Scene runner — owns the orchestration loop for a multi-character scene.
 *
 * Phase 1 design choices:
 *  - Scene state lives in this hook during a run and is mirrored into
 *    scene_sessions.current_scene by the orchestrate route.
 *  - Voice playback is gapless via SceneAudioBus's per-frame scheduling.
 *  - Barge-in: caller invokes sendUserMessage(); we stop voice, push the
 *    user's turn, and re-enter the loop with their message as a bias.
 *  - User input source is caller-owned (mic STT, text input, whatever)
 *    — the runner only cares about strings arriving via sendUserMessage.
 *
 * Still additive: resume hydration, concurrent speakers, SFX.
 */
export type SceneTurn = {
    id?: string;
    speakerSlug: string;
    speakerName?: string;
    text: string;
};
export type ScenePhase = "idle" | "deciding" | "speaking" | "narrating" | "waiting-for-user" | "error";
export type SceneRunnerTrace = {
    id: string;
    kind: "orchestrator" | "voice";
    at: string;
    trace: TracePayload;
    meta: {
        sessionId: string;
        sceneId?: string;
        turnId?: string;
        action?: OrchestratorDecision["action"];
        speakerSlug?: string | null;
        provider?: string | null;
        model?: string | null;
        degraded?: boolean;
        reason?: string | null;
        firstAudioMs?: number | null;
        totalMs?: number | null;
    };
};
export type UseSceneRunnerOptions = {
    scene: Scene;
    sessionId: string;
    generateTurnId?: () => string;
};
export type UseSceneRunnerResult = {
    phase: ScenePhase;
    sceneState: SceneState;
    turns: SceneTurn[];
    traces: SceneRunnerTrace[];
    latestTrace: SceneRunnerTrace | null;
    currentSpeakerSlug: string | null;
    error: string | null;
    start: () => Promise<void>;
    sendUserMessage: (text: string, options?: {
        turnId?: string;
    }) => Promise<void>;
    stop: () => void;
};
export declare function useScenePlayer(opts: UseSceneRunnerOptions): UseSceneRunnerResult;
//# sourceMappingURL=use-scene-player.d.ts.map