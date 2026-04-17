import "dotenv/config";
import { getFeatureStore, getTicketStore } from "@odyssey/db";

const VERSION_ID = "960d73da-e68d-40ee-8e2a-da24028a517f";
const BINNY_F1 = "ae8d8ca8-32fe-4e21-ac49-539d42a6c64f";
const BINNY = "1bdbaaf9-7850-46cc-896e-65945c023b06";

async function main() {
  const features = getFeatureStore();
  const tickets = getTicketStore();

  // ── Locate Feature 1 ──
  const existing = await features.list(VERSION_ID);
  const feature1 = existing.find(
    (f) => f.title === "Live Voice Pipeline — Abraham Demo Slice",
  );
  if (!feature1) throw new Error("Feature 1 not found");

  // ── Add 2 tickets to Feature 1 (voice design + STT biblical vocab) ──
  const f1Additions = [
    {
      title: "Abraham voice design + reference clip",
      description:
        "Record a reference clip in the target register (older, weathered, contemplative, masculine, no locked-in modern accent); transcribe with disfluencies preserved; run through Kyutai voice prep to produce the voice prompt. Iterate until the generated voice lands — first pass rarely does. Record multiple takes at slightly different paces since prosody gets baked into the voice prompt. Record in a treated space (or a parked car) — background noise leaks into every generated utterance.",
      status: "todo",
      domain: "world",
      priority: "P1",
      assignee: BINNY_F1,
      phase: "mvp",
      sortOrder: 5,
      startDate: "2026-04-23",
      endDate: "2026-04-30",
    },
    {
      title: "STT biblical-vocabulary prompt prefix",
      description:
        "Configure Kyutai STT --prompt_text with a short warmup containing the proper nouns the model will otherwise guess at — Sarah, Hagar, Moriah, Ishmael, Isaac, Melchizedek, Mamre, Canaan, Chaldees, Abimelech, Eliezer, Beersheba. Decide divine-name handling (YHWH / Adonai / El Shaddai). Keep the prefix under ~40 words; beyond that, diminishing returns.",
      status: "todo",
      domain: "engine",
      priority: "P1",
      assignee: BINNY_F1,
      phase: "mvp",
      sortOrder: 6,
      startDate: "2026-04-23",
      endDate: "2026-04-27",
    },
  ];
  for (const def of f1Additions) {
    const t = await tickets.create({ featureId: feature1.id, ...def });
    console.log(`  F1 ticket added: ${t.title}`);
  }

  // ── Bump sortOrder for any features at >=1 to make room for F1.5 ──
  const toShift = existing
    .filter((f) => f.sortOrder >= 1)
    .sort((a, b) => b.sortOrder - a.sortOrder);
  for (const f of toShift) {
    await features.update(f.id, { sortOrder: f.sortOrder + 1 });
    console.log(
      `  Bumped ${f.title}: ${f.sortOrder} → ${f.sortOrder + 1}`,
    );
  }

  // ── Create Feature 1.5: Voice Pipeline Hardening ──
  const f15 = await features.create({
    versionId: VERSION_ID,
    title: "Voice Pipeline Hardening",
    description:
      "Second pass on the Abraham voice loop — the craft work that makes it demo-ready. Adds framing & disclosure so users know what they're talking to, a moderation pass for adversarial prompts, barge-in so the agent feels alive instead of robotic, voice-specific prompt hardening (pacing, interpretation-vs-scripture, canonical self-identity), and an adversarial test rubric that catches regressions as the character evolves. The polish layer between 'the loop works' (F1) and the knowledge graph (F2).",
    color: "#6366F1",
    status: "planned",
    assignee: BINNY,
    startDate: "2026-05-07",
    endDate: "2026-05-29",
    sortOrder: 1,
  });
  console.log(`\nFeature created: ${f15.id} — ${f15.title}`);

  // ── F1.5 tickets ──
  const f15Tickets = [
    {
      title: "Framing & disclosure",
      description:
        "User-facing positioning copy and refusal patterns. Landing/entry disclosure that this is a dramatized educational conversation with a character from Genesis — not the historical patriarch, not the prophet. In-character intro handling. Refusal patterns for: blessing/prayer requests ('I am a character in a story, friend; your prayers belong to the One you address them to'), contemporary Middle East politics (firm out-of-scope), emotional crisis (break character, surface real resources), interfaith endorsement asks (Abraham predates all three traditions; honest answer is he can't). Produces both UI copy and system-prompt fragments.",
      status: "todo" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 0,
      startDate: "2026-05-07",
      endDate: "2026-05-11",
    },
    {
      title: "Moderation pass — adversarial prompt routing",
      description:
        "Pre-LLM classifier that catches clearly adversarial or inflammatory prompts (slurs, gotcha framings, attempts to make the character endorse violence or a religion) and routes them to a graceful in-character deflection instead of the full LLM. Logs hits for review and rubric updates. Kept light — target <100ms added latency. Complements, doesn't replace, the LLM system prompt.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 1,
      startDate: "2026-05-11",
      endDate: "2026-05-15",
    },
    {
      title: "Barge-in + interruption handling",
      description:
        "Let the user interrupt mid-response. Semantic VAD during TTS playback triggers TTS cut and state transition back to listening. Distinguish real interruption from backchannel ('mm-hmm', 'right'). State machine update: agent-speaking → (user-VAD) → listening → next turn. Without this the agent feels robotic — voice UX hinges on it.",
      status: "backlog" as const,
      domain: "engine",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 2,
      startDate: "2026-05-15",
      endDate: "2026-05-20",
    },
    {
      title: "Character prompt hardening (voice-specific)",
      description:
        "Tighten the Abraham system prompt for voice delivery: length/pacing guidance (2–4 sentences typical — you are speaking aloud, not writing), canonical 'are you real / what is your name' handling, the interpretation-vs-scripture boundary (speak thoughtfully from the character's implied perspective on what scripture doesn't say, but flag as interpretation rather than scripture), temporal filter (character only references events through Genesis 25 in-dialogue; later Genesis material and Quranic / rabbinic / hadith commentary only as out-of-character aside), no mid-dialogue source citations that break dramatic frame.",
      status: "backlog" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 3,
      startDate: "2026-05-18",
      endDate: "2026-05-22",
    },
    {
      title: "Adversarial test rubric + red-team pass",
      description:
        "Held-out set of 20–30 prompts covering every edge case: blessing / prayer requests, contemporary politics, emotional crisis, interfaith endorsement asks, 'are you real' queries, gotcha theology, asks for content outside Gen 25, attempts to make the character speak for God, attempts to get inflammatory quotes, attempts to induce hallucinated biblical text. Rubric scores each response (in-character? scripturally accurate? graceful refusal where required? latency within budget?). Re-run after every prompt, retrieval, or moderation change. The regression net that keeps the character trustworthy as it evolves.",
      status: "backlog" as const,
      domain: "world",
      priority: "P1",
      assignee: BINNY,
      sortOrder: 4,
      startDate: "2026-05-22",
      endDate: "2026-05-29",
    },
  ];

  for (const t of f15Tickets) {
    const ticket = await tickets.create({ featureId: f15.id, ...t });
    console.log(`  F1.5 ticket: ${ticket.id} — ${ticket.title}`);
  }

  console.log("\nDone. Feature 1.5 seeded with 5 tickets. F1 got 2 new tickets.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
