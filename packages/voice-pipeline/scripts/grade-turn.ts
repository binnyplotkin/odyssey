/**
 * Grounding judge (single turn) — does the character's response stay faithful to the
 * knowledge it was actually given? Replays one turn through the real runVoiceStream
 * (debug → full retrieval) and judges each factual claim. Thin CLI over lib/grounding.
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/grade-turn.ts <characterSlug> "<message>"
 *
 * JUDGE_MODEL overrides the judge (default claude-haiku-4-5).
 * GRADE_RESPONSE="..." grades an injected response against the real retrieved context.
 */
import { getCharacterStore } from "@odyssey/db";
import { replayAndGrade } from "./lib/grounding";

const CHARACTER = process.argv[2] ?? "abraham";
const MESSAGE = process.argv[3] ?? "Sarah laughed when she heard. Were you afraid to believe the promise?";

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

  const { response, pageSlugs, verdict, judge } = await replayAndGrade({
    characterId: character.id,
    message: MESSAGE,
    responseOverride: override,
  });

  console.log("═══ GROUNDING GRADE ═══════════════════════════════════════════════");
  console.log(`character : ${character.title} (${character.slug})`);
  console.log(`message   : "${MESSAGE}"`);
  console.log(`response  : ${response.replace(/\s+/g, " ").trim()}`);
  console.log(`retrieved : ${pageSlugs.length ? pageSlugs.join(", ") : "(none)"}`);
  console.log("");
  console.log(
    `VERDICT   : ${verdict.verdict}  ·  faithfulness ${verdict.faithfulnessScore.toFixed(2)}  ·  used graph: ${verdict.usedRetrievedKnowledge ? "yes" : "no"}`,
  );
  const mark: Record<string, string> = {
    "grounded-knowledge": "✓ [knowledge]   ",
    "grounded-identity": "✓ [identity]    ",
    fabrication: "✗ [FABRICATION] ",
    embellishment: "~ [embellish]   ",
  };
  console.log("\nclaims:");
  for (const c of verdict.claims ?? []) {
    console.log(`  ${mark[c.kind] ?? `? [${c.kind}] `}${c.claim}`);
    if (c.evidence && c.evidence.trim())
      console.log(`        ↳ ${c.evidence.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  if (verdict.fabrications.length) {
    console.log("\n✗ fabrications (ungrounded world-facts — the real problem):");
    for (const f of verdict.fabrications) console.log(`  - ${f}`);
  }
  if (verdict.embellishments.length) {
    console.log("\n~ embellishments (sensory color — NOT scored against faithfulness):");
    for (const e of verdict.embellishments) console.log(`  - ${e}`);
  }
  if (verdict.notes) console.log(`\nnotes: ${verdict.notes}`);
  console.log(`\njudge: ${judge.model} (in=${judge.inputTokens} out=${judge.outputTokens})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
