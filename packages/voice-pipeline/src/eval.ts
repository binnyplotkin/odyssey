/**
 * Turn evaluation — LLM judges that grade a SINGLE turn on two axes:
 *   - FAITHFULNESS: are the response's factual claims grounded in the context it was
 *     given? Splits real fabrication from harmless sensory embellishment.
 *   - IN-CHARACTER QUALITY: does the response embody the character's defined voice /
 *     persona / scope (the systemPrompt rubric)?
 *
 * Pure + transport-agnostic: each judge takes the turn's text (message, response,
 * systemPrompt, promptChunk) and returns a structured verdict. No replay, no DB — so
 * the same functions grade a live turn (the CLI replays first) OR a persisted past
 * turn (the /sessions route reads it from the DB). The judge model is configurable
 * via JUDGE_MODEL (default claude-haiku-4-5).
 */
import { getChatProviderForModel } from "@odyssey/engine";

export const DEFAULT_JUDGE_MODEL = process.env.JUDGE_MODEL ?? "claude-haiku-4-5";

export type JudgeMeta = { model: string; inputTokens: number; outputTokens: number };

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`no JSON object in judge output:\n${text.slice(0, 400)}`);
  return JSON.parse(body.slice(start, end + 1));
}

/** One judge call returning parsed JSON, with a single repair pass if the model emits
 *  invalid JSON (usually an unescaped quote). Shared by every judge axis. */
async function judgeJson(
  judgeModel: string,
  system: string,
  userContent: string,
): Promise<{ data: unknown; inputTokens: number; outputTokens: number }> {
  const provider = getChatProviderForModel(judgeModel);
  const call = (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
    provider.complete({
      model: judgeModel,
      system: [{ type: "text", text: system }],
      messages,
      maxTokens: 1500,
      temperature: 0,
    });
  let res = await call([{ role: "user", content: userContent }]);
  let inputTokens = res.inputTokens;
  let outputTokens = res.outputTokens;
  try {
    return { data: extractJson(res.text), inputTokens, outputTokens };
  } catch {
    res = await call([
      { role: "user", content: userContent },
      { role: "assistant", content: res.text },
      {
        role: "user",
        content:
          "That was not valid JSON (likely an unescaped double quote in a string). Output the SAME evaluation again as STRICTLY valid, parseable JSON only — replace any double quotes inside string values with single quotes.",
      },
    ]);
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    return { data: extractJson(res.text), inputTokens, outputTokens };
  }
}

// ── Faithfulness (grounding) ─────────────────────────────────────────────────

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

const JUDGE_SYSTEM = `You are a STRICT faithfulness evaluator for an AI character system. A character was given CONTEXT (its identity/instructions + a RETRIEVED KNOWLEDGE section pulled from a knowledge graph) and produced a RESPONSE to a user. Determine whether the response's FACTUAL claims are supported by that context.

First, IGNORE pure emotion, opinion, in-character style, and questions the character asks back — those are not claims and must not appear in your output.

For each remaining claim, assign exactly one "kind":
- "grounded-knowledge": a factual claim supported by the RETRIEVED KNOWLEDGE section.
- "grounded-identity": a factual claim supported by the identity/instructions.
- "fabrication": an UNSUPPORTED claim asserting a checkable WORLD-FACT — a specific event, person, place, time, name, relationship, quote, or number that is NOT in the context (or contradicts it). Real hallucinations.
- "embellishment": an UNSUPPORTED detail adding sensory/atmospheric/narrative COLOR that is not a checkable world-fact — weather, time of day, light, physical sensation, ambient scenery.

DECISIVE TEST (fabrication vs embellishment): could a historian mark it true or false against the record? If yes and it is not in the context → fabrication. If it is mood/scenery no record could confirm or deny → embellishment.

For grounded claims, put the supporting context snippet in "evidence". For fabrication/embellishment, "evidence" may be "" or a brief note.

Output ONLY strictly valid JSON (no prose, no markdown fences):
{"claims":[{"claim":string,"kind":"grounded-knowledge"|"grounded-identity"|"fabrication"|"embellishment","evidence":string}],"usedRetrievedKnowledge":boolean,"notes":string}
CRITICAL: when quoting source text inside any string value, use single quotes ('), NEVER raw double quotes — an unescaped double quote breaks the parse.`;

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

export async function gradeGrounding(input: {
  message: string;
  response: string;
  systemPrompt: string;
  promptChunk: string;
  judgeModel?: string;
}): Promise<GroundingVerdict & { judge: JudgeMeta }> {
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
  const { data, inputTokens, outputTokens } = await judgeJson(judgeModel, JUDGE_SYSTEM, judgeUser);
  const parsed = data as { claims?: GroundingClaim[]; usedRetrievedKnowledge?: boolean; notes?: string };
  const verdict = scoreClaims(parsed.claims ?? [], Boolean(parsed.usedRetrievedKnowledge), parsed.notes ?? "");
  return { ...verdict, judge: { model: judgeModel, inputTokens, outputTokens } };
}

// ── In-character quality ─────────────────────────────────────────────────────

export type QualityDimension = { score: number; notes: string };
export type QualityVerdict = {
  voice: QualityDimension;
  persona: QualityDimension;
  scope: QualityDimension;
  issues: string[];
  qualityScore: number;
  verdict: "in-character" | "minor-drift" | "out-of-character";
  notes: string;
};

const QUALITY_SYSTEM = `You are an IN-CHARACTER QUALITY evaluator for an AI character. You are given the character's DEFINITION (its identity, voice, and scope — the spec it must embody, usually in <identity>/<voice>/<scope> tags) and a RESPONSE it produced to a USER MESSAGE. Assess how well the response embodies the defined character. This is about VOICE and PERSONA fidelity, NOT factual accuracy — a separate grounding check handles facts, so do NOT reward or penalize factual content here.

Score three dimensions, each 0..1:
- voice: do tone, register, and especially BREVITY match the defined <voice>? If brevity says e.g. '2-4 sentences' and the response runs much longer, score low. Wrong register (casual slang for a formal character; stiffness for a warm one) scores low.
- persona: does the response embody the character's defined traits/identity and stay IN character? Breaking the fourth wall, 'as an AI', modern self-awareness, or a flat/generic voice score low.
- scope: does it stay within the defined <engage> topics and appropriately decline/redirect <refuse> topics? Gracefully declining or redirecting an out-of-scope question scores HIGH; answering an out-of-scope question in detail scores low.

List specific issues (too verbose, wrong register, broke character, answered out-of-scope, flat/generic voice, etc.); empty if none.

qualityScore = holistic 0..1 overall. verdict: 'in-character' (strong), 'minor-drift' (small issues), 'out-of-character' (clear failures).

Output ONLY strictly valid JSON (single quotes inside strings, NEVER raw double quotes):
{"voice":{"score":number,"notes":string},"persona":{"score":number,"notes":string},"scope":{"score":number,"notes":string},"issues":string[],"qualityScore":number,"verdict":"in-character"|"minor-drift"|"out-of-character","notes":string}`;

export async function gradeQuality(input: {
  message: string;
  response: string;
  systemPrompt: string;
  judgeModel?: string;
}): Promise<QualityVerdict & { judge: JudgeMeta }> {
  const judgeModel = input.judgeModel ?? DEFAULT_JUDGE_MODEL;
  const judgeUser = `## CHARACTER DEFINITION (identity / voice / scope the response must embody)
${input.systemPrompt || "(none)"}

## USER MESSAGE
${input.message}

## CHARACTER RESPONSE
${input.response}

Assess in-character quality per the rules. Output JSON only.`;
  const { data, inputTokens, outputTokens } = await judgeJson(judgeModel, QUALITY_SYSTEM, judgeUser);
  const v = data as QualityVerdict;
  return { ...v, judge: { model: judgeModel, inputTokens, outputTokens } };
}

// ── Combined ─────────────────────────────────────────────────────────────────

export type TurnGrade = {
  grounding?: GroundingVerdict & { judge: JudgeMeta };
  quality?: QualityVerdict & { judge: JudgeMeta };
};

/** Grade one turn's TEXT on the requested axes (judges run in parallel). The turn
 *  may be live (replayed) or persisted (read from the DB) — this layer doesn't care. */
export async function gradeTurn(input: {
  message: string;
  response: string;
  systemPrompt: string;
  promptChunk: string;
  judgeModel?: string;
  axes?: { grounding?: boolean; quality?: boolean };
}): Promise<TurnGrade> {
  const axes = input.axes ?? { grounding: true, quality: true };
  const [grounding, quality] = await Promise.all([
    axes.grounding
      ? gradeGrounding({
          message: input.message,
          response: input.response,
          systemPrompt: input.systemPrompt,
          promptChunk: input.promptChunk,
          judgeModel: input.judgeModel,
        })
      : Promise.resolve(undefined),
    axes.quality
      ? gradeQuality({
          message: input.message,
          response: input.response,
          systemPrompt: input.systemPrompt,
          judgeModel: input.judgeModel,
        })
      : Promise.resolve(undefined),
  ]);
  return { grounding, quality };
}
