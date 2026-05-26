import { ORCHESTRATOR_JSON_SCHEMA, type OrchestratorDecision, type Scene, type SceneState } from "@odyssey/types";
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
export type SceneEventDraftType = "scene.decision.speak" | "scene.decision.narrate" | "scene.decision.wait" | "scene.decision.end";
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
    history: Array<{
        role: "user" | "assistant";
        content: string;
    }>;
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
export declare function createInitialSceneState(scene: Scene): SceneState;
export declare function defaultSceneDecision(scene: Scene, state: SceneState): OrchestratorDecision;
export declare function buildSceneSessionSnapshot(sceneState: SceneState, options?: string | {
    updatedAt?: string;
    sceneMemory?: string[];
}): SceneSessionSnapshot;
export declare function readSceneStateFromSnapshot(value: unknown, sceneId: string): SceneState | null;
export declare function readSceneMemoryFromSnapshot(value: unknown, sceneId: string): string[];
export declare function updateSceneMemory(input: {
    previousMemory?: string[];
    recentTurns?: SceneTurnForPlanning[];
    maxEntries?: number;
}): string[];
export declare function buildSceneDecisionRequest(input: {
    scene: Scene;
    sceneState: SceneState;
    recentTurns?: SceneTurnForPlanning[];
    sceneMemory?: string[];
    lastUserMessage?: string;
}): SceneDecisionRequest;
export declare function resolveSceneDecision(input: {
    scene: Scene;
    sceneState: SceneState;
}, rawDecision: unknown): SceneDecisionResolution;
export declare function fallbackSceneDecisionResolution(input: {
    scene: Scene;
    sceneState: SceneState;
}, reason: string): SceneDecisionResolution;
export declare function buildSpeakerTurnRequest(input: {
    scene: Scene;
    sceneState: SceneState;
    decision: OrchestratorDecision;
    recentTurns: SceneTurnForPlanning[];
}): SpeakerTurnRequest | null;
export type { OrchestratorDecision, Scene, SceneState, };
export { getScene, listScenes } from "./scenes";
//# sourceMappingURL=client.d.ts.map