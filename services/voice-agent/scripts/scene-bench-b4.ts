/**
 * B4 verification — does speculative speaker-selection hide the orchestrate gap?
 *
 * Simulates the endpoint hold: speculate() off the partial transcript, wait the
 * hold, then drive() the final turn and measure the time from drive() to the
 * speaker being decided. On a HIT that time should collapse to ~the DB lookup
 * (orchestrate hidden); a MISS pays the full orchestrate on the final transcript.
 *
 *   npx tsx --env-file=services/voice-agent/.env services/voice-agent/scripts/scene-bench-b4.ts [sceneId]
 */
import { SceneDriver } from "../src/scene-driver";

const SCENE_ID = process.argv[2] ?? "abrahams-tent";
const HOLD_MS = 700; // matches the endpointing minDelay — the window speculation runs in
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function timedDrive(driver: SceneDriver, finalText: string): Promise<{ ms: number; who: string }> {
  const startedAt = Date.now();
  let ms = 0;
  let who = "(none)";
  await driver.drive(finalText, async (input) => {
    ms = Date.now() - startedAt;
    who = input.speaker.name;
    return "(mock reply — not voiced)";
  });
  return { ms, who };
}

async function main() {
  const driver = await SceneDriver.load(SCENE_ID);
  if (!driver) {
    console.error(`scene "${SCENE_ID}" did not resolve`);
    process.exit(1);
  }
  console.log(
    `scene=${driver.scene.id} roster=[${driver.scene.characters.map((c) => c.characterSlug).join(", ")}]\n`,
  );

  // Warm the orchestrator connection so we measure warm latency (not cold first-call).
  await driver.drive("Let's begin.", async () => "(warm-up)");

  console.log("— HIT: full transcript known at hold start, speculation runs under the hold —");
  for (const text of ["Sarah, did you really laugh?", "Abraham, were you afraid of the promise?"]) {
    driver.speculate(text); // last STT final == the whole turn (the common single-segment case)
    await sleep(HOLD_MS); // endpoint hold — the orchestrate happens HERE, off the hot path
    const { ms, who } = await timedDrive(driver, text);
    console.log(`  drive("${text}")\n    → decided in ${ms}ms → ${who}   (orchestrate hidden under the hold)\n`);
  }

  console.log("— MISS: speculation covered only a short prefix; pays orchestrate on the final —");
  {
    const partial = "Tell me something"; // a prefix, but <60% of the final → rejected
    const final = "Tell me something, Sarah, about the day you laughed at the promise.";
    driver.speculate(partial);
    await sleep(HOLD_MS);
    const { ms, who } = await timedDrive(driver, final);
    console.log(`  drive("${final}")\n    → decided in ${ms}ms → ${who}   (full orchestrate on final)\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
