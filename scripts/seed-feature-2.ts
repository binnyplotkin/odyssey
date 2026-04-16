import "dotenv/config";
import { getVersionStore, getFeatureStore, getTicketStore } from "@odyssey/db";

const VERSION_ID = "960d73da-e68d-40ee-8e2a-da24028a517f";
const BINNY = "1bdbaaf9-7850-46cc-896e-65945c023b06";
const SAM = "8730c64b-20ef-4ecd-8e0e-36bbb5b47746";

async function main() {
  const featureStore = getFeatureStore();
  const ticketStore = getTicketStore();

  // Create Feature 2
  const feature = await featureStore.create({
    versionId: VERSION_ID,
    title: "Character Knowledge Graph",
    description:
      "A persistent, LLM-maintained wiki per character that compiles source material into structured, interlinked knowledge pages — entity, event, concept, relationship, timeline, and voice/identity pages. Replaces naive RAG with a pre-synthesized knowledge base that compounds over time. Includes a real-time context curator for the voice pipeline and a testing UI with live graph visualization.",
    color: "#7C5CFC",
    status: "planned",
    assignee: BINNY,
    startDate: "2026-05-05",
    endDate: "2026-06-06",
    sortOrder: 1,
  });

  console.log(`Feature created: ${feature.id} — ${feature.title}`);

  const tickets = [
    {
      title: "Wiki schema + infrastructure",
      description:
        "Define the directory structure, page format conventions (frontmatter, wikilinks), schema document, index.md and log.md patterns. Establish the foundation that governs how the LLM creates, updates, and cross-references wiki pages. Define page types: entity, event, concept, relationship, timeline, voice/identity.",
      status: "todo" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 0,
      startDate: "2026-05-05",
      endDate: "2026-05-12",
    },
    {
      title: "Source ingestion pipeline",
      description:
        "Build the pipeline that takes raw source documents (text, markdown), processes them through the LLM, and generates/updates wiki pages. Includes the ingest workflow, page creation and update logic, cross-reference maintenance, index and log updates. A single source ingestion may touch 10-15 wiki pages.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 1,
      startDate: "2026-05-12",
      endDate: "2026-05-19",
    },
    {
      title: "Abraham corpus ingestion",
      description:
        "Ingest Genesis 11–25 as the first source corpus. LLM builds out the full Abraham knowledge graph: entity pages (Abraham, Sarah, Isaac, Eliezer, angels, Melchizedek), event pages (covenant, binding, three visitors, Sodom, Hagar), concept pages (hospitality, faith, covenant theology), relationship pages, timeline with temporal awareness, and voice/identity pages.",
      status: "backlog" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 2,
      startDate: "2026-05-19",
      endDate: "2026-05-26",
    },
    {
      title: "Context curator",
      description:
        "Runtime component wired into the voice pipeline orchestrator. Reads the wiki index, follows links based on conversation context, selects and ranks the most relevant pages, and injects them into the LLM prompt window. Replaces naive top-k retrieval with graph-aware context selection that respects character perspective and temporal awareness.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 3,
      startDate: "2026-05-23",
      endDate: "2026-05-30",
    },
    {
      title: "Knowledge graph admin UI",
      description:
        "Admin platform UI for browsing and managing the character knowledge graph. Page browser with search, graph visualization showing nodes and edges, page detail view with rendered markdown, ability to edit pages, see metadata (source count, last updated, inbound/outbound links). Part of the admin app.",
      status: "backlog" as const,
      domain: "frontend",
      priority: "P2",
      assignee: SAM,
      sortOrder: 4,
      startDate: "2026-05-26",
      endDate: "2026-06-02",
    },
    {
      title: "Character test chat with live graph",
      description:
        "Testing interface where you converse with the character in text and see the knowledge graph working in real time: which wiki pages are being pulled into context, the graph highlighting active nodes, token budget usage. Includes ability to add/edit sources and watch the graph update. The primary tool for validating character quality and knowledge coverage.",
      status: "backlog" as const,
      domain: "frontend",
      priority: "P1",
      assignee: SAM,
      sortOrder: 5,
      startDate: "2026-05-30",
      endDate: "2026-06-06",
    },
  ];

  for (const t of tickets) {
    const ticket = await ticketStore.create({
      featureId: feature.id,
      ...t,
    });
    console.log(`  Ticket: ${ticket.id} — ${ticket.title}`);
  }

  console.log("\nDone. Feature 2 seeded with 6 tickets.");
}

main().catch(console.error);
