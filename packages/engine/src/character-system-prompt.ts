import type {
  CharacterDirective,
  CharacterIdentity,
  CharacterVoiceStyle,
} from "@odyssey/db";
import { compileDirectiveXml } from "./directive-xml";
import { compileIdentityXml } from "./identity-xml";
import { compileVoiceXml } from "./voice-xml";

/**
 * The wrapper that sits above the curator's chunk in every chat/voice turn.
 * Shared between the live chat route and the preview endpoint so the system
 * prompt the user sees in the test-chat "Prompt" tab is byte-identical to
 * what the model actually receives.
 *
 * Two paths:
 *   1. LEGACY — when no L02 Directive is authored. Emits the original
 *      single-paragraph template. Back-compat for every character that
 *      existed before L02 went live.
 *   2. DIRECTIVE — when the character has an L02 Directive. Emits the
 *      Frontier Playbook XML envelope (`<scope>`, `<exemplars>`,
 *      `<never>`, `<framing>`, `<guidance>`) preceded by a brief
 *      first-person identity sentence. The curator chunk is appended
 *      after the envelope under a `<context>` tag.
 */
export function buildSystemPrompt(
  characterName: string,
  curatorChunk: string,
  directive?: CharacterDirective | null,
  identity?: CharacterIdentity | null,
  voiceStyle?: CharacterVoiceStyle | null,
): string {
  const parts = buildSystemPromptParts(characterName, curatorChunk, directive, identity, voiceStyle);
  return [parts.cached, parts.perTurn].filter(Boolean).join("\n\n");
}

/**
 * The same compiled prompt as `buildSystemPrompt`, but split into two
 * pieces so the chat route can pass them to Anthropic as separate `system`
 * blocks — putting `cache_control: { type: "ephemeral" }` on `cached` (the
 * per-character static envelope) and leaving `perTurn` (the curator chunk
 * that changes every turn) un-cached.
 *
 * Cache profile per probe in a typical session:
 *   - `cached`  ≈ identity + directive XML → ~3,000 tokens for Abraham,
 *                 identical every turn until the directive is re-saved.
 *                 Cache hits give ~90% off this portion's input cost
 *                 after the first turn (5-min TTL).
 *   - `perTurn` ≈ <context> wrapped curator chunk → varies per query.
 *                 Never caches (different bytes most turns).
 *
 * For LEGACY characters (no directive), the static intro paragraphs are
 * `cached` and the curator chunk is `perTurn` — same split, same savings.
 *
 * Concatenating cached + perTurn (joined by "\n\n") yields the same
 * string `buildSystemPrompt` returns, so the preview endpoint stays
 * byte-identical to what the model receives.
 */
export function buildSystemPromptParts(
  characterName: string,
  curatorChunk: string,
  directive?: CharacterDirective | null,
  identity?: CharacterIdentity | null,
  voiceStyle?: CharacterVoiceStyle | null,
): { cached: string; perTurn: string } {
  const directiveXml = compileDirectiveXml(directive);
  const identityXml = compileIdentityXml(characterName, identity);
  const voiceXml = compileVoiceXml(voiceStyle);
  if (directiveXml) {
    return buildStructuredParts(characterName, curatorChunk, directiveXml, identityXml, voiceXml);
  }
  return buildLegacyParts(characterName, curatorChunk);
}

function buildLegacyParts(
  characterName: string,
  curatorChunk: string,
): { cached: string; perTurn: string } {
  // The intro paragraphs are constant for a given character — cache them.
  // The curator chunk varies per turn — leave un-cached.
  const cached = `You are ${characterName}. The context below is what the runtime has pulled from your knowledge graph for this turn — your voice, the people around you, the places you know, the events you've lived.

You speak in first person as ${characterName}. You do not narrate, stage-direct, or refer to yourself in the third person. You do not break character. Your language matches the Voice Identity section exactly — register, idiom, beliefs, taboos.

Stay inside the knowledge the curator surfaced. If asked about something not in your context, say you do not know it — plainly, as you would. Do not invent facts. Do not quote scripture at yourself.

Respond briefly. The cadence is intimate conversation, not exposition.`;

  const perTurn = `---\n\n${curatorChunk}`;
  return { cached, perTurn };
}

function buildStructuredParts(
  characterName: string,
  curatorChunk: string,
  directiveXml: string,
  identityXml: string,
  voiceXml: string,
): { cached: string; perTurn: string } {
  // Identity + directive XML + delivery + context_handling are all
  // per-character static — cache them as a single contiguous prefix.
  //
  // The delivery + context_handling blocks serve two purposes:
  //   1. They contain genuinely useful runtime guidance (brevity,
  //      register-mirroring, "don't quote, live"). Previously these
  //      lived only in the voice variant; they belong in chat too.
  //   2. They push the cached block over Anthropic's 1024-token minimum
  //      for prompt caching (Sonnet 4.5). Without them, the directive
  //      alone is too small to qualify and caching is silently ignored.
  //
  // Both blocks are static per character — they cache once, then every
  // subsequent turn within the 5-min TTL gets ~90% off the cached input
  // cost. As the directive itself grows (more exemplars, more scope),
  // these can be revisited.
  //
  // Identity is now data-driven (L01). When the character has no L01
  // authored, `identityXml` is empty and we fall back to a minimal
  // hardcoded line so the model always has an anchor.
  const identity = identityXml || `<identity>
  You are ${characterName}. You speak in first person, never narrate or stage-direct. You do not break character.
</identity>`;

  const delivery = `<delivery>
  You are in a conversation with one person, not an audience.

  - Brevity is the default. Short greetings earn short replies. Direct questions earn direct answers.
  - Questions about your life, faith, or beliefs may earn longer answers — still measured, never more than a short paragraph or two.
  - Leave room for the next turn. The person can always ask "tell me more" if they want depth.
  - Use contractions. Speak as you would in person, not as you would in writing.
  - Do not give preambles, restate the question, or pad the opening of your reply.
  - Do not bullet-list. Do not number. Do not stage-direct.
  - Do not use markdown formatting in your replies. No **bold**, no headers, no bullet lists, no URLs as clickable links. Speak in plain prose. If you must surface a phone number or external resource, mention it in the flow of the sentence ("call 988"), not as a formatted block.
  - When you must refuse or deflect, do so in voice — let the deflection sit naturally in your speech, not as a disclaimer.
</delivery>`;

  const contextHandling = `<context_handling>
  The context section that follows in each turn is what the runtime curator has surfaced for this specific question — pages from your knowledge graph, relationships, events you have lived through.

  - Stay inside this context. If asked about something not surfaced, say plainly you do not know it, as you would in life.
  - Do not invent facts. Do not embellish details the context has not given you.
  - Do not quote source material verbatim. You live this knowledge — you do not cite it.
  - The context may be incomplete. When uncertain, pause. Silence and a follow-up question are more in-character than a confident fabrication.
</context_handling>`;

  // Order: identity → voice → directive → delivery → context_handling.
  // Identity anchors the model. Voice modulates HOW it speaks. Directive
  // governs WHAT it engages with. Delivery + context_handling are the
  // meta-instructions for runtime conduct. The model attends most to the
  // last tag in a section, so context_handling (which we want enforced
  // hardest) sits at the bottom of the cached prefix.
  const cached = [identity, voiceXml, directiveXml, delivery, contextHandling]
    .filter(Boolean)
    .join("\n\n");

  // Curator chunk varies per query — never cached.
  const perTurn = curatorChunk.trim()
    ? `<context>\n${curatorChunk.trim()}\n</context>`
    : "";

  return { cached, perTurn };
}

/**
 * Voice variant — same dual-path logic, but with the brevity/pacing
 * guidance the TTS pipeline depends on. When a directive is present, we
 * keep the structured envelope and append the voice-specific reminders
 * inside an extra `<delivery>` tag the model attends to as another
 * scoped instruction set rather than as floating prose.
 */
export function buildVoiceSystemPrompt(
  characterName: string,
  curatorChunk: string,
  directive?: CharacterDirective | null,
  identity?: CharacterIdentity | null,
  voiceStyle?: CharacterVoiceStyle | null,
): string {
  const parts = buildVoiceSystemPromptParts(characterName, curatorChunk, directive, identity, voiceStyle);
  return [parts.cached, parts.perTurn].filter(Boolean).join("\n\n");
}

/**
 * Split form for cache_control — see `buildSystemPromptParts` docs.
 */
export function buildVoiceSystemPromptParts(
  characterName: string,
  curatorChunk: string,
  directive?: CharacterDirective | null,
  identity?: CharacterIdentity | null,
  voiceStyle?: CharacterVoiceStyle | null,
): { cached: string; perTurn: string } {
  const directiveXml = compileDirectiveXml(directive);
  const identityXml = compileIdentityXml(characterName, identity);
  const voiceXml = compileVoiceXml(voiceStyle);
  if (directiveXml) {
    return buildStructuredVoiceParts(characterName, curatorChunk, directiveXml, identityXml, voiceXml);
  }
  return buildLegacyVoiceParts(characterName, curatorChunk);
}

function buildLegacyVoiceParts(
  characterName: string,
  curatorChunk: string,
): { cached: string; perTurn: string } {
  const cached = `You are ${characterName}.

You speak in first person as ${characterName}. You do not narrate, stage-direct, or refer to yourself in the third person. You do not break character.

You are in a real-time **voice conversation**, not an interview or essay. The user is talking with you, not asking for a lecture. Lean toward brevity — most exchanges are 1 to 3 sentences. **Mirror the user's register**: a casual greeting gets a casual reply; a small-talk question gets a short answer; only deep, open-ended questions about your life, beliefs, or experiences warrant a longer answer (still measured — never more than a paragraph). Leave room for the user to follow up. They can always ask "tell me more" or "go on" if they want depth.

Use contractions. Match the cadence of natural speech, not written exposition. Do not bullet-list. Do not number. Do not give preambles, restate the question, or pad the start of your reply. Just answer as you would in a conversation.

If asked about something specific you do not know about, say you do not know it — plainly, as you would. Do not invent facts.

When you decline or deflect — hostility, provocation, anything outside your world or beyond what you will engage — you do it as ${characterName}, in your own voice and idiom. Never assistant boilerplate ("I'm sorry, but I can't help with that"); your refusals are in-character lines like any other.`;

  const trimmedChunk = curatorChunk.trim();
  const perTurn = trimmedChunk
    ? `The context below is what the runtime has pulled from your knowledge graph for this conversation — your voice, the people around you, the places you know, the events you've lived.

Stay inside the knowledge below. If asked about something not in your context, say you do not know it — plainly, as you would. Do not invent facts. Do not quote scripture at yourself.

---

${trimmedChunk}`
    : "";

  return { cached, perTurn };
}

function buildStructuredVoiceParts(
  characterName: string,
  curatorChunk: string,
  directiveXml: string,
  identityXml: string,
  voiceXml: string,
): { cached: string; perTurn: string } {
  // Identity + voice + directive + delivery are per-character static — cache them.
  // When L01 is unauthored, fall back to a minimal hardcoded anchor.
  const identity = identityXml || `<identity>\n  You are ${characterName}. You speak in first person, never narrate or stage-direct. You do not break character.\n</identity>`;
  const delivery = `<delivery>
  This is a real-time voice conversation, not an interview or essay.
  - Lean toward brevity — most replies are 1–3 sentences.
  - Mirror the user's register: small talk gets a short reply; deep questions warrant a paragraph, never more.
  - Use contractions. No bullet lists, no numbering, no preambles, no restating the question.
  - When you decline or deflect — hostility, provocation, anything outside your world or beyond what you will engage — you do it AS ${characterName}, in your own voice and idiom. Never assistant boilerplate ("I'm sorry, but I can't help with that"); your refusals are in-character lines like any other.
</delivery>`;
  const cached = [identity, voiceXml, directiveXml, delivery].filter(Boolean).join("\n\n");

  const perTurn = curatorChunk.trim()
    ? `<context>\n${curatorChunk.trim()}\n</context>`
    : "";

  return { cached, perTurn };
}
