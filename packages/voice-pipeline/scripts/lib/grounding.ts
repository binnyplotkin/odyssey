/**
 * Shared grounding-eval core: replay a turn through the real runVoiceStream and
 * judge whether the response is grounded in the context it was given. Used by both
 * the single-turn grader (grade-turn.ts) and the batch runner (batch-eval.ts) so the
 * judge prompt + replay live in ONE place.
 */
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { getChatProviderForModel } from "@odyssey/engine";
import { runVoiceStream } from "@odyssey/voice-pipeline";

export const DEFAULT_JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-haiku-4-5";

export type GroundingClaim = {
  claim: string;
  supported: boolean;
  source: "knowledge" | "identity" | "none" | string;
  evidence: string;
};

export type GroundingVerdict = {
  claims: GroundingClaim[];
  groundingScore: number;
  unsupported: string[];
  usedRetrievedKnowledge: boolean;
  verdict: "grounded" | "partial" | "ungrounded" | string;
  notes: string;
};

export type GradedTurn = {
  message: string;
  response: string;
  pageSlugs: string[];
  verdict: GroundingVerdict;
  judge: { model: string; inputTokens: number; outputTokens: number };
};

const JUDGE_SYSTEM = `You are a STRICT grounding evaluator for an AI character system. A character was given CONTEXT (its identity/instructions + a RETRIEVED KNOWLEDGE section pulled from a knowledge graph) and produced a RESPONSE to a user. Determine whether the response's FACTUAL claims are supported by that context.

Rules:
- A "factual claim" is a statement asserting something about events, people, relationships, places, times, or facts. IGNORE emotional expression, first-person feeling, opinion, in-character style, and questions the character asks back — those are not factual claims.
- A claim is SUPPORTED only if the provided context backs it. A claim that is TRUE in general/world knowledge but NOT present in the context is UNSUPPORTED — the character is leaning on parametric memory rather than its grounded knowledge. Mark its source "none".
- For supported claims, set source to "knowledge" if backed by the RETRIEVED KNOWLEDGE section, or "identity" if backed by the identity/instructions.
- Be precise and conservative.

Output ONLY valid JSON (no prose, no markdown fences) with this shape:
{"claims":[{"claim":string,"supported":boolean,"source":"knowledge"|"identity"|"none","evidence":string}],"groundingScore":number,"unsupported":string[],"usedRetrievedKnowledge":boolean,"verdict":"grounded"|"partial"|"ungrounded","notes":string}
groundingScore = fraction of factual claims that are supported (0..1).
CRITICAL: the output must be STRICTLY parseable JSON. When quoting source text inside any string value, use single quotes ('), NEVER raw double quotes — an unescaped double quote will break the parse.`;

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

/** Judge whether `response` is grounded in the context the character was given. */
export async function gradeGrounding(input: {
  message: string;
  response: string;
  systemPrompt: string;
  promptChunk: string;
  judgeModel?: string;
}): Promise<GradedTurn["verdict"] & { judge: GradedTurn["judge"] }> {
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

Evaluate grounding per the rules. Output JSON only.`;

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
  let parsed: GroundingVerdict;
  try {
    parsed = extractJson(res.text) as GroundingVerdict;
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
    parsed = extractJson(res.text) as GroundingVerdict;
  }
  return {
    ...parsed,
    judge: { model: judgeModel, inputTokens, outputTokens },
  };
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
