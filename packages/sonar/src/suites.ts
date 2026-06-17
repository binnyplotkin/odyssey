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
  // 1.1.0: sessions 3 → 8. Turns are unchanged, so the same lines stay
  // comparable; the bump just makes the headline percentiles trustworthy.
  // 8 × 5 = 40 voice-to-voice samples crosses the harness's own ≥30 "high
  // confidence" band, so p95/p99/SLO% are stable enough to call a ±200ms A/B.
  version: "1.1.0",
  description:
    "Single-character voice-to-voice: spoken input → STT → /voice-stream → agent audio. Headline: voice-to-voice.",
  character: "abraham",
  mode: "voice-stream",
  userVoice: "ash",
  sessions: 8,
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
 * Agency suite — turn-level conversation control inside the world simulation
 * loop. This exercises whether the harness can recover from corrections,
 * engage a low-information user, choose a useful next turn, and keep world
 * state moving. It does NOT yet test true barge-in / mid-agent interruption;
 * that needs an overlapping-audio runner rather than the current sequential
 * turn runner.
 */
export const AGENCY_BASELINE: SonarSuite = {
  name: "agency-baseline",
  version: "0.1.0",
  description:
    "World-simulation agency: correction handling, engagement, initiative, repair, and scene drive under the scene loop.",
  character: "abraham",
  mode: "scene",
  userVoice: "ash",
  sessions: 2,
  settleMs: 400,
  turns: [
    "Before Abraham answers, set the scene for me in one sentence.",
    "Actually, pause. I am confused about who is here with us.",
    "I do not really know what to ask next.",
    "Wait, not a lecture. Help me choose what to ask Sarah.",
    "Something about this place feels tense. What changes in the scene now?",
  ],
};

/**
 * Context Activation suite — gold-labeled retrieval/curation benchmark for
 * the knowledge graph path. This suite asks direct, ambiguous, negative, and
 * drift-prone prompts so the scorer can compute page recall/precision from
 * selected page slugs emitted in the server trace.
 */
export const CONTEXT_ACTIVATION_BASELINE: SonarSuite = {
  name: "context-activation-baseline",
  version: "0.1.0",
  description:
    "Gold-labeled knowledge graph activation: retrieval recall/precision, curator selectivity, cache reuse, token budget, and context injection latency.",
  character: "abraham",
  mode: "voice-stream",
  userVoice: "ash",
  sessions: 1,
  settleMs: 400,
  turns: [
    "Tell me about the visitors who came to your tent at Mamre.",
    "When I say Sarah laughed, what promise am I referring to?",
    "What did you leave behind in Ur and Haran?",
    "What happened in Egypt when fear overtook you?",
    "Do not talk about the binding yet. Keep this to the visitors and hospitality.",
    "Now connect the promise of Isaac to Sarah's barrenness without drifting into later events.",
  ],
  contextActivation: {
    version: "0.1.0",
    turns: [
      {
        expectedPageSlugs: ["three-visitors-at-mamre", "hospitality-and-kindness", "sarah"],
        note: "Direct Mamre query should activate the visitors scene and hospitality context.",
      },
      {
        expectedPageSlugs: ["sarah", "sarai", "barrenness", "birth-of-isaac", "great-nation-promise", "three-visitors-at-mamre"],
        mustNotInjectPageSlugs: ["death-of-sarah", "purchase-of-machpelah"],
        note: "Ambiguous laughter should resolve to Sarah, barrenness, promise, and Isaac context.",
      },
      {
        expectedPageSlugs: ["ur-of-the-chaldees", "departure-from-ur", "the-call-at-haran", "haran-city", "terah"],
        mustNotInjectPageSlugs: ["descent-into-egypt", "binding-of-isaac"],
        note: "Origin query should focus on Ur/Haran and avoid later Egypt or binding pages.",
      },
      {
        expectedPageSlugs: ["descent-into-egypt", "egypt", "pharaoh", "fear-and-deception", "sarah", "sarai"],
        note: "Egypt fear query should activate the Egypt event, place, Pharaoh, and Sarai/Sarah.",
      },
      {
        expectedPageSlugs: ["three-visitors-at-mamre", "hospitality-and-kindness"],
        mustNotInjectPageSlugs: ["binding-of-isaac", "moriah", "isaac"],
        note: "Negative instruction should keep the curator away from binding/Moriah context.",
      },
      {
        expectedPageSlugs: ["sarah", "sarai", "barrenness", "birth-of-isaac", "great-nation-promise"],
        mustNotInjectPageSlugs: ["binding-of-isaac", "death-of-sarah", "eliezers-mission-for-isaac"],
        note: "Promise follow-up should connect Isaac and barrenness without later-event drift.",
      },
    ],
  },
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
  [AGENCY_BASELINE.name]: AGENCY_BASELINE,
  [CONTEXT_ACTIVATION_BASELINE.name]: CONTEXT_ACTIVATION_BASELINE,
  [ENDPOINTING.name]: ENDPOINTING,
  [REAL_ENDPOINTING.name]: REAL_ENDPOINTING,
};
