import "dotenv/config";
import { getFeatureStore, getTicketStore } from "@odyssey/db";

const VERSION_ID = "960d73da-e68d-40ee-8e2a-da24028a517f";
const BINNY = "1bdbaaf9-7850-46cc-896e-65945c023b06";
const SAM = "8730c64b-20ef-4ecd-8e0e-36bbb5b47746";

async function main() {
  const featureStore = getFeatureStore();
  const ticketStore = getTicketStore();

  const feature = await featureStore.create({
    versionId: VERSION_ID,
    title: "The Experience — Integration + Player App",
    description:
      "The final feature that brings everything together into a demoable product. Wires the voice pipeline, knowledge graph, narrator, and world builder into one seamless session flow. Includes the player-facing app — the actual interface someone uses to enter Abraham's Tent — and end-to-end quality tuning across latency, voice, character consistency, and narrator pacing. This is the feature that proves the last MVP goal: a 5–10 minute conversation that leaves someone feeling like they engaged with something thoughtful.",
    color: "#FF6B6B",
    status: "planned",
    assignee: BINNY,
    startDate: "2026-08-04",
    endDate: "2026-08-29",
    sortOrder: 4,
  });

  console.log(`Feature created: ${feature.id} — ${feature.title}`);

  const tickets = [
    {
      title: "Full pipeline integration",
      description:
        "Wire all systems into one continuous session: voice pipeline (Feature 1) + knowledge graph context curator (Feature 2) + narrator orchestrator (Feature 3) + world definition from world builder (Feature 4). A single session where the narrator opens, sets the scene using the world definition, hands off to Abraham backed by the knowledge graph, orchestrates character entrances, and the whole thing runs over the voice pipeline. The integration layer that makes four separate features behave as one product.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 0,
      startDate: "2026-08-04",
      endDate: "2026-08-11",
    },
    {
      title: "Session flow + lifecycle",
      description:
        "Define and implement the full session arc: entry (player opens the app, narrator introduces the world), active scene (narrator and characters respond, events fire, world state evolves), and exit (graceful conclusion, narrator wrap-up, session summary). Handle edge cases: player goes silent, player asks to leave, session timeout, mid-session reconnection. Session state persistence so a crashed session can resume.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 1,
      startDate: "2026-08-11",
      endDate: "2026-08-15",
    },
    {
      title: "Player app UI",
      description:
        "The player-facing interface for entering a world. Minimal but intentional — not a dev tool. World selection (Abraham's Tent for MVP), session start with narrator introduction, push-to-talk or voice activity detection, real-time audio playback, visual feedback during listening/thinking/speaking states, session end screen. Designed to get out of the way and let the voice experience be the product.",
      status: "backlog" as const,
      domain: "frontend",
      priority: "P1",
      assignee: SAM,
      sortOrder: 2,
      startDate: "2026-08-11",
      endDate: "2026-08-18",
    },
    {
      title: "Latency optimization",
      description:
        "End-to-end latency tuning across the full pipeline: mic capture to first audio byte of response. Profile each stage (STT, context curator lookup, LLM generation, narrator/character routing, TTS), identify bottlenecks, optimize. Target: conversational feel — response begins before the player forgets what they said. Streaming TTS playback (start playing before full response is generated), parallel processing where possible, connection pooling, prompt caching.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 3,
      startDate: "2026-08-15",
      endDate: "2026-08-22",
    },
    {
      title: "Abraham's Tent end-to-end playtesting",
      description:
        "Repeated full playthroughs of Abraham's Tent as a complete experience. Test narrator introductions, character consistency across long conversations, multi-character scenes (Abraham + Sarah, angel arrival), event triggering, world state evolution, edge cases (adversarial player, off-topic questions, silence). Document failures, tune prompts, adjust world definition, refine narrator pacing. The goal is a 5–10 minute session that consistently lands.",
      status: "backlog" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 4,
      startDate: "2026-08-22",
      endDate: "2026-08-29",
    },
  ];

  for (const t of tickets) {
    const ticket = await ticketStore.create({
      featureId: feature.id,
      ...t,
    });
    console.log(`  Ticket: ${ticket.id} — ${ticket.title}`);
  }

  console.log("\nDone. Feature 5 seeded with 5 tickets.");
}

main().catch(console.error);
