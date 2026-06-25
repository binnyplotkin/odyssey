/**
 * Seed Sarah's L03 Voice & Style + fold her voice_identity taboos into the L02
 * directive's <never> — so her persona is self-sufficient in the system-prompt
 * envelope and the per-turn voice_identity sheet can retire (per-character gate
 * in run-voice-stream flips to "excluded" once <voice> is authored).
 *
 * Source = her `sarah-voice-identity` sheet (speechPatterns/idioms/emotionalRange
 * → tone + voicePrompt; taboos → directive.never). Voice-aligned with her seed
 * identity ("sharp, unadorned, unflinching · acts, accuses, laughs, survives").
 *
 * Usage:
 *   npx tsx scripts/seed-sarah-voice-style.ts            # apply
 *   npx tsx scripts/seed-sarah-voice-style.ts --clear    # set voiceStyle to null
 */

import "dotenv/config";
import { getCharacterStore, type CharacterVoiceStyle } from "@odyssey/db";

const VOICE_STYLE: CharacterVoiceStyle = {
  tone: ["sharp", "unadorned", "unflinching", "dryly funny"],
  decision:
    "acts and announces — never asks permission · shrewd and self-justifying · won't soften a hard truth or reach for piety",
  brevity: "short",
  register: { formality: 0.25, warmth: 0.3 }, // plain-blunt + guarded, feeling underneath
  voicePrompt:
    "A woman aged by long waiting and harder survival. Plain and direct — she lands her words hard and doesn't soften them. A dry, knowing edge; when the laugh comes it's sharp, not sweet. No ornament, no piety.",
  prosody: ["firm", "clipped", "dry-edged"],
};

// Folded from the sheet's `taboos` — things Sarah must never do.
const NEVER: string[] = [
  "Soften a hard truth with pious language",
  "Defer without question",
  "Perform gentleness for its own sake",
  "Hide your jealousy or grief",
  "Treat being deceived or taken as trivial",
  "Retreat into abstractions divorced from lived experience",
  "Invoke 'the gods' in the plural — your world has one God, even when you doubt him",
];

async function main() {
  const clear = process.argv.includes("--clear");
  const store = getCharacterStore();
  const sarah = await store.getBySlug("sarah");
  if (!sarah) {
    console.error("Sarah not found. Run her seed first.");
    process.exit(1);
  }

  if (clear) {
    console.log("Clearing Sarah's voice style (no <voice> block; sheet returns) …");
    await store.update(sarah.id, { voiceStyle: null });
    console.log("ok");
    return;
  }

  const directive = { ...(sarah.directive ?? {}), never: NEVER };

  console.log(`Writing L03 voice style + L02 <never> to Sarah (id: ${sarah.id})`);
  console.log(`  tone:        ${VOICE_STYLE.tone?.join(" · ")}`);
  console.log(`  decision:    ${VOICE_STYLE.decision}`);
  console.log(`  brevity:     ${VOICE_STYLE.brevity}`);
  console.log(`  register:    formality ${VOICE_STYLE.register?.formality} · warmth ${VOICE_STYLE.register?.warmth}`);
  console.log(`  never:       ${NEVER.length} taboos folded from the sheet`);

  const updated = await store.update(sarah.id, { voiceStyle: VOICE_STYLE, directive });
  if (!updated) {
    console.error("update returned null — unexpected.");
    process.exit(1);
  }
  console.log("\nDone. Sarah's envelope now carries her voice; the per-character gate will exclude her sheet.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
