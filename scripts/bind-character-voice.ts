/**
 * Bind a character to a voice (sets characters.voiceId), so the live voice
 * pipeline routes that character's TTS through the chosen voices-table row.
 *
 * Use after a Sonar TTS A/B picks a winner — e.g. abraham → liam (ElevenLabs
 * Flash) to get off the slow Pocket TTS path the benchmark exposed.
 *
 * Prints the previous voiceId so the change is trivially reversible. The
 * voice choice is artistic, not just latency: `liam` is a generic male
 * ElevenLabs voice used for benchmarking — swap to a purpose-cloned voice
 * anytime by re-running with a different --voice slug.
 *
 * Usage:
 *   npx tsx scripts/bind-character-voice.ts --character abraham --voice liam
 *   npx tsx scripts/bind-character-voice.ts --character abraham --voice abraham   # revert to Pocket
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore, getVoiceStore } from "@odyssey/db";

const args = process.argv.slice(2);
const characterSlug = readFlag("--character") ?? "abraham";
const voiceSlug = readFlag("--voice");

async function main() {
  if (!voiceSlug) throw new Error("Missing --voice <slug>. List voices in the admin app or DB.");

  const character = await getCharacterStore().getBySlug(characterSlug);
  if (!character) throw new Error(`Character "${characterSlug}" not found.`);

  const voice = await getVoiceStore().getBySlug(voiceSlug);
  if (!voice) throw new Error(`Voice "${voiceSlug}" not found.`);
  if (voice.status !== "ready") {
    throw new Error(`Voice "${voiceSlug}" is not ready (status=${voice.status}).`);
  }

  const previousVoiceId = character.voiceId ?? null;
  if (previousVoiceId === voice.id) {
    console.log(`No change — ${characterSlug} is already bound to ${voiceSlug} (${voice.id}).`);
    return;
  }

  const updated = await getCharacterStore().update(character.id, { voiceId: voice.id });
  if (!updated) throw new Error("Update returned no record.");

  console.log(`Bound ${characterSlug} → ${voiceSlug}`);
  console.log(`  provider:  ${voice.provider}`);
  console.log(`  voice.id:  ${voice.id}`);
  console.log(`  previous:  ${previousVoiceId ?? "(none)"}`);
  console.log(`\nRevert with: npx tsx scripts/bind-character-voice.ts --character ${characterSlug} --voice <previous-slug>`);
}

function readFlag(name: string): string | null {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] ?? null;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
