/**
 * Grounding judge — does the character's response stay faithful to the knowledge
 * it was actually given?
 *
 * Replays one turn through the real runVoiceStream (debug mode → full retrieval +
 * captured context), then asks an LLM judge to classify each factual claim in the
 * response as supported (by the provided identity + retrieved knowledge) or NOT
 * (parametric memory / hallucination). Outputs a grounding score + the unsupported
 * claims + whether the answer actually drew on the retrieved knowledge graph.
 *
 *   EMBEDDING_PROVIDER=openai npx tsx --env-file=.env \
 *     packages/voice-pipeline/scripts/grade-turn.ts <characterSlug> "<message>"
 *
 * JUDGE_MODEL overrides the judge (default claude-haiku-4-5).
 */
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { getChatProviderForModel } from "@odyssey/engine";
import { runVoiceStream } from "@odyssey/voice-pipeline";

const CHARACTER = process.argv[2] ?? "abraham";
const MESSAGE = process.argv[3] ?? "Sarah laughed when she heard. Were you afraid to believe the promise?";
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-haiku-4-5";

const JUDGE_SYSTEM = `You are a STRICT grounding evaluator for an AI character system. A character was given CONTEXT (its identity/instructions + a RETRIEVED KNOWLEDGE section pulled from a knowledge graph) and produced a RESPONSE to a user. Determine whether the response's FACTUAL claims are supported by that context.

Rules:
- A "factual claim" is a statement asserting something about events, people, relationships, places, times, or facts. IGNORE emotional expression, first-person feeling, opinion, in-character style, and questions the character asks back — those are not factual claims.
- A claim is SUPPORTED only if the provided context backs it. A claim that is TRUE in general/world knowledge but NOT present in the context is UNSUPPORTED — the character is leaning on parametric memory rather than its grounded knowledge. Mark its source "none".
- For supported claims, set source to "knowledge" if backed by the RETRIEVED KNOWLEDGE section, or "identity" if backed by the identity/instructions.
- Be precise and conservative.

Output ONLY valid JSON (no prose, no markdown fences) with this shape:
{"claims":[{"claim":string,"supported":boolean,"source":"knowledge"|"identity"|"none","evidence":string}],"groundingScore":number,"unsupported":string[],"usedRetrievedKnowledge":boolean,"verdict":"grounded"|"partial"|"ungrounded","notes":string}
groundingScore = fraction of factual claims that are supported (0..1).`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`no JSON object in judge output:\n${text.slice(0, 400)}`);
  return JSON.parse(body.slice(start, end + 1));
}

async function main() {
  const character =
    (await getCharacterStore().getById(CHARACTER)) ??
    (await getCharacterStore().getBySlug(CHARACTER));
  if (!character) {
    console.error(`character "${CHARACTER}" not found`);
    process.exit(1);
  }
  const session = await getSceneSessionStore().createSession({ characterId: character.id, mode: "voice" });
  const turnId = crypto.randomUUID();

  // Replay the real turn (debug → full retrieval + captured context).
  const controller = new AbortController();
  let response = "";
  for await (const ev of runVoiceStream(
    { characterId: character.id, message: MESSAGE, sessionId: session.id, turnId, debug: true },
    { signal: controller.signal },
  )) {
    if (ev.event === "token") response += (ev.data as { delta: string }).delta;
  }

  const store = getSceneSessionStore();
  let detail = await store.getSessionDetail(session.id);
  for (let i = 0; i < 12 && !detail?.turns?.length; i++) {
    await new Promise((r) => setTimeout(r, 300));
    detail = await store.getSessionDetail(session.id);
  }
  const build = detail?.contextBuilds?.[0] ?? null;
  const systemPrompt = build?.systemPrompt ?? "";
  const promptChunk = build?.promptChunk ?? "";
  const pages = (build?.selectedPages ?? []) as Array<{ page?: { slug?: string } }>;
  const pageSlugs = pages.map((p) => p.page?.slug ?? "?");

  // GRADE_RESPONSE lets us judge an arbitrary response against the character's real
  // retrieved context — used to validate the judge discriminates (inject a known
  // hallucination and confirm it's flagged), or to grade an externally-captured turn.
  const responseToGrade = process.env.GRADE_RESPONSE?.trim() || response;
  if (!responseToGrade.trim()) {
    console.error("no response generated — cannot grade");
    process.exit(1);
  }
  if (process.env.GRADE_RESPONSE) console.log("(grading an injected response, not the character's)");

  // Judge.
  const judgeUser = `## CONTEXT GIVEN TO THE CHARACTER

### Identity & instructions (+ any retrieved knowledge is embedded here)
${systemPrompt || "(none)"}

### RETRIEVED KNOWLEDGE section (from the knowledge graph)
${promptChunk || "(none retrieved)"}

## USER MESSAGE
${MESSAGE}

## CHARACTER RESPONSE
${responseToGrade}

Evaluate grounding per the rules. Output JSON only.`;

  const provider = getChatProviderForModel(JUDGE_MODEL);
  const res = await provider.complete({
    model: JUDGE_MODEL,
    system: [{ type: "text", text: JUDGE_SYSTEM }],
    messages: [{ role: "user", content: judgeUser }],
    maxTokens: 1500,
    temperature: 0,
  });

  const verdict = extractJson(res.text) as {
    claims?: Array<{ claim: string; supported: boolean; source: string; evidence: string }>;
    groundingScore?: number;
    unsupported?: string[];
    usedRetrievedKnowledge?: boolean;
    verdict?: string;
    notes?: string;
  };

  console.log("═══ GROUNDING GRADE ═══════════════════════════════════════════════");
  console.log(`character : ${character.title} (${character.slug})`);
  console.log(`message   : "${MESSAGE}"`);
  console.log(`response  : ${responseToGrade.replace(/\s+/g, " ").trim()}`);
  console.log(`retrieved : ${pageSlugs.length ? pageSlugs.join(", ") : "(none)"}`);
  console.log("");
  const score = typeof verdict.groundingScore === "number" ? verdict.groundingScore.toFixed(2) : "?";
  console.log(
    `VERDICT   : ${verdict.verdict ?? "?"}  ·  grounding ${score}  ·  used retrieved knowledge: ${verdict.usedRetrievedKnowledge ? "yes" : "no"}`,
  );
  console.log("\nclaims:");
  for (const c of verdict.claims ?? []) {
    const mark = c.supported ? "✓" : "✗";
    const src = c.supported ? `[${c.source}]` : "[UNSUPPORTED]";
    console.log(`  ${mark} ${src} ${c.claim}`);
    if (c.evidence && c.evidence !== "none") console.log(`        ↳ ${c.evidence.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  if (verdict.unsupported?.length) {
    console.log("\n⚠ unsupported claims (parametric / hallucinated):");
    for (const u of verdict.unsupported) console.log(`  - ${u}`);
  }
  if (verdict.notes) console.log(`\nnotes: ${verdict.notes}`);
  console.log(`\njudge: ${JUDGE_MODEL} (in=${res.inputTokens} out=${res.outputTokens})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
