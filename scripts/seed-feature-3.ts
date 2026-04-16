import "dotenv/config";
import { getFeatureStore, getTicketStore } from "@odyssey/db";

const VERSION_ID = "960d73da-e68d-40ee-8e2a-da24028a517f";
const BINNY = "1bdbaaf9-7850-46cc-896e-65945c023b06";

async function main() {
  const featureStore = getFeatureStore();
  const ticketStore = getTicketStore();

  // Create Feature 3
  const feature = await featureStore.create({
    versionId: VERSION_ID,
    title: "World Narrator / Orchestrator",
    description:
      "The AI narrator that sits between the player and the world. Part scene-setter, part guide, part Jarvis. A third-person presence with its own distinct voice and identity — separate from the characters. It holds the world state, introduces scenes, responds to player commands, narrates transitions, and orchestrates which characters speak and when. The narrator is the platform — the persistent AI that runs any world. The characters are the content.",
    color: "#E8A838",
    status: "planned",
    assignee: BINNY,
    startDate: "2026-06-09",
    endDate: "2026-07-11",
    sortOrder: 2,
  });

  console.log(`Feature created: ${feature.id} — ${feature.title}`);

  const tickets = [
    {
      title: "Narrator identity + voice design",
      description:
        "Define the narrator's persona, tone, and voice characteristics — distinct from any character voice. Build the narrator system prompt architecture: how it introduces itself, its relationship to the player, its authority over the world. Define how it sounds (warm? authoritative? understated?) and how the player recognizes it as separate from characters. This is the narrator's equivalent of a character's voice/identity wiki page.",
      status: "todo" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 0,
      startDate: "2026-06-09",
      endDate: "2026-06-16",
    },
    {
      title: "World state schema",
      description:
        "Define the data model the narrator maintains at runtime: scene state (characters present, location, time of day), narrative dimensions (tension, hospitality, mystery, openness), player state (what they've said, what they know, their stance), and an event log. This is the narrator's internal map of the world — what it reads and writes to make orchestration decisions.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 1,
      startDate: "2026-06-09",
      endDate: "2026-06-16",
    },
    {
      title: "Scene introduction engine",
      description:
        "The pre-entry experience. Before characters speak, the narrator sets the scene: builds the world in the player's mind, layers in atmosphere, establishes context. 'You stand at the edge of the oaks of Mamre...' This is the narrator's first impression — the thing that makes a voice-only world feel like a place, not a phone call. Handles cold opens, re-entries, and scene transitions.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 2,
      startDate: "2026-06-16",
      endDate: "2026-06-23",
    },
    {
      title: "Player command router",
      description:
        "Parse player speech into meta-commands vs. in-world dialogue. 'I want to talk to Sarah' is a command to the narrator. 'Hello Abraham' is in-world speech routed to a character. 'Who else is here?' is a question for the narrator. 'What year is it?' could go either way. Build the intent classification layer that decides who handles each utterance — narrator or character — and routes accordingly.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 3,
      startDate: "2026-06-16",
      endDate: "2026-06-23",
    },
    {
      title: "Character orchestration layer",
      description:
        "The narrator decides who speaks and when. Manages character entrances and exits ('Sarah has stepped out from behind the curtain'), turn-taking in multi-character moments, interruptions, and characters reacting to each other. Wires into the voice pipeline so the narrator controls the conversation flow — not the player talking to one character in isolation, but the narrator running a living scene.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 4,
      startDate: "2026-06-23",
      endDate: "2026-06-30",
    },
    {
      title: "Event + transition narration",
      description:
        "Dynamic narration when the world changes. The narrator explains state shifts: 'The sun has moved. Three figures appear on the horizon.' Bridges scene transitions, narrates consequences of player choices, announces character arrivals. Reads world state changes and generates contextual narration — not canned lines, but LLM-generated descriptions grounded in the current scene state.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 5,
      startDate: "2026-06-27",
      endDate: "2026-07-04",
    },
    {
      title: "Abraham's Tent world definition",
      description:
        "The full world configuration for the first Odyssey world. Characters (Abraham, Sarah, Isaac, the three angels), their entry conditions, the scene graph (tent interior, entrance, oaks), narrative arcs (hospitality → covenant → revelation), state dimensions and their thresholds, triggerable events (angel arrival, Sarah's laugh, binding allusion). Everything the narrator needs to run Abraham's Tent as a living simulation.",
      status: "backlog" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 6,
      startDate: "2026-07-01",
      endDate: "2026-07-11",
    },
  ];

  for (const t of tickets) {
    const ticket = await ticketStore.create({
      featureId: feature.id,
      ...t,
    });
    console.log(`  Ticket: ${ticket.id} — ${ticket.title}`);
  }

  console.log("\nDone. Feature 3 seeded with 7 tickets.");
}

main().catch(console.error);
