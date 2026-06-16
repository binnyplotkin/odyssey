import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";

import type { SonarRunRecord, SonarTurnRecord } from "./types";

export const AGENCY_SCORES_PATH = "evals/sonar/agency-scores.jsonl";

export const AGENCY_DIMENSIONS = [
  "turnTaking",
  "interruptability",
  "engagement",
  "initiative",
  "repair",
  "goalPersistence",
  "worldResponsiveness",
] as const;

export type AgencyDimension = (typeof AGENCY_DIMENSIONS)[number];

export type AgencyPenalty = {
  type:
    | "ignored_stop_or_correction"
    | "continued_old_intent"
    | "broke_world_frame"
    | "overanswered"
    | "failed_to_drive"
    | "unsafe_or_incoherent"
    | "other";
  points: number;
  turn: number | null;
  rationale: string;
};

export type AgencyScoreRecord = {
  runId: string;
  at: string;
  sonarVersion: string;
  suite: string;
  suiteVersion: string;
  model: string | null;
  turns: number;
  judge: string;
  dimensions: Record<AgencyDimension, number>;
  penalties: AgencyPenalty[];
  score: number;
  notes: string;
};

type JudgeAgencyOptions = {
  judgeModel: string;
  apiKey: string;
};

const DIMENSION_WEIGHTS: Record<AgencyDimension, number> = {
  turnTaking: 0.15,
  interruptability: 0.15,
  engagement: 0.15,
  initiative: 0.20,
  repair: 0.15,
  goalPersistence: 0.10,
  worldResponsiveness: 0.10,
};

const PENALTY_CAP = 30;

const AGENCY_JUDGE_SCHEMA = {
  name: "submit_agency_evaluation",
  description: "Submit a structured evaluation of Sonar Agency for one benchmark run.",
  input_schema: {
    type: "object" as const,
    required: ["dimensions", "penalties", "notes"],
    properties: {
      dimensions: {
        type: "object",
        required: [...AGENCY_DIMENSIONS],
        properties: Object.fromEntries(
          AGENCY_DIMENSIONS.map((dimension) => [
            dimension,
            {
              type: "object",
              required: ["rating", "rationale"],
              properties: {
                rating: {
                  type: "integer",
                  minimum: 1,
                  maximum: 5,
                  description: "1=failed, 2=weak, 3=acceptable, 4=strong, 5=excellent.",
                },
                rationale: {
                  type: "string",
                  description: "One concise sentence explaining this dimension score.",
                },
              },
            },
          ]),
        ),
      },
      penalties: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "points", "turn", "rationale"],
          properties: {
            type: {
              type: "string",
              enum: [
                "ignored_stop_or_correction",
                "continued_old_intent",
                "broke_world_frame",
                "overanswered",
                "failed_to_drive",
                "unsafe_or_incoherent",
                "other",
              ],
            },
            points: {
              type: "integer",
              minimum: 0,
              maximum: 20,
              description: "Penalty points for this failure before the global cap.",
            },
            turn: {
              type: ["integer", "null"],
              minimum: 1,
              description: "1-indexed turn number, or null for run-level failures.",
            },
            rationale: { type: "string" },
          },
        },
      },
      notes: {
        type: "string",
        description: "Two to four sentences summarizing the main strengths and failures.",
      },
    },
  },
};

export const AGENCY_JUDGE_SYSTEM_PROMPT = `You are an expert evaluator of live voice world-simulation systems.

You are judging Sonar Agency: the harness's ability to actively participate in a live simulated world conversation. Agency does NOT mean autonomous tool use. It means live conversation control and initiative.

Score the run on seven dimensions, each 1 to 5:
- turnTaking: Does it speak at the right time, leave room, avoid awkward over-answering, and hand the floor back naturally?
- interruptability: Does it accept stop requests, corrections, or changed intent without continuing the old track?
- engagement: Does it respond with specificity, presence, emotional awareness, and situated context rather than generic acknowledgement?
- initiative: Does it move the conversation forward with useful next steps, choices, or actions when the user is uncertain?
- repair: Does it recover from confusion, ambiguity, partial information, or misread intent?
- goalPersistence: Does it preserve the larger session purpose across turns?
- worldResponsiveness: Does the scene, narrator mediation, character presence, or world state evolve appropriately rather than just answering?

Rating anchors:
1 = failed or ignored the situation
2 = weak, generic, awkward, or only partially responsive
3 = acceptable and mostly coherent
4 = strong, natural, and clearly useful
5 = excellent, highly natural, and clearly advances the world

Apply penalties for severe failures:
- ignored_stop_or_correction: user redirects/stops/corrects and the system ignores it
- continued_old_intent: system keeps pursuing an old intent after changed user intent
- broke_world_frame: unnecessary AI/meta break or scene/identity incoherence
- overanswered: monologue or excessive detail when brevity/help was requested
- failed_to_drive: user is stuck and the system gives no useful next move
- unsafe_or_incoherent: confusing or unsafe response that damages the session

Be strict. A response can be factual but still score poorly if it fails to engage, repair, or drive the world. Submit your verdict via the submit_agency_evaluation tool.`;

export async function judgeAgencyRun(
  record: SonarRunRecord,
  opts: JudgeAgencyOptions,
): Promise<AgencyScoreRecord> {
  validateAgencyEvidence(record);

  const anthropic = new Anthropic({
    apiKey: opts.apiKey,
    maxRetries: 0,
    timeout: 120_000,
  });

  const resp = await anthropic.messages.create({
    model: opts.judgeModel,
    max_tokens: 2048,
    temperature: 0,
    system: AGENCY_JUDGE_SYSTEM_PROMPT,
    tools: [AGENCY_JUDGE_SCHEMA],
    tool_choice: { type: "tool", name: "submit_agency_evaluation" },
    messages: [{ role: "user", content: buildAgencyJudgeUserPrompt(record) }],
  });

  const toolUse = resp.content.find(
    (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("Agency judge did not return tool_use block");
  if (toolUse.name !== "submit_agency_evaluation") {
    throw new Error(`Agency judge called wrong tool: ${toolUse.name}`);
  }

  return normalizeAgencyJudgment(record, opts.judgeModel, toolUse.input);
}

export function buildAgencyJudgeUserPrompt(record: SonarRunRecord): string {
  return `Run:
- runId: ${record.runId}
- sonarVersion: ${record.sonarVersion}
- suite: ${record.suite.name}@${record.suite.version}
- mode: ${record.suite.mode}
- label: ${record.label ?? "(none)"}
- character: ${record.config.character}
- observed models: ${record.observed.models.join(", ") || "(none)"}
- turns: ${record.turns.length}

Transcript and traces:
${record.turns.map(renderTurnForJudge).join("\n\n")}

Judge only the assistant/world behavior. Do not reward or punish STT wording unless it clearly prevented a fair response.`;
}

export function loadAgencyScores(repoRoot: string): AgencyScoreRecord[] {
  const file = path.join(repoRoot, AGENCY_SCORES_PATH);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as AgencyScoreRecord;
      if (!parsed.runId || !parsed.suite || !parsed.dimensions) {
        throw new Error(`${AGENCY_SCORES_PATH}:${index + 1} is not a valid Agency score row`);
      }
      return parsed;
    });
}

export function upsertAgencyScore(repoRoot: string, score: AgencyScoreRecord): string {
  const file = path.join(repoRoot, AGENCY_SCORES_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = loadAgencyScores(repoRoot).filter((row) => row.runId !== score.runId);
  rows.push(score);
  rows.sort((a, b) => a.at.localeCompare(b.at));
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

export function computeAgencyScore(dimensions: Record<AgencyDimension, number>, penalties: AgencyPenalty[]): number {
  const base = AGENCY_DIMENSIONS.reduce(
    (acc, dimension) => acc + dimensions[dimension] * DIMENSION_WEIGHTS[dimension],
    0,
  );
  const penalty = Math.min(
    PENALTY_CAP,
    penalties.reduce((acc, item) => acc + Math.max(0, item.points), 0),
  );
  return clampScore(base - penalty);
}

function validateAgencyEvidence(record: SonarRunRecord): void {
  if (record.suite.name !== "agency-baseline") {
    throw new Error(`Agency judge expects agency-baseline; got ${record.suite.name}`);
  }
  const missing = record.turns.filter((turn) => !turn.responseText?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Run ${record.runId.slice(0, 8)} is missing assistant responseText on ${missing.length} turn(s). ` +
        "Re-run agency-baseline with the updated Sonar runner before judging.",
    );
  }
}

function renderTurnForJudge(turn: SonarTurnRecord): string {
  const lines = [
    `Turn ${turn.turnIndex + 1}`,
    `Scripted user: ${turn.message}`,
    `STT transcript: ${turn.stt.transcript || "(empty; scripted fallback may have been used)"}`,
    turn.orchestratorPrompt ? `Orchestrator direction:\n${indent(turn.orchestratorPrompt)}` : "Orchestrator direction: (none)",
    `Assistant/world response:\n${indent(turn.responseText || "(missing)")}`,
    `Signals: v2v=${ms(turn.spans["voice-to-voice"])}; endpoint=${ms(turn.spans["stt.endpoint-to-word"])}; ` +
      `orchestrate=${ms(turn.spans["orchestrate.total"])}; error=${turn.flags.error ?? "none"}`,
  ];
  return lines.join("\n");
}

function normalizeAgencyJudgment(
  record: SonarRunRecord,
  judgeModel: string,
  raw: unknown,
): AgencyScoreRecord {
  const input = raw as {
    dimensions?: Partial<Record<AgencyDimension, { rating?: unknown; rationale?: unknown }>>;
    penalties?: AgencyPenalty[];
    notes?: unknown;
  };

  const dimensions = Object.fromEntries(
    AGENCY_DIMENSIONS.map((dimension) => {
      const rating = clampInt(asNumber(input.dimensions?.[dimension]?.rating), 1, 5, 3);
      return [dimension, ratingToScore(rating)];
    }),
  ) as Record<AgencyDimension, number>;

  const penalties = Array.isArray(input.penalties)
    ? input.penalties.map(normalizePenalty).filter((p): p is AgencyPenalty => p !== null)
    : [];
  const score = computeAgencyScore(dimensions, penalties);

  return {
    runId: record.runId,
    at: new Date().toISOString(),
    sonarVersion: record.sonarVersion,
    suite: record.suite.name,
    suiteVersion: record.suite.version,
    model: record.observed.models[0] ?? record.config.model,
    turns: record.turns.length,
    judge: judgeModel,
    dimensions,
    penalties,
    score,
    notes: typeof input.notes === "string" ? input.notes : "",
  };
}

function normalizePenalty(raw: unknown): AgencyPenalty | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<AgencyPenalty>;
  const type = typeof p.type === "string" ? p.type : "other";
  const allowed = [
    "ignored_stop_or_correction",
    "continued_old_intent",
    "broke_world_frame",
    "overanswered",
    "failed_to_drive",
    "unsafe_or_incoherent",
    "other",
  ] as const;
  return {
    type: allowed.includes(type as AgencyPenalty["type"]) ? type as AgencyPenalty["type"] : "other",
    points: clampInt(asNumber(p.points), 0, 20, 0),
    turn: typeof p.turn === "number" && Number.isFinite(p.turn) ? Math.max(1, Math.round(p.turn)) : null,
    rationale: typeof p.rationale === "string" ? p.rationale : "",
  };
}

function ratingToScore(rating: number): number {
  return Math.round(((rating - 1) / 4) * 1000) / 10;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number") return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function indent(value: string): string {
  return value.split(/\r?\n/).map((line) => `  ${line}`).join("\n");
}

function ms(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value)}ms` : "-";
}
