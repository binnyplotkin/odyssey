/**
 * Built-in Sonar suites. A suite is a scripted spoken conversation: each
 * turn string is what the user *says*, synthesized once into a spoken-audio
 * fixture and streamed into STT — turns start from audio, never text.
 * Editing a suite's lines or session count bumps its version (results stop
 * being comparable across suite versions).
 *
 * Lines deliberately walk the context engine's paths: greeting (retrieval
 * skip-gate) → lore question (fresh retrieval + curator) → pronoun
 * follow-up (summary-enriched embedding, warm context cache) → long-form →
 * topic shift (cache-busting fresh retrieval). Kept short and clearly
 * articulated so synthetic TTS input transcribes cleanly.
 */

import type { SonarSuite } from "./types";

export const VOICE_BASELINE: SonarSuite = {
  name: "voice-baseline",
  version: "1.0.0",
  description:
    "Single-character voice-to-voice: spoken input → STT → /voice-stream → agent audio. Headline: voice-to-voice.",
  character: "abraham",
  mode: "voice-stream",
  userVoice: "ash",
  sessions: 3,
  turns: [
    "Peace be with you, friend.",
    "Tell me about the visitors who came to your tent at Mamre.",
    "And what did Sarah make of their promise?",
    "You have traveled far in your life. Which journey tested you most?",
    "What do you remember of Egypt?",
  ],
};

export const SCENE_BASELINE: SonarSuite = {
  name: "scene-baseline",
  version: "1.0.0",
  description:
    "Full scene loop voice-to-voice: spoken input → STT → /orchestrate → /voice-stream → agent audio.",
  character: "abraham",
  mode: "scene",
  userVoice: "ash",
  sessions: 2,
  turns: [
    "Peace be with you. May I sit by your fire?",
    "Tell me of the three visitors and the promise they carried.",
    "Did you ever doubt it would come to pass?",
    "What would you say to one who waits on a promise of their own?",
  ],
};

export const SUITES: Record<string, SonarSuite> = {
  [VOICE_BASELINE.name]: VOICE_BASELINE,
  [SCENE_BASELINE.name]: SCENE_BASELINE,
};
