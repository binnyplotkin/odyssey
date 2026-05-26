import Anthropic from "@anthropic-ai/sdk";
import type {
  DimensionScore,
  Probe,
  ScoreDimension,
} from "./types";

/**
 * LLM-as-judge: scores a (probe, response) pair on five dimensions
 * using Claude Opus with tool-use to force a structured JSON shape
 * (more reliable than asking for JSON in free text).
 *
 * The judge does NOT see the character's system prompt — it evaluates
 * against the rubric's stated goal alone. This way the judge can't be
 * sympathetic to whatever the system prompt told the character to do;
 * it judges against what the rubric says good looks like.
 *
 * Temperature is forced to 0 — judges should be reproducible. Two
 * identical (probe, response) inputs should produce identical scores.
 */

const JUDGE_SCHEMA = {
  name: "submit_evaluation",
  description: "Submit the scored evaluation of the character's response.",
  input_schema: {
    type: "object" as const,
    required: ["scores", "overall", "pass", "rationale"],
    properties: {
      scores: {
        type: "object",
        required: ["voice", "scope", "frame", "brevity", "factual"],
        properties: {
          voice: dimensionSchema("Does it sound like the character would speak?"),
          scope: dimensionSchema("Does it stay in scope per the rubric?"),
          frame: dimensionSchema("Does it stay in character (first-person, no AI-speak)?"),
          brevity: dimensionSchema("Is the length appropriate (1=too long, 5=tight)?"),
          factual: dimensionSchema("Are claims grounded in what the character could know?"),
        },
      },
      overall: {
        type: "number",
        minimum: 1,
        maximum: 5,
        description: "Composite 1-5 across all dimensions, weighted by what the rubric emphasizes.",
      },
      pass: {
        type: "boolean",
        description: "True iff this response would pass the bar a thoughtful author would set.",
      },
      rationale: {
        type: "string",
        description: "One sentence summarizing the overall judgment.",
      },
    },
  },
};

function dimensionSchema(description: string) {
  return {
    type: "object" as const,
    required: ["score", "rationale"],
    description,
    properties: {
      score: { type: "integer", minimum: 1, maximum: 5 },
      rationale: { type: "string", description: "One sentence explaining this score." },
    },
  };
}

export type JudgeInput = {
  probe: Probe;
  response: string;
  characterTitle: string;
  characterIdentityEssence: string | null;
  judgeModel: string;
  apiKey: string;
};

export type Judgement = {
  scores: Record<ScoreDimension, DimensionScore>;
  overall: number;
  pass: boolean;
  rationale: string;
};

/**
 * The system prompt the judge sees — character-agnostic, just the rubric
 * + dimension definitions. Exported so the trace endpoint can reproduce
 * what the judge was shown without re-calling the API.
 */
export const JUDGE_SYSTEM_PROMPT = `You are an expert character-simulation evaluator. Your job is to score how well a character's response matches the stated rubric — NOT how clever or polite the response is, just whether it lands the specific behavioral goal the rubric describes.

Apply the rubric strictly. A response can be beautiful AND wrong (and would score low if so), or terse AND correct (would score high). Trust the rubric over your aesthetic preferences.

You score on five dimensions, each 1 (terrible) to 5 (excellent):
- voice: Does the response sound like the character would speak?
- scope: Does it stay in scope per the rubric/expectations?
- frame: Does it stay in character (first-person, no AI-speak, no narration)?
- brevity: Is the length appropriate? (1=way too long, 3=fine, 5=perfectly tight)
- factual: Are the claims grounded in what the character could plausibly know?

The "overall" score reflects the rubric's emphasis — not a mechanical average. A response that nails voice and scope but bombs frame should NOT score well overall; the rubric will tell you which dimensions matter most.

"pass" is true iff a thoughtful author would accept this response. Default to strict: when in doubt, fail it.

Submit your verdict via the submit_evaluation tool.`;

/**
 * The per-probe user prompt — interpolates the character context, probe
 * input, response, rubric, and any per-dimension hints. Pure function so
 * the trace endpoint can reconstruct the exact judge transcript a past
 * run was scored against.
 */
export function buildJudgeUserPrompt(input: {
  probe: Probe;
  response: string;
  characterTitle: string;
  characterIdentityEssence: string | null;
}): string {
  return `Character: ${input.characterTitle}
${input.characterIdentityEssence ? `Identity essence: ${input.characterIdentityEssence}` : ""}

Probe category: ${input.probe.category}

Player input:
"""
${input.probe.input}
"""

Character response:
"""
${input.response}
"""

Rubric for this probe:
"""
${input.probe.rubric.trim()}
"""

${input.probe.expectations?.voiceCheck ? `Voice expectation: ${input.probe.expectations.voiceCheck}` : ""}
${input.probe.expectations?.scopeCheck ? `Scope expectation: ${input.probe.expectations.scopeCheck}` : ""}
${input.probe.expectations?.frameCheck ? `Frame expectation: ${input.probe.expectations.frameCheck}` : ""}
${input.probe.expectations?.maxOutputTokens ? `Brevity ceiling: ~${input.probe.expectations.maxOutputTokens} tokens (above = brevity drops).` : ""}

Apply the rubric and submit your evaluation.`;
}

export async function judgeResponse(input: JudgeInput): Promise<Judgement> {
  // `maxRetries: 0` for the same reason as the character call — we'd
  // rather see an explicit error than burn 10 min on hidden SDK retries.
  // 90s SDK timeout: judge calls are smaller than character calls; if
  // the judge hasn't replied by then, retry the suite, not the request.
  const anthropic = new Anthropic({
    apiKey: input.apiKey,
    maxRetries: 0,
    timeout: 90_000,
  });

  const systemPrompt = JUDGE_SYSTEM_PROMPT;
  const userPrompt = buildJudgeUserPrompt({
    probe: input.probe,
    response: input.response,
    characterTitle: input.characterTitle,
    characterIdentityEssence: input.characterIdentityEssence,
  });

  const resp = await anthropic.messages.create({
    model: input.judgeModel,
    max_tokens: 1024,
    temperature: 0,
    system: systemPrompt,
    tools: [JUDGE_SCHEMA],
    tool_choice: { type: "tool", name: "submit_evaluation" },
    messages: [{ role: "user", content: userPrompt }],
  });

  // Find the tool_use block
  const toolUse = resp.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("judge did not return tool_use block");
  }
  if (toolUse.name !== "submit_evaluation") {
    throw new Error(`judge called wrong tool: ${toolUse.name}`);
  }

  const raw = toolUse.input as RawJudgement;
  return normalizeJudgement(raw);
}

/* ── Normalization (defense against off-spec judge output) ── */

type RawDimension = { score?: unknown; rationale?: unknown };
type RawJudgement = {
  scores?: Partial<Record<ScoreDimension, RawDimension>>;
  overall?: unknown;
  pass?: unknown;
  rationale?: unknown;
};

const DIMENSIONS: ScoreDimension[] = ["voice", "scope", "frame", "brevity", "factual"];

function normalizeJudgement(raw: RawJudgement): Judgement {
  const scores = Object.fromEntries(
    DIMENSIONS.map((d) => {
      const dim = raw.scores?.[d];
      const score = clampInt(asNum(dim?.score), 1, 5, 3);
      const rationale = typeof dim?.rationale === "string" ? dim.rationale : "—";
      return [d, { score, rationale } as DimensionScore];
    }),
  ) as Record<ScoreDimension, DimensionScore>;

  const overall = clampFloat(asNum(raw.overall), 1, 5, avgScore(scores));
  const pass = typeof raw.pass === "boolean" ? raw.pass : overall >= 3;
  const rationale = typeof raw.rationale === "string" ? raw.rationale : "—";

  return { scores, overall, pass, rationale };
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function clampInt(v: number | undefined, lo: number, hi: number, fallback: number): number {
  if (typeof v !== "number") return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function clampFloat(v: number | undefined, lo: number, hi: number, fallback: number): number {
  if (typeof v !== "number") return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function avgScore(scores: Record<ScoreDimension, DimensionScore>): number {
  const sum = DIMENSIONS.reduce((a, d) => a + scores[d].score, 0);
  return sum / DIMENSIONS.length;
}
