import "dotenv/config";
import { getTicketStore } from "@odyssey/db";

const SAM = "8730c64b-20ef-4ecd-8e0e-36bbb5b47746";

// Feature IDs
const FEATURE_2 = "6aa191bd-06ad-43e1-b3f4-3b2aae95b879";
const FEATURE_3 = "070fd4af-9dc6-4e70-83ff-c175e1f94ca5";
const FEATURE_4 = "7fec1926-1682-49b8-a5db-77413e801175";
const FEATURE_5 = "e6f030de-8c1c-4722-956a-3c0ae7aaacb1";

async function main() {
  const ticketStore = getTicketStore();

  // ── Reassign existing tickets to Sam ──────────────────────────
  const reassignIds = [
    "9db88e86-09d7-4411-a61a-54d788d991ad", // Narrator identity + voice design
    "1249698d-253b-415a-a7ac-e94293508b0e", // Abraham's Tent world definition
    "f256c63b-cf21-4bc9-89f8-681226265e31", // Knowledge graph admin UI
    "2246b7d2-406f-4cc2-9d7f-7bc3dce83039", // Character test chat with live graph
  ];

  for (const id of reassignIds) {
    await ticketStore.update(id, { assignee: SAM });
    console.log(`Reassigned → SAM: ${id}`);
  }

  // ── Create new tickets for Sam ────────────────────────────────

  // Feature 2: Secondary character knowledge graphs
  const t1 = await ticketStore.create({
    featureId: FEATURE_2,
    title: "Secondary character knowledge graphs",
    description:
      "Build knowledge graphs for every character in Abraham's Tent beyond Abraham himself: Sarah (her perspective on the covenant, barrenness, the promise, Hagar), Isaac (childhood, the binding, innocence), the three angels (their disguise, their mission, the announcement), Hagar (exile, Ishmael, the well). Each character needs entity pages, relationship context, voice/identity pages, and temporal awareness. Uses the same wiki infrastructure and ingestion pipeline built in earlier tickets.",
    status: "backlog" as const,
    domain: "world",
    priority: "P1",
    assignee: SAM,
    sortOrder: 6,
    startDate: "2026-05-26",
    endDate: "2026-06-06",
  });
  console.log(`Created: ${t1.id} — ${t1.title}`);

  // Feature 3: Character + narrator voice profiles
  const t2 = await ticketStore.create({
    featureId: FEATURE_3,
    title: "Character + narrator voice profiles",
    description:
      "Define and configure distinct TTS voice profiles for every voice in Abraham's Tent. The narrator needs its own recognizable voice — authoritative, warm, distinct from any character. Abraham needs a voice that sounds ancient without being cartoonish. Sarah, Isaac, and the angels each need voices that are immediately distinguishable. Evaluate TTS providers, select voice models, tune parameters (pitch, speed, warmth, texture), and test until each voice is recognizable within 2 seconds of speaking. Voice profiles are stored in the world definition and consumed by the voice pipeline at runtime.",
    status: "backlog" as const,
    domain: "world",
    priority: "P1",
    assignee: SAM,
    sortOrder: 7,
    startDate: "2026-06-16",
    endDate: "2026-06-27",
  });
  console.log(`Created: ${t2.id} — ${t2.title}`);

  // Feature 4: Abraham's Tent world authoring
  const t3 = await ticketStore.create({
    featureId: FEATURE_4,
    title: "Abraham's Tent world authoring",
    description:
      "Using the world builder canvas to author the complete Abraham's Tent world definition. Create all nodes: World Core (oaks of Mamre, narrator config, metrics for hospitality/mystery/tension/openness, progression phases), Characters (Abraham, Sarah, Isaac, three angels with emotional baselines, behavior triggers, speaking styles), Groups (household, visitors), Role (the traveler — player identity), Events (angel arrival, Sarah's laugh, covenant discussion, binding allusion), and Initial State (starting metrics, relationships, time of day). Connect relationships, tune thresholds, validate completeness. This is the content that Feature 5 runs.",
    status: "backlog" as const,
    domain: "world",
    priority: "P1",
    assignee: SAM,
    sortOrder: 6,
    startDate: "2026-08-04",
    endDate: "2026-08-11",
  });
  console.log(`Created: ${t3.id} — ${t3.title}`);

  // Feature 5: UX + experience design
  const t4 = await ticketStore.create({
    featureId: FEATURE_5,
    title: "UX + experience design",
    description:
      "Drive the overall UX and product direction for the player experience. Define session flow interactions: how the player enters (what they see, what they hear first), how narrator-to-character transitions feel, how multi-character moments are presented, how silence is handled, how the session concludes. Design visual and audio feedback patterns: listening state, thinking state, speaking state, character transitions. Ensure the product feels intentional and immersive — not like a dev tool with a microphone. Covers interaction design, audio UX, and end-to-end experience choreography.",
    status: "backlog" as const,
    domain: "frontend",
    priority: "P1",
    assignee: SAM,
    sortOrder: 5,
    startDate: "2026-08-11",
    endDate: "2026-08-22",
  });
  console.log(`Created: ${t4.id} — ${t4.title}`);

  console.log("\nDone. 4 tickets reassigned, 4 new tickets created for Sam.");
}

main().catch(console.error);
