import "dotenv/config";
import { getVersionStore, getFeatureStore, getTicketStore } from "@odyssey/db";

async function seed() {
  const versions = getVersionStore();
  const features = getFeatureStore();
  const tickets = getTicketStore();

  // ── Clean up old tickets ──
  const existing = await tickets.list();
  for (const t of existing) {
    await tickets.remove(t.id);
  }
  const existingFeatures = await features.list();
  for (const f of existingFeatures) {
    await features.remove(f.id);
  }
  const existingVersions = await versions.list();
  for (const v of existingVersions) {
    await versions.remove(v.id);
  }

  console.log("Cleared old data.");

  // ── Version: Abraham's Tent MVP ──
  const version = await versions.create({
    tag: "v0.1",
    title: "Abraham's Tent MVP",
    description: "Voice-first AI simulation demo — prove the core conversation loop with Abraham.",
    color: "#3B82F6",
    status: "active",
    startDate: "2026-04-15",
    endDate: "2026-06-30",
    sortOrder: 0,
  });
  console.log(`Created version: ${version.title} (${version.id})`);

  // ── Feature 1: Live Voice Pipeline ──
  const feature = await features.create({
    versionId: version.id,
    title: "Live Voice Pipeline — Abraham Demo Slice",
    description: "End-to-end voice conversation: Kyutai STT → Claude LLM → Kyutai TTS over WebSocket. Prove the loop works.",
    color: "#8B5CF6",
    status: "planned",
    assignee: "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f",
    startDate: "2026-04-15",
    endDate: "2026-05-09",
    sortOrder: 0,
  });
  console.log(`Created feature: ${feature.title} (${feature.id})`);

  // ── Tickets ──
  const ticketDefs = [
    {
      title: "Host Kyutai STT + TTS",
      description: "Evaluate GPU providers, stand up Kyutai inference servers for both STT and TTS, benchmark latency baselines.",
      status: "todo",
      domain: "infra",
      priority: "P1",
      assignee: "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f",
      phase: "mvp",
      startDate: "2026-04-15",
      endDate: "2026-04-22",
    },
    {
      title: "Basic Abraham system prompt",
      description: "Write the Abraham character system prompt — personality, voice, boundaries. No RAG, no corpus. Test in text via Claude API.",
      status: "todo",
      domain: "world",
      priority: "P1",
      assignee: "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f",
      phase: "mvp",
      startDate: "2026-04-15",
      endDate: "2026-04-22",
    },
    {
      title: "WebSocket streaming",
      description: "Full-duplex audio streaming between browser and server via WebSocket. Replace current REST request-response flow.",
      status: "todo",
      domain: "frontend",
      priority: "P1",
      assignee: "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f",
      phase: "mvp",
      startDate: "2026-04-22",
      endDate: "2026-04-29",
    },
    {
      title: "Wire voice pipeline end-to-end",
      description: "Connect the full loop: browser mic → Kyutai STT → Claude LLM → Kyutai TTS → audio playback. Prove the conversation works.",
      status: "backlog",
      domain: "engine",
      priority: "P1",
      assignee: "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f",
      phase: "mvp",
      startDate: "2026-04-29",
      endDate: "2026-05-06",
    },
    {
      title: "Demo UI",
      description: "New or refined console UI for the voice conversation experience. Waveform, recording, playback, character presence.",
      status: "backlog",
      domain: "frontend",
      priority: "P1",
      assignee: "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f",
      phase: "mvp",
      startDate: "2026-04-29",
      endDate: "2026-05-09",
    },
  ];

  for (const def of ticketDefs) {
    const ticket = await tickets.create({ ...def, featureId: feature.id });
    console.log(`  Created ticket: ${ticket.title} (${ticket.id})`);
  }

  console.log("\nDone. Feature 1 seeded.");
}

seed().catch(console.error);
