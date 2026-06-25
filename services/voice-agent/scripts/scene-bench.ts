/**
 * Measures the SceneDriver's turn-driving gap in isolation — the real orchestrator
 * (Cerebras/Groq) + speaker resolution, with NO LiveKit (so no worker-dispatch
 * ambiguity). The `speak` callback is a no-op that just reports when the speaker
 * was decided, so the elapsed time is purely orchestrate + character lookup.
 *
 *   npx tsx --env-file=services/voice-agent/.env services/voice-agent/scripts/scene-bench.ts [sceneId]
 */
import { SceneDriver } from "../src/scene-driver";

const SCENE_ID = process.argv[2] ?? "abrahams-tent";
const PROMPTS = [
  "Hello? Who's here?",
  "Sarah, did you really laugh?",
  "Abraham, were you afraid of the promise?",
  "What happens to the two of you now?",
];

async function main() {
  const driver = await SceneDriver.load(SCENE_ID);
  if (!driver) {
    console.error(`scene "${SCENE_ID}" did not resolve`);
    process.exit(1);
  }
  console.log(
    `scene=${driver.scene.id} roster=[${driver.scene.characters.map((c) => c.characterSlug).join(", ")}]\n`,
  );

  for (const prompt of PROMPTS) {
    const startedAt = Date.now();
    let decided = false;
    await driver.drive(prompt, async (input) => {
      decided = true;
      console.log(
        `  user: "${prompt}"\n  → decided in ${Date.now() - startedAt}ms → speaker=${input.speaker.name} (${input.speaker.slug}) characterId=${input.characterId}\n`,
      );
      return "(mock reply — not voiced)";
    });
    if (!decided) {
      console.log(`  user: "${prompt}" → no speaker (wait/narrate/unresolved) in ${Date.now() - startedAt}ms\n`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
