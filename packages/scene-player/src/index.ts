// @odyssey/scene-player — reusable live scene player.
//
// The multi-character orchestration loop (useScenePlayer), the audio
// primitives (SceneAudioBus for multi-track scene playback, PcmPlayer for
// serial single-stream playback), and their supporting types. Consumed by
// the admin scenes sandbox + character sandbox today; designed to be
// embeddable in other apps (e.g. the public web player) later.

export { useScenePlayer } from "./use-scene-player";
export type {
  SceneTurn,
  ScenePhase,
  SceneRunnerTrace,
  UseSceneRunnerOptions,
  UseSceneRunnerResult,
  TracePayload,
  TraceContract,
} from "./use-scene-player";

export { SceneAudioBus } from "./scene-audio-bus";
export type { SceneAudioMetrics } from "./scene-audio-bus";
export {
  PcmPlayer,
  base64ToBytes,
  createAudioContext,
} from "./pcm-player";
