import "dotenv/config";
import { getVersionStore, getFeatureStore, getTicketStore } from "@odyssey/db";

const BINNY = "1bdbaaf9-7850-46cc-896e-65945c023b06";
const SAM = "8730c64b-20ef-4ecd-8e0e-36bbb5b47746";
const JOSH = "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f";

const VERSION_ID = "960d73da-e68d-40ee-8e2a-da24028a517f";
const F1 = "9b4d4512-25c3-4bb0-be1f-56e1cb89092a";
const F2 = "6aa191bd-06ad-43e1-b3f4-3b2aae95b879";
const F3 = "070fd4af-9dc6-4e70-83ff-c175e1f94ca5";
const F4 = "7fec1926-1682-49b8-a5db-77413e801175";
const F5 = "e6f030de-8c1c-4722-956a-3c0ae7aaacb1";

async function main() {
  const versions = getVersionStore();
  const features = getFeatureStore();
  const tickets = getTicketStore();

  // ── Update version end date ──────────────────────────────────
  console.log("Updating version...");
  await versions.update(VERSION_ID, {
    startDate: "2026-04-16",
    endDate: "2026-07-08",
  });

  // ── Update feature dates ─────────────────────────────────────
  console.log("Updating feature dates...");
  await Promise.all([
    features.update(F1, { startDate: "2026-04-16", endDate: "2026-05-06" }),
    features.update(F2, { startDate: "2026-04-16", endDate: "2026-05-20" }),
    features.update(F3, { startDate: "2026-05-07", endDate: "2026-06-10" }),
    features.update(F4, { startDate: "2026-05-09", endDate: "2026-06-19" }),
    features.update(F5, { startDate: "2026-05-23", endDate: "2026-07-08" }),
  ]);

  // ── Feature 1: Live Voice Pipeline (Apr 16 – May 6) ─────────
  // Josh owns all 5 tickets — dates mostly unchanged
  console.log("Updating Feature 1 tickets...");
  await Promise.all([
    tickets.update("a3657f36-db6f-4669-bcf4-c4e18296ed93", { startDate: "2026-04-16", endDate: "2026-04-23" }),
    tickets.update("edbc72c2-88e5-4844-84bb-43bd34c6981d", { startDate: "2026-04-16", endDate: "2026-04-22" }),
    tickets.update("2375c16e-d84d-494d-bb06-81b5e8d8aca5", { startDate: "2026-04-23", endDate: "2026-04-30" }),
    tickets.update("ca908a50-0d69-4780-9b78-927c55508aff", { startDate: "2026-04-30", endDate: "2026-05-05" }),
    tickets.update("e01c70cb-c2d5-411e-8764-f961adbd3732", { startDate: "2026-05-01", endDate: "2026-05-06" }),
  ]);

  // ── Feature 2: Knowledge Graph (Apr 16 – May 20) ────────────
  // Starts DAY ONE in parallel with F1
  console.log("Updating Feature 2 tickets...");
  await Promise.all([
    tickets.update("96b92f4e-3e77-4306-8364-f964f6d4e145", { startDate: "2026-04-16", endDate: "2026-04-25" }), // Wiki schema (Binny)
    tickets.update("bf4bc97d-1191-409b-8aa0-c07e76713eda", { startDate: "2026-04-25", endDate: "2026-05-02" }), // Source ingestion (Binny)
    tickets.update("1d956bda-b635-43ea-bc54-33a3404f42be", { startDate: "2026-04-21", endDate: "2026-05-02" }), // Abraham corpus (Sam)
    tickets.update("7a0ccf27-4e58-48fc-9a6b-d3910fd2d561", { startDate: "2026-05-02", endDate: "2026-05-09" }), // Context curator (Binny)
    tickets.update("f256c63b-cf21-4bc9-89f8-681226265e31", { startDate: "2026-05-02", endDate: "2026-05-12" }), // KG admin UI (Sam)
    tickets.update("2246b7d2-406f-4cc2-9d7f-7bc3dce83039", { startDate: "2026-05-09", endDate: "2026-05-16" }), // Test chat (Sam)
    tickets.update("9b6b9084-7903-4ce1-8e2a-2147b6f5ebad", { startDate: "2026-05-14", endDate: "2026-05-20" }), // Secondary chars (Sam)
  ]);

  // ── Feature 3: Narrator / Orchestrator (May 7 – Jun 10) ─────
  console.log("Updating Feature 3 tickets...");
  await Promise.all([
    tickets.update("9db88e86-09d7-4411-a61a-54d788d991ad", { startDate: "2026-05-07", endDate: "2026-05-15" }), // Narrator identity (Sam)
    tickets.update("45ff6e5f-4ba7-4d01-b680-be5440e3fdae", { startDate: "2026-05-14", endDate: "2026-05-20" }), // World state schema (Binny)
    tickets.update("a6937085-3e49-4557-9da2-21bde241ade1", { startDate: "2026-05-20", endDate: "2026-05-27" }), // Scene intro engine (Binny)
    tickets.update("d6e04c34-5b9d-4be4-8a9e-851f5d712444", { startDate: "2026-05-27", endDate: "2026-06-02" }), // Player command router (Binny)
    tickets.update("37a869a3-1390-4123-b709-54f3357f5916", { startDate: "2026-06-02", endDate: "2026-06-08" }), // Character orchestration (Binny)
    tickets.update("76c39afc-f80f-4311-9a8b-d765ca4560d2", { startDate: "2026-06-06", endDate: "2026-06-10" }), // Event narration (Binny)
    tickets.update("65a353f2-4264-47df-bdae-a6d03d3ff766", { startDate: "2026-05-15", endDate: "2026-05-28" }), // Voice profiles (Sam)
    tickets.update("1249698d-253b-415a-a7ac-e94293508b0e", { startDate: "2026-05-28", endDate: "2026-06-10" }), // Abraham's Tent world def (Sam)
  ]);

  // ── NEW: Multi-voice TTS routing (Feature 3, Josh) ───────────
  console.log("Creating Josh's Feature 3 ticket...");
  const ttsTicket = await tickets.create({
    title: "Multi-voice TTS routing",
    description: "Extend the voice pipeline to support multiple distinct voices — narrator, Abraham, Sarah, and secondary characters each need their own TTS voice profile. Build the routing layer that maps character IDs to voice configurations and handles real-time voice switching during orchestrated scenes.",
    status: "backlog",
    domain: "voice",
    priority: "P1",
    assignee: JOSH,
    featureId: F3,
    sortOrder: 2,
    startDate: "2026-05-07",
    endDate: "2026-05-23",
  });
  console.log(`  Created: ${ttsTicket.id} — Multi-voice TTS routing`);

  // Bump sort orders for existing F3 tickets that were at sortOrder >= 2
  await Promise.all([
    tickets.update("a6937085-3e49-4557-9da2-21bde241ade1", { sortOrder: 3 }), // Scene intro (was 2)
    tickets.update("d6e04c34-5b9d-4be4-8a9e-851f5d712444", { sortOrder: 4 }), // Command router (was 3)
    tickets.update("37a869a3-1390-4123-b709-54f3357f5916", { sortOrder: 5 }), // Orchestration (was 4)
    tickets.update("76c39afc-f80f-4311-9a8b-d765ca4560d2", { sortOrder: 6 }), // Event narration (was 5)
    tickets.update("1249698d-253b-415a-a7ac-e94293508b0e", { sortOrder: 7 }), // World def (was 6)
    tickets.update("65a353f2-4264-47df-bdae-a6d03d3ff766", { sortOrder: 8 }), // Voice profiles (was 7)
  ]);

  // ── Feature 4: World Builder (May 9 – Jun 19) ───────────────
  // Binny does node schema early (May 9) to unblock Sam's canvas work
  console.log("Updating Feature 4 tickets...");
  await Promise.all([
    tickets.update("2e672aa8-f032-42fd-8e99-0c4faff22d77", { startDate: "2026-05-09", endDate: "2026-05-14" }), // Node schema (Binny)
    tickets.update("6da08207-4d61-45ad-b734-88929e25ac01", { startDate: "2026-05-28", endDate: "2026-06-05" }), // Canvas UI (Sam)
    tickets.update("b0db2b55-6eaa-415d-8635-f4d7b97a4833", { startDate: "2026-06-05", endDate: "2026-06-12" }), // Node sidebar (Sam)
    tickets.update("1082a238-fe5b-429c-95ef-5a86c9770ba7", { startDate: "2026-06-05", endDate: "2026-06-12" }), // Node CRUD (Sam)
    tickets.update("e4a4dd3e-99f4-4753-8ade-155a4bef7296", { startDate: "2026-06-10", endDate: "2026-06-16" }), // AI generation (Binny)
    tickets.update("53e65f37-c9ab-442f-a55e-e6a9e8ba3099", { startDate: "2026-06-16", endDate: "2026-06-19" }), // Validation + export (Binny)
    tickets.update("e97b6c15-822c-413c-9baa-46983e0de2fc", { startDate: "2026-06-12", endDate: "2026-06-19" }), // Abraham authoring (Sam)
  ]);

  // ── Feature 5: The Experience (May 23 – Jul 8) ──────────────
  console.log("Updating Feature 5 tickets...");
  await Promise.all([
    tickets.update("4c6a77a4-78cb-44dc-a232-bc0e454cfd81", { startDate: "2026-06-19", endDate: "2026-06-26" }), // Pipeline integration (Binny)
    tickets.update("089a0280-aa2d-47e2-bc73-72747e7abeb8", { startDate: "2026-06-26", endDate: "2026-07-01" }), // Session lifecycle (Binny)
    tickets.update("ae185388-30d1-438f-a888-9cdf15c54cb5", { startDate: "2026-06-19", endDate: "2026-06-30" }), // Player app UI (Sam)
    tickets.update("17d595c2-4e7f-48ee-a309-1e0da3d1d03b", { startDate: "2026-06-22", endDate: "2026-06-30" }), // Latency optimization (Binny)
    tickets.update("efcbe649-a622-42e4-bd3d-9a1ebd2e59df", { startDate: "2026-07-01", endDate: "2026-07-08" }), // Playtesting (Binny)
    tickets.update("8c4dfc63-a0a4-4eb7-94d2-d316c6e9c4c8", { startDate: "2026-06-19", endDate: "2026-06-30" }), // UX + experience design (Sam)
  ]);

  // ── NEW: Josh's early-start Feature 5 tickets ────────────────
  console.log("Creating Josh's Feature 5 tickets...");
  const appFoundation = await tickets.create({
    title: "Player app foundation + routing",
    description: "Build the player-facing app shell: Next.js routing, session entry flow, world selection screen, and the base layout that the voice experience runs inside. Establishes the foundation that Player app UI and voice activity detection build on.",
    status: "backlog",
    domain: "frontend",
    priority: "P1",
    assignee: JOSH,
    featureId: F5,
    sortOrder: 0,
    startDate: "2026-05-23",
    endDate: "2026-06-06",
  });
  console.log(`  Created: ${appFoundation.id} — Player app foundation + routing`);

  const vad = await tickets.create({
    title: "Voice activity detection + push-to-talk",
    description: "Implement player input modes for the voice experience: push-to-talk toggle and voice activity detection (VAD) that automatically detects when the player starts/stops speaking. Integrate with the WebSocket pipeline from Feature 1. Handle edge cases — background noise, interruptions, silence thresholds.",
    status: "backlog",
    domain: "frontend",
    priority: "P1",
    assignee: JOSH,
    featureId: F5,
    sortOrder: 1,
    startDate: "2026-06-06",
    endDate: "2026-06-17",
  });
  console.log(`  Created: ${vad.id} — Voice activity detection + push-to-talk`);

  // Bump existing F5 sort orders
  await Promise.all([
    tickets.update("4c6a77a4-78cb-44dc-a232-bc0e454cfd81", { sortOrder: 2 }), // Pipeline integration (was 0)
    tickets.update("089a0280-aa2d-47e2-bc73-72747e7abeb8", { sortOrder: 3 }), // Session lifecycle (was 1)
    tickets.update("ae185388-30d1-438f-a888-9cdf15c54cb5", { sortOrder: 4 }), // Player app UI (was 2)
    tickets.update("17d595c2-4e7f-48ee-a309-1e0da3d1d03b", { sortOrder: 5 }), // Latency optimization (was 3)
    tickets.update("8c4dfc63-a0a4-4eb7-94d2-d316c6e9c4c8", { sortOrder: 6 }), // UX + experience design (was 5)
    tickets.update("efcbe649-a622-42e4-bd3d-9a1ebd2e59df", { sortOrder: 7 }), // Playtesting (was 4)
  ]);

  console.log("\n✓ Timeline compressed — target: July 8, 2026");
  console.log("  Version: Apr 16 – Jul 8");
  console.log("  F1 Voice Pipeline:    Apr 16 – May 6   (Josh)");
  console.log("  F2 Knowledge Graph:   Apr 16 – May 20  (Binny + Sam) ← parallel with F1");
  console.log("  F3 Narrator:          May 7  – Jun 10  (Binny + Sam + Josh)");
  console.log("  F4 World Builder:     May 9  – Jun 19  (Binny + Sam) ← overlaps F3");
  console.log("  F5 The Experience:    May 23 – Jul 8   (All three) ← Josh starts early");
  console.log(`\n  New tickets created: 3`);
  console.log(`    - Multi-voice TTS routing (F3, Josh)`);
  console.log(`    - Player app foundation + routing (F5, Josh)`);
  console.log(`    - Voice activity detection + push-to-talk (F5, Josh)`);
  console.log(`\n  Total tickets: 36`);
}

main().catch(console.error);
