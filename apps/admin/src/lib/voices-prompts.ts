/** Canonical audition prompt — the line every voice speaks on its
 * detail page's AuditionCard, and the line we send to provider TTS
 * APIs when generating cached previews.
 *
 * Why this sentence:
 *  - dynamic range is baked into the meaning ("quietly at first,
 *    then closer, until the windows shook") so the narrator naturally
 *    goes soft → loud, exposing voices that can't shift intensity
 *  - phoneme-diverse: /θ/ /r/ /l/ /v/ /k/ /w/ /n/ /s/ /ʃ/ + long
 *    vowels, short vowels, a diphthong
 *  - the em-dash + three escalating clauses test prosody — voices
 *    that flatten everything sound bad here
 *  - ~9s in most voices: long enough to judge, short enough that
 *    scanning the library doesn't feel like a slog
 *
 * Lives in its own module (rather than alongside the synth code in
 * `voices-preview.ts`) so client components can import it without
 * dragging the server-only `@odyssey/db` + storage deps into the
 * client bundle. */
export const DEFAULT_AUDITION_PROMPT =
  "The thunder rolled across the valley — quietly at first, then closer, until the windows shook.";
