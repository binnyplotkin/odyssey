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

/**
 * Endpointing suite — STT-only, no LLM/TTS. Mixes complete utterances
 * (measure endpoint latency) with pause-aware ones (measure premature
 * cutoff). A good endpointer is fast on complete AND keeps paused
 * utterances whole — the two axes the semantic-endpointing work must move
 * together. Against the current fixed-silence audio-rt, the paused
 * fixtures should cut (~100% cutoff) — that's the baseline the spike beats.
 *
 * Paused fixtures use a >800ms gap so the current 800ms VAD window actually
 * fires mid-utterance; the second half completes the thought.
 */
export const ENDPOINTING: SonarSuite = {
  name: "endpointing",
  version: "1.0.0",
  description:
    "STT-only: endpoint latency on complete utterances + premature-cutoff rate on mid-sentence pauses.",
  character: "abraham",
  mode: "voice-stream",
  sttOnly: true,
  userVoice: "ash",
  sessions: 2,
  turns: [
    // Complete — should stay whole (finals=1), measure endpoint latency.
    "Tell me about the visitors at Mamre.",
    "What did Sarah make of their promise?",
    // Paused — a fixed-silence endpointer cuts these at the gap (finals=2).
    { parts: ["Tell me about", "the visitors who came to your tent at Mamre."], gapMs: 1000 },
    { parts: ["I was wondering", "what you remember of your journey from Ur."], gapMs: 1100 },
    { parts: ["And Sarah —", "did she ever doubt the promise would come to pass?"], gapMs: 1000 },
  ],
};

/**
 * Endpointing on REAL recorded audio — the fair cutoff eval. Synthetic TTS
 * pauses understate the cutoff benefit (clip fragments carry falsely-complete
 * falling intonation; a real mid-sentence pause keeps rising/continuing
 * prosody). Record each clip naturally, drop the WAVs in
 * evals/sonar/recordings/<name>.wav, then run. `sonar recordings --suite
 * real-endpointing` lists exactly what to record and what's still missing.
 *
 * Record the "pause-*" clips with a genuine mid-sentence hesitation (think
 * mid-thought, don't let your pitch fall as if finishing) — that's the case
 * a fixed-silence endpointer cuts and a semantic one should hold.
 */
export const REAL_ENDPOINTING: SonarSuite = {
  name: "real-endpointing",
  version: "1.0.0",
  description:
    "Endpointing on REAL recordings (evals/sonar/recordings/). The fair cutoff eval vs synthetic pauses.",
  character: "abraham",
  mode: "voice-stream",
  sttOnly: true,
  sessions: 1, // recordings are deterministic through STT — one pass is enough
  turns: [
    { recording: "complete-01", kind: "complete", script: "Tell me about the visitors at Mamre." },
    { recording: "complete-02", kind: "complete", script: "What did Sarah make of their promise?" },
    { recording: "complete-03", kind: "complete", script: "Peace be with you, friend." },
    { recording: "pause-01", kind: "paused", script: "Tell me about … <1s> … the visitors who came to your tent at Mamre." },
    { recording: "pause-02", kind: "paused", script: "I was wondering … <1s> … what you remember of your journey from Ur." },
    { recording: "pause-03", kind: "paused", script: "And Sarah — … <1s> … did she ever doubt the promise would come to pass?" },
    { recording: "pause-04", kind: "paused", script: "Hmm … <1s> … let me think about how to ask this." },
    { recording: "pause-05", kind: "paused", script: "So when you … <1.5s> … when you left Haran, were you afraid?" },
    { recording: "pause-06", kind: "paused", script: "The thing is … <1.5s> … I don't really know where to begin." },
  ],
};

export const SUITES: Record<string, SonarSuite> = {
  [VOICE_BASELINE.name]: VOICE_BASELINE,
  [SCENE_BASELINE.name]: SCENE_BASELINE,
  [ENDPOINTING.name]: ENDPOINTING,
  [REAL_ENDPOINTING.name]: REAL_ENDPOINTING,
};
