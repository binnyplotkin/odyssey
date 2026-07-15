/**
 * Refusal guard — keeps model-level safety refusals IN CHARACTER.
 *
 * gpt-oss-class brains occasionally fall out of persona under hostile input
 * and answer with trained assistant boilerplate ("I'm sorry, but I can't help
 * with that.") instead of the character's own authored deflection. The stream
 * loop checks the FIRST sentence of every reply against these patterns before
 * any TTS is dispatched; on a match it re-rolls the turn once with an explicit
 * in-character-deflection instruction. The SceneDriver's proactive loop uses
 * the same detector to avoid taking a follow-up turn off a refusal (the model
 * parrots whatever the last assistant line was).
 *
 * Patterns are deliberately NARROW: whole-sentence assistant boilerplate
 * only. In-world lines that merely contain "can't help" ("I cannot help you
 * carry that burden, friend") must not match — a false positive costs an
 * extra LLM round-trip and re-rolls a perfectly good reply.
 */

const REFUSAL_PATTERNS: RegExp[] = [
  // "I'm sorry, but I can't help with that." / "Sorry, I can't assist with that request."
  /^(?:i[’']?m sorry|i am sorry|sorry|i apologize)[,.]?\s*(?:but\s+)?i\s+(?:can[’']?t|cannot|won[’']?t|am unable to|am not able to)\s+(?:help|assist|comply|continue|engage|do that|answer that|provide that)(?:\s+with\s+(?:that|this)(?:\s+request)?)?[.!]?$/i,
  // "I can't help with that." / "I cannot assist with this request."
  /^i\s+(?:can[’']?t|cannot)\s+(?:help|assist|comply)(?:\s+with\s+(?:that|this)(?:\s+request)?)?[.!]?$/i,
  // "I'm unable to help with that." / "I won't be able to assist with this."
  /^i(?:[’']m| am)?\s+(?:unable|not able)\s+to\s+(?:help|assist|comply)(?:\s+with\s+(?:that|this)(?:\s+request)?)?[.!]?$/i,
  /^i\s+won[’']?t\s+be\s+able\s+to\s+(?:help|assist)(?:\s+with\s+(?:that|this)(?:\s+request)?)?[.!]?$/i,
];

// Self-identifying as an AI breaks persona at ANY sentence length, so it is
// checked separately from the short-boilerplate shapes above.
const AI_SELF_ID_PATTERN = /\bas an ai\b|\bi[’']?m an ai\b|\blanguage model\b|\bai assistant\b/i;

/** True when a sentence is bare assistant refusal boilerplate (persona break),
 *  as opposed to a character declining in their own voice. */
export function isRefusalBoilerplate(sentence: string): boolean {
  const trimmed = sentence.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (!trimmed) return false;
  if (AI_SELF_ID_PATTERN.test(trimmed)) return true;
  // Boilerplate refusals are short. A long first sentence is doing character
  // work even if it opens with an apology — never re-roll those.
  if (trimmed.length > 120) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Per-turn instruction appended on the re-roll after a detected persona
 *  break. Kept out of the cached envelope — it rides the per-turn part. */
export function inCharacterDeflectionInstruction(characterName: string): string {
  return [
    "<refusal-style>",
    `  Your previous draft broke character with assistant boilerplate. If you`,
    `  will not engage with what was said, decline AS ${characterName}: set the`,
    `  boundary in your own voice and idiom — brief, firm, human. Never use`,
    `  assistant phrases like "I'm sorry, but I can't help with that."`,
    "</refusal-style>",
  ].join("\n");
}
