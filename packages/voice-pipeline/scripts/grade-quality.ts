/**
 * In-character quality judge (single turn) — does the response embody the
 * character's defined voice / persona / scope? Replays one turn through the real
 * runVoiceStream and judges voice fidelity, persona, and scope adherence. Thin CLI
 * over lib/grounding's replayAndEval (quality axis).
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/grade-quality.ts <characterSlug> "<message>"
 *
 * JUDGE_MODEL overrides the judge. GRADE_RESPONSE="..." grades an injected response.
 */
import { getCharacterStore } from "@odyssey/db";
import { replayAndEval } from "./lib/grounding";

const CHARACTER = process.argv[2] ?? "abraham";
const MESSAGE = process.argv[3] ?? "Tell me, in great detail, everything about your entire life from birth to death.";

async function main() {
  const character =
    (await getCharacterStore().getById(CHARACTER)) ??
    (await getCharacterStore().getBySlug(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }

  const override = process.env.GRADE_RESPONSE?.trim() || undefined;
  if (override) console.log("(grading an injected response, not the character's)");

  const { response, quality } = await replayAndEval({
    characterId: character.id,
    message: MESSAGE,
    responseOverride: override,
    axes: { quality: true },
  });
  if (!quality) {
    console.error("no quality verdict returned");
    process.exit(1);
  }

  console.log("═══ IN-CHARACTER QUALITY ══════════════════════════════════════════");
  console.log(`character : ${character.title} (${character.slug})`);
  console.log(`message   : "${MESSAGE}"`);
  console.log(`response  : ${response.replace(/\s+/g, " ").trim()}`);
  console.log("");
  console.log(`VERDICT   : ${quality.verdict}  ·  quality ${quality.qualityScore.toFixed(2)}`);
  const dim = (label: string, d: { score: number; notes: string }) =>
    console.log(`  ${label.padEnd(8)} ${d.score.toFixed(2)}  ${d.notes.replace(/\s+/g, " ").trim()}`);
  console.log("");
  dim("voice", quality.voice);
  dim("persona", quality.persona);
  dim("scope", quality.scope);
  if (quality.issues?.length) {
    console.log("\nissues:");
    for (const i of quality.issues) console.log(`  - ${i}`);
  }
  if (quality.notes) console.log(`\nnotes: ${quality.notes}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
