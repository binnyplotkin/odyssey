/**
 * Shared grounding-eval core: replay a turn through the real runVoiceStream and
 * judge whether the response is faithful to the context it was given. Used by both
 * the single-turn grader (grade-turn.ts) and the batch runner (batch-eval.ts) so the
 * judge prompt + replay live in ONE place.
 *
 * The judge separates two kinds of unsupported content:
 *   - FABRICATION  — a checkable world-fact (event/person/place/time/quote) not in
 *                    the context. A real hallucination; counts against faithfulness.
 *   - EMBELLISHMENT — sensory/atmospheric color (weather, light, sensation) that no
 *                    record could confirm or deny. Immersive, not a grounding failure;
 *                    surfaced separately, EXCLUDED from the score.
 */
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { getChatProviderForModel } from "@odyssey/engine";
import { runVoiceStream } from "@odyssey/voice-pipeline";

export const DEFAULT_JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-haiku-4-5";

export type ClaimKind =
  | "grounded-knowledge"
  | "grounded-identity"
  | "fabrication"
  | "embellishment";

export type GroundingClaim = { claim: string; kind: ClaimKind; evidence: string };

export type GroundingVerdict = {
  claims: GroundingClaim[];
  /** grounded / (grounded + fabrications) — embellishments EXCLUDED, so immersive
   *  color doesn't count against the character. 1.0 when there's nothing checkable. */
  faithfulnessScore: number;
  fabrications: string[];
  embellishments: string[];
  groundedCount: number;
  usedRetrievedKnowledge: boolean;
  verdict: "faithful" | "embellished" | "minor-fabrication" | "unfaithful";
  notes: string;
};

export type GradedTurn = {
  message: string;
  response: string;
  pageSlugs: string[];
  verdict: GroundingVerdict;
  judge: { model: string; inputTokens: number; outputTokens: number };
};

const JUDGE_SYSTEM = `You are a STRICT faithfulness evaluator for an AI character. A character was given CONTEXT (its identity/instructions + a RETRIEVED KNOWLEDGE section pulled from a knowledge graph) and produced a RESPONSE to a user. Categorize every CLAIM in the response.

First, IGNORE pure emotion, opinion, in-character style, and questions the character asks back — those are not claims and must not appear in your output.

For each remaining claim, assign exactly one "kind":
- "grounded-knowledge": a factual claim supported by the RETRIEVED KNOWLEDGE section.
- "grounded-identity": a factual claim supported by the identity/instructions.
- "fabrication": an UNSUPPORTED claim asserting a checkable WORLD-FACT — a specific event, person, place, time, name, relationship, quote, or number that is NOT in the context (or contradicts it). Real hallucinations. e.g. naming a place the character never went, quoting words no source records, inventing a relative/building, an out-of-scope historical detail.
- "embellishment": an UNSUPPORTED detail adding sensory/atmospheric/narrative COLOR that is not a checkable world-fact — weather, time of day, light, physical sensation, ambient scenery. e.g. "we rose before sunrise", "the cold wind bit the canvas", "the fire glowed". These enrich the telling without asserting anything verifiable.

DECISIVE TEST (fabrication vs embellishment): could a historian mark it true or false against the record? If yes and it is not in the context → fabrication. If it is mood/scenery no record could confirm or deny → embellishment.

For grounded claims, put the supporting context snippet in "evidence". For fabrication/embellishment, "evidence" may be "" or a brief note.

Output ONLY strictly valid JSON (no prose, no markdown fences):
{"claims":[{"claim":string,"kind":"grounded-knowledge"|"grounded-identity"|"fabrication"|"embellishment","evidence":string}],"usedRetrievedKnowledge":boolean,"notes":string}
CRITICAL: when quoting source text inside any string value, use single quotes ('), NEVER raw double quotes — an unescaped double quote breaks the parse.`;

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`no JSON object in judge output:\n${text.slice(0, 400)}`);
  return JSON.parse(body.slice(start, end + 1));
}

/** Replay one turn through the real pipeline (debug → full retrieval + captured
 *  context) and return the response + the context the character actually saw. */
export async function replayTurn(
  characterId: string,
  message: string,
): Promise<{ response: string; systemPrompt: string; promptChunk: string; pageSlugs: string[] }> {
  const character =
    (await getCharacterStore().getById(characterId)) ??
    (await getCharacterStore().getBySlug(characterId));
  if (!character) throw new Error(`character "${characterId}" not found`);

  const session = await getSceneSessionStore().createSession({ characterId: character.id, mode: "voice" });
  const turnId = crypto.randomUUID();

  let response = "";
  const controller = new AbortController();
  for await (const ev of runVoiceStream(
    { characterId: character.id, message, sessionId: session.id, turnId, debug: true },
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
  const pages = (build?.selectedPages ?? []) as Array<{ page?: { slug?: string } }>;
  return {
    response,
    systemPrompt: build?.systemPrompt ?? "",
    promptChunk: build?.promptChunk ?? "",
    pageSlugs: pages.map((p) => p.page?.slug ?? "?"),
  };
}

/** Compute the verdict from categorized claims — embellishments excluded from the score. */
function scoreClaims(
  claims: GroundingClaim[],
  usedRetrievedKnowledge: boolean,
  notes: string,
): GroundingVerdict {
  const grounded = claims.filter(
    (c) => c.kind === "grounded-knowledge" || c.kind === "grounded-identity",
  );
  const fabrications = claims.filter((c) => c.kind === "fabrication");
  const embellishments = claims.filter((c) => c.kind === "embellishment");
  const denom = grounded.length + fabrications.length;
  const faithfulnessScore = denom === 0 ? 1 : grounded.length / denom;
  const verdict: GroundingVerdict["verdict"] =
    fabrications.length === 0
      ? embellishments.length > 0
        ? "embellished"
        : "faithful"
      : fabrications.length === 1
        ? "minor-fabrication"
        : "unfaithful";
  return {
    claims,
    faithfulnessScore,
    fabrications: fabrications.map((c) => c.claim),
    embellishments: embellishments.map((c) => c.claim),
    groundedCount: grounded.length,
    usedRetrievedKnowledge,
    verdict,
    notes,
  };
}

/** Judge whether `response` is faithful to the context the character was given. */
export async function gradeGrounding(input: {
  message: string;
  response: string;
  systemPrompt: string;
  promptChunk: string;
  judgeModel?: string;
}): Promise<GroundingVerdict & { judge: GradedTurn["judge"] }> {
  const judgeModel = input.judgeModel ?? DEFAULT_JUDGE_MODEL;
  const judgeUser = `## CONTEXT GIVEN TO THE CHARACTER

### Identity & instructions (+ any retrieved knowledge is embedded here)
${input.systemPrompt || "(none)"}

### RETRIEVED KNOWLEDGE section (from the knowledge graph)
${input.promptChunk || "(none retrieved)"}

## USER MESSAGE
${input.message}

## CHARACTER RESPONSE
${input.response}

Categorize every claim per the rules. Output JSON only.`;

  const provider = getChatProviderForModel(judgeModel);
  const call = (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    provider.complete({
      model: judgeModel,
      system: [{ type: "text", text: JUDGE_SYSTEM }],
      messages,
      maxTokens: 1500,
      temperature: 0,
    });

  let res = await call([{ role: "user", content: judgeUser }]);
  let inputTokens = res.inputTokens;
  let outputTokens = res.outputTokens;
  let parsed: { claims?: GroundingClaim[]; usedRetrievedKnowledge?: boolean; notes?: string };
  try {
    parsed = extractJson(res.text) as typeof parsed;
  } catch {
    // Repair pass: the model occasionally emits an unescaped quote. Hand its own
    // output back and ask for strictly valid JSON (a plain retry would repeat it).
    res = await call([
      { role: "user", content: judgeUser },
      { role: "assistant", content: res.text },
      {
        role: "user",
        content:
          "That was not valid JSON (likely an unescaped double quote in a string). Output the SAME evaluation again as STRICTLY valid, parseable JSON only — replace any double quotes inside string values with single quotes.",
      },
    ]);
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    parsed = extractJson(res.text) as typeof parsed;
  }

  const verdict = scoreClaims(
    parsed.claims ?? [],
    Boolean(parsed.usedRetrievedKnowledge),
    parsed.notes ?? "",
  );
  return { ...verdict, judge: { model: judgeModel, inputTokens, outputTokens } };
}

/** Replay + grade in one call. `responseOverride` grades an injected/external answer
 *  against the character's real retrieved context (used to validate the judge). */
export async function replayAndGrade(opts: {
  characterId: string;
  message: string;
  judgeModel?: string;
  responseOverride?: string;
}): Promise<GradedTurn> {
  const { response, systemPrompt, promptChunk, pageSlugs } = await replayTurn(
    opts.characterId,
    opts.message,
  );
  const toGrade = opts.responseOverride?.trim() || response;
  if (!toGrade.trim()) throw new Error("no response generated — cannot grade");
  const graded = await gradeGrounding({
    message: opts.message,
    response: toGrade,
    systemPrompt,
    promptChunk,
    judgeModel: opts.judgeModel,
  });
  const { judge, ...verdict } = graded;
  return { message: opts.message, response: toGrade, pageSlugs, verdict, judge };
}

/** Bounded-concurrency map — replays + judge calls fan out without overwhelming the
 *  DB / judge API. Order preserved. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
