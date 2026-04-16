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
    title: "World Builder — Canvas Editor",
    description:
      "A visual canvas editor for authoring simulation worlds. Node-based UI where you create, connect, and configure the core entities that define a world — World Core, Characters, Groups, Roles, Events, and Initial State. Each node type has a rich sidebar panel with identity, dynamics, relationships, behavior triggers, and voice configuration. Supports both manual creation and AI-assisted generation from a text prompt. The world builder is what feeds into the simulation engine — the structured data that the narrator and characters draw from at runtime.",
    color: "#4ECDC4",
    status: "planned",
    assignee: BINNY,
    startDate: "2026-07-07",
    endDate: "2026-08-08",
    sortOrder: 3,
  });

  console.log(`Feature created: ${feature.id} — ${feature.title}`);

  const tickets = [
    {
      title: "Node schema + data model",
      description:
        "Implement the full node type system: World Core (setting, premise, narrator config, metrics, progression, outcomes, scoring rubrics), Character (identity, emotional baseline, voice, behavior triggers, secrets, NPC relationships), Group (dynamics, disposition triggers, goals, relationships), Role (authority, constraints, group alignments, inner circle, vulnerabilities, objectives), Event (stakes, actors, constraints, metric hints, narration), and Initial State (metric values, relationships, progression, time context, tracking defaults). Zod schemas for each, validated and persisted as JSONB.",
      status: "todo" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 0,
      startDate: "2026-07-07",
      endDate: "2026-07-14",
    },
    {
      title: "Canvas UI foundation",
      description:
        "The infinite canvas surface: pan, zoom, node placement, selection, multi-select, drag-to-reposition. Node cards rendered as color-coded cards by type (World Core, Character, Group, Role, Event, Initial State) with summary preview — name, key stats, tags. Bottom status bar with node type legend and count. Toolbar with Fit View, Auto Layout, Preview, Save World.",
      status: "backlog" as const,
      domain: "frontend",
      priority: "P1",
      assignee: SAM,
      sortOrder: 1,
      startDate: "2026-07-14",
      endDate: "2026-07-21",
    },
    {
      title: "Node sidebar panels",
      description:
        "Right-side detail panel that opens when a node is selected (ESC to close). Each node type has its own panel layout with editable fields, sliders, tag inputs, relationship pickers, and section headers. World Core: identity, narrator, metrics, rules, difficulty, progression, outcomes. Character: identity, voice, emotional baseline, behavior triggers, secrets, NPC relationships. Group: identity, dynamics, disposition triggers, goals, relationships. Role: identity/authority/relations/objectives tabs. Event: identity, stakes, constraints, metric hints, narration. Initial State: metric values, relationships, progression, time context.",
      status: "backlog" as const,
      domain: "frontend",
      priority: "P1",
      assignee: SAM,
      sortOrder: 2,
      startDate: "2026-07-21",
      endDate: "2026-07-28",
    },
    {
      title: "Node CRUD + context menu",
      description:
        "Add Node menu (dropdown with all node types + Generate with AI option), right-click context menu (Edit Node, Duplicate, Connect to..., Move to Group, Assign to Event, AI Refine, Validate, Delete Node). Full create/read/update/delete for all node types with optimistic UI updates and API persistence.",
      status: "backlog" as const,
      domain: "frontend",
      priority: "P1",
      assignee: SAM,
      sortOrder: 3,
      startDate: "2026-07-21",
      endDate: "2026-07-28",
    },
    {
      title: "AI world generation",
      description:
        "Generate Simulation flow: user describes a world in a text prompt, selects difficulty and style, and the system generates a full world (~8 nodes) — World Core, Characters, Groups, Role, Events, Initial State. Multi-turn conversation for refinement before confirming. Preview step before committing nodes to canvas. Generates ~8 nodes from a single prompt, wired together with relationships and consistent metrics.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 4,
      startDate: "2026-07-28",
      endDate: "2026-08-04",
    },
    {
      title: "World validation + export",
      description:
        "Validate a world definition for completeness and consistency: required nodes present, relationships valid, metrics referenced correctly, events have valid actors, initial state covers all defined metrics. AI Refine action that suggests improvements. Export world as structured JSON that the simulation engine (narrator + characters) can consume at runtime. Save World persists to DB, Preview launches a read-only simulation preview.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P2",
      assignee: BINNY,
      sortOrder: 5,
      startDate: "2026-08-04",
      endDate: "2026-08-08",
    },
  ];

  for (const t of tickets) {
    const ticket = await ticketStore.create({
      featureId: feature.id,
      ...t,
    });
    console.log(`  Ticket: ${ticket.id} — ${ticket.title}`);
  }

  console.log("\nDone. Feature 4 seeded with 6 tickets.");
}

main().catch(console.error);
