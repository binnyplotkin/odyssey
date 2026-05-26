/**
 * Seed Abraham's L03 Voice & Style — tone palette, decision, brevity,
 * register, audio voice prompt + prosody. Voice-aligned with his seed
 * identity ("speaks plainly · old, not clever · shepherd-patriarch
 * metaphors · leaves room for doubt") in `scripts/seed-abraham.ts`.
 *
 * Usage:
 *   npx tsx scripts/seed-abraham-voice-style.ts            # apply
 *   npx tsx scripts/seed-abraham-voice-style.ts --clear    # set to null
 */

import "dotenv/config";
import { getCharacterStore, type CharacterVoiceStyle } from "@odyssey/db";

const VOICE_STYLE: CharacterVoiceStyle = {
  tone: ["warm", "weathered", "contemplative"],
  decision: "deliberate · invokes precedent · willing to sit with uncertainty",
  brevity: "short",
  register: { formality: 0.5, warmth: 0.7 }, // formal + warm
  voicePrompt:
    "An older man, weathered by long travel under harsh sun. Unhurried cadence — he pauses for breath. Resonant chest voice, no accent identifiable to a specific region. Quiet but never frail.",
  prosody: ["slow", "low-pitch", "long-pauses", "soft-consonants"],
};

async function main() {
  const clear = process.argv.includes("--clear");

  const store = getCharacterStore();
  const abraham = await store.getBySlug("abraham");
  if (!abraham) {
    console.error("Abraham not found. Run seed-abraham.ts first.");
    process.exit(1);
  }

  if (clear) {
    console.log("Clearing Abraham's voice style (no <voice> block in prompt) …");
    await store.update(abraham.id, { voiceStyle: null });
    console.log("ok");
    return;
  }

  console.log(`Writing voice style to Abraham (id: ${abraham.id})`);
  console.log(`  tone:        ${VOICE_STYLE.tone?.join(" · ")}`);
  console.log(`  decision:    ${VOICE_STYLE.decision}`);
  console.log(`  brevity:     ${VOICE_STYLE.brevity}`);
  console.log(`  register:    formality ${VOICE_STYLE.register?.formality} · warmth ${VOICE_STYLE.register?.warmth}`);
  console.log(`  voicePrompt: ${VOICE_STYLE.voicePrompt?.slice(0, 80)}…`);
  console.log(`  prosody:     ${VOICE_STYLE.prosody?.join(" · ")}`);

  const updated = await store.update(abraham.id, { voiceStyle: VOICE_STYLE });
  if (!updated) {
    console.error("update returned null — unexpected.");
    process.exit(1);
  }
  console.log("\nDone. Reload /characters/abraham/harness to see the new <voice> block.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
