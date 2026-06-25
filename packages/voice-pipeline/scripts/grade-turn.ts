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
  const score = typeof verdict.groundingScore === "number" ? verdict.groundingScore.toFixed(2) : "?";
  console.log(
    `VERDICT   : ${verdict.verdict ?? "?"}  ·  grounding ${score}  ·  used retrieved knowledge: ${verdict.usedRetrievedKnowledge ? "yes" : "no"}`,
  );
  console.log("\nclaims:");
  for (const c of verdict.claims ?? []) {
    const mark = c.supported ? "✓" : "✗";
    const src = c.supported ? `[${c.source}]` : "[UNSUPPORTED]";
    console.log(`  ${mark} ${src} ${c.claim}`);
    if (c.evidence && c.evidence !== "none")
      console.log(`        ↳ ${c.evidence.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  if (verdict.unsupported?.length) {
    console.log("\n⚠ unsupported claims (parametric / hallucinated):");
    for (const u of verdict.unsupported) console.log(`  - ${u}`);
  }
  if (verdict.notes) console.log(`\nnotes: ${verdict.notes}`);
  console.log(`\njudge: ${judge.model} (in=${judge.inputTokens} out=${judge.outputTokens})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
