/**
 * Turn replay — the character-debugging microscope.
 *
 * Runs ONE turn from a text message through the EXACT same `runVoiceStream`
 * pipeline the voice agent uses (retrieve → curate → brain → TTS), then dumps the
 * complete persisted record: the curated knowledge-graph pages, the curator
 * traversal (seeds/edges/drops), the full prompt sent to the LLM, the response,
 * and the latency/token breakdown. Deterministic and mic-free — the fast inner
 * loop for debugging prompt + graph + output.
 *
 *   npx tsx --env-file=services/voice-agent/.env \
 *     packages/voice-pipeline/scripts/replay-turn.ts <characterSlugOrId> "<message>"
 *
 * Flags the capture GAPS (raw retrieval scores, exact messages array) so we know
 * what Phase 1 still needs to record.
 */
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { runVoiceStream } from "@odyssey/voice-pipeline";

const CHARACTER = process.argv[2] ?? "abraham";
const MESSAGE = process.argv[3] ?? "Tell me about the hardest thing you've ever been asked to do.";

const rule = (label: string) => console.log(`\n── ${label} ${"─".repeat(Math.max(0, 64 - label.length))}`);
const chars = (s: string | null | undefined) => (s ? `${s.length} chars` : "—");

async function main() {
  const character =
    (await getCharacterStore().getById(CHARACTER)) ??
    (await getCharacterStore().getBySlug(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }

  const session = await getSceneSessionStore().createSession({
    characterId: character.id,
    mode: "voice",
  });
  // Persistence is gated on BOTH sessionId + turnId (run-voice-stream.ts:766) — pass
  // a turnId or the context build + turn record never get written.
  const turnId = crypto.randomUUID();

  console.log("═══ TURN REPLAY ═══════════════════════════════════════════════════");
  console.log(`character : ${character.title} (${character.slug})  id=${character.id}`);
  console.log(`message   : "${MESSAGE}"`);
  console.log(`session   : ${session.id}`);

  // Run the real pipeline. We ignore audio frames (debugging the brain, not TTS),
  // but collect the streamed response + final metrics as a cross-check.
  const controller = new AbortController();
  let response = "";
  let firstAudioMs = 0;
  let streamError: string | null = null;
  let debug: {
    retrievalHits?: Array<{ slug: string; similarity: number }>;
    system?: Array<{ text: string }>;
    messages?: Array<{ role: string; content: string }>;
  } | null = null;
  const traceNames: string[] = [];
  let embedMeta: Record<string, unknown> | null = null;
  let embedFallback: Record<string, unknown> | null = null;
  const startedAt = Date.now();
  try {
    // debug: true → emit raw retrieval hits + the exact messages array, and run
    // retrieval to completion (bypass the latency budget) so the graph is captured.
    for await (const ev of runVoiceStream(
      { characterId: character.id, message: MESSAGE, sessionId: session.id, turnId, debug: true },
      { signal: controller.signal },
    )) {
      if (ev.event === "token") response += (ev.data as { delta: string }).delta;
      else if (ev.event === "first-audio") firstAudioMs = (ev.data as { latencyMs: number }).latencyMs;
      else if (ev.event === "debug") debug = ev.data as typeof debug;
      else if (ev.event === "trace") {
        const t = ev.data as { events?: Array<{ name: string; meta?: Record<string, unknown> }> };
        for (const e of t.events ?? []) {
          traceNames.push(e.name);
          if (e.name === "server.retrieval.embedded") embedMeta = e.meta ?? null;
          if (e.name === "server.retrieval.embedder_fallback") embedFallback = e.meta ?? null;
        }
      } else if (ev.event === "error") streamError = JSON.stringify(ev.data);
    }
  } catch (err) {
    streamError = err instanceof Error ? err.message : String(err);
  }
  const wallMs = Date.now() - startedAt;

  // Read back what got persisted — the structured record the inspector renders.
  // The turn's persistence flushes shortly AFTER the `done` event (some writes are
  // off the hot path), so poll until the turn lands rather than racing it.
  const store = getSceneSessionStore();
  let detail = await store.getSessionDetail(session.id);
  for (let i = 0; i < 12 && !detail?.turns?.length; i++) {
    await new Promise((r) => setTimeout(r, 300));
    detail = await store.getSessionDetail(session.id);
  }
  const build = detail?.contextBuilds?.[0] ?? null;
  const turn = detail?.turns?.[0] ?? null;

  // ── INPUT: raw retrieval — what MATCHED the query, pre-curation ──
  rule("INPUT · RETRIEVAL (raw pgvector hits)");
  console.log(
    `embedder: ${embedMeta?.embedder ?? "?"} (${embedMeta?.dims ?? "?"} dims)${embedFallback ? `  ⚠ FELL BACK: ${embedFallback.from}→${embedFallback.to} (${embedFallback.message})` : ""}`,
  );
  const hits = debug?.retrievalHits ?? [];
  if (hits.length) {
    for (const h of hits) console.log(`  • ${h.slug}  similarity=${Number(h.similarity).toFixed(4)}`);
  } else {
    console.log("  (0 semantic hits — curator fell back to activation/alias matching)");
  }

  // ── INPUT: knowledge graph (what the curator selected from the hits) ──
  rule("INPUT · KNOWLEDGE GRAPH (curated)");
  if (build) {
    const pages = (build.selectedPages ?? []) as Array<Record<string, unknown>>;
    console.log(`selected pages: ${pages.length}  ·  tokens ${build.tokensUsed}/${build.tokensBudget}`);
    for (const p of pages.slice(0, 12)) {
      const page = p.page as { slug?: string; title?: string } | undefined;
      console.log(
        `  • ${page?.slug ?? "?"}  [${p.rendering}]  score=${Number(p.score).toFixed(3)}  origin=${p.origin}  tokens=${p.tokens}`,
      );
    }
    const tr = (build.curatorTrace ?? {}) as Record<string, any>;
    console.log(
      `curator: totalPages=${tr.totalPages ?? "?"} seeds=${(tr.seeds ?? []).length} edges=${(tr.edges ?? []).length} timeGated=${(tr.timelineFiltered ?? []).length} scoreDropped=${(tr.scoreDropped ?? []).length} budgetDropped=${(tr.budgetDropped ?? []).length}`,
    );
    for (const s of (tr.seeds ?? []).slice(0, 8)) {
      console.log(`    seed  ${s.slug}  (${s.reason ?? "?"}, score=${s.score ?? "?"})`);
    }
    for (const e of (tr.edges ?? []).slice(0, 10)) {
      console.log(`    edge  ${e.fromSlug} → ${e.toSlug}  (${e.kind}, +${e.contribution ?? "?"})`);
    }
  } else {
    console.log("(no context build persisted — retrieval may have been skipped)");
  }

  // ── INPUT: the prompt actually sent to the LLM ──
  rule("INPUT · PROMPT (as sent to the brain)");
  if (build) {
    console.log(`system prompt (${chars(build.systemPrompt)}):`);
    console.log(indent(build.systemPrompt ?? "(none)"));
    console.log(`\nprompt chunk / injected knowledge (${chars(build.promptChunk)}):`);
    console.log(indent(build.promptChunk ?? "(none)"));
  }
  // ── INPUT: the exact messages array as the model received it ──
  rule("INPUT · MESSAGES (as sent to the brain)");
  const messages = debug?.messages ?? [];
  if (messages.length) {
    for (const m of messages) console.log(`  [${m.role}] ${truncate(m.content, 400)}`);
  } else {
    console.log("  (none captured — no debug event)");
  }

  // ── OUTPUT ──
  rule("OUTPUT · RESPONSE");
  console.log(indent(turn?.assistantText || response || "(no response)"));
  const lat = (turn?.latencySummary ?? {}) as Record<string, unknown>;
  const tok = (turn?.tokenUsage ?? {}) as Record<string, unknown>;
  rule("OUTPUT · MEASURE");
  console.log(`tokens   : in=${tok.input ?? "?"} out=${tok.output ?? "?"} cost=$${tok.estimatedCostUsd ?? "?"}`);
  console.log(
    `latency  : firstToken=${lat.brainFirstTokenMs ?? "?"}ms firstAudio=${firstAudioMs || (lat.firstAudioMs ?? "?")}ms total=${lat.totalMs ?? wallMs}ms (wall ${wallMs}ms)`,
  );
  console.log(`trace pts: ${traceNames.length} (${[...new Set(traceNames)].slice(0, 12).join(", ")}…)`);
  if (streamError) console.log(`stream error: ${streamError}`);

  rule("CAPTURE");
  console.log(
    "  ✓ raw retrieval hits + scores   ✓ curated graph + edges   ✓ full prompt   ✓ messages array",
  );
  console.log(`\ninspect in the UI: /sessions/${session.id}`);
  process.exit(0);
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}… (+${flat.length - n} chars)` : flat;
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => `  │ ${l}`)
    .join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
