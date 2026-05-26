/**
 * Browser-safe prompt compiler shim.
 *
 * Client harness editors need the pure XML/system-prompt helpers, but the
 * @odyssey/engine barrel also exports server-only audio adapters that import
 * Node modules. Import the pure modules directly so Turbopack does not pull
 * the server graph into client chunks.
 */

export {
  buildSystemPrompt,
  buildSystemPromptParts,
  buildVoiceSystemPrompt,
  buildVoiceSystemPromptParts,
} from "../../../../packages/engine/src/character-system-prompt";
export { compileDirectiveXml } from "../../../../packages/engine/src/directive-xml";
export { compileIdentityXml } from "../../../../packages/engine/src/identity-xml";
export { compileVoiceXml } from "../../../../packages/engine/src/voice-xml";
