/**
 * Eval types — the wire format between the probe suite, runner, judge,
 * and reporter. Everything serializes to JSON; runs are reproducible
 * from their stored shape alone (see `CharacterSnapshot`).
 */

import type {
  CharacterDirective,
  CharacterIdentity,
  CharacterBrainModel,
  CharacterVoiceStyle,
} from "@odyssey/db";

/* ── Probes ──────────────────────────────────────────────── */

export type ProbeCategory =
  | "identity"
  | "trait"
  | "scope"
  | "deflect"
  | "frame"
  | "jailbreak"
  | "edge";

/**
 * A single test case. Inputs travel through the character pipeline
 * unchanged; the response is then judged against `expectations` +
 * `rubric`. Keep probes tiny and orthogonal — one probe should test
 * one behavior so failures attribute cleanly.
 */
export type Probe = {
  /** Stable id used in reports + history diffs. snake_case is fine. */
  id: string;
  category: ProbeCategory;
  /** What the player would type into the sandbox. */
  input: string;
  /** Structured expectations the judge can mechanically check. */
  expectations?: {
    /** Hard-required substrings (case-insensitive). */
    mustContain?: string[];
    /** Hard-forbidden substrings (case-insensitive). */
    mustNotContain?: string[];
    /** Soft ceiling on response length. Above this, brevity score drops. */
    maxOutputTokens?: number;
    /** Free-text note the judge weighs on the `voice` dimension. */
    voiceCheck?: string;
    /** Free-text note the judge weighs on the `scope` dimension. */
    scopeCheck?: string;
    /** Free-text note the judge weighs on the `frame` dimension. */
    frameCheck?: string;
  };
  /**
   * Holistic rubric — describes what each score (1–5) looks like for
   * this probe specifically. The judge weighs this most heavily.
   */
  rubric: string;
  /**
   * Per-probe overall pass threshold. Default 3.
   * A probe passes when overall score >= passThreshold AND no
   * dimension is below 2.
   */
  passThreshold?: number;
};

/* ── Snapshot — full reproducibility ────────────────────── */

/**
 * Frozen picture of the character config at the moment the eval ran.
 * Storing this on every EvalRun means "rerun this exact eval" is a
 * one-click operation — no need to lock baselines or worry about
 * config drift confounding regression diffs.
 */
export type CharacterSnapshot = {
  characterId: string;
  characterSlug: string;
  characterTitle: string;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  brainModel: CharacterBrainModel | null;
  directive: CharacterDirective | null;
  /** sha256 of the above for quick equality checks across runs. */
  configHash: string;
  /** ISO timestamp the snapshot was captured. */
  capturedAt: string;
};

/* ── Per-probe scoring ───────────────────────────────────── */

export type ScoreDimension =
  | "voice"
  | "scope"
  | "frame"
  | "brevity"
  | "factual";

export type DimensionScore = {
  /** 1 (terrible) to 5 (excellent). */
  score: number;
  /** One-sentence rationale from the judge. */
  rationale: string;
};

export type ProbeResult = {
  probeId: string;
  probeCategory: ProbeCategory;
  input: string;
  /** The character's response (full text). */
  response: string;
  /** Wall-clock latency for the character call (ms). */
  latencyMs: number;
  /** Tokens — input/output/cache from Anthropic usage. */
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
  /** Per-dimension scores from the judge. */
  scores: Record<ScoreDimension, DimensionScore>;
  /** Composite 1–5 (judge picks, weighted by rubric). */
  overall: number;
  /** Final pass/fail per the probe's threshold. */
  pass: boolean;
  /** One-sentence summary from the judge. */
  rationale: string;
  /** Any deterministic check failures (mustContain misses, etc.). */
  mechanicalFailures: string[];
  /** Errors — if non-empty, the character or judge call failed. */
  errors: string[];
};

/* ── Run summary ─────────────────────────────────────────── */

export type EvalRun = {
  /** Auto-generated; format: `<character>-<timestamp>`. */
  id: string;
  /** ISO timestamps. */
  startedAt: string;
  completedAt: string;

  /** Full character config at run time. Drives reproducibility. */
  characterSnapshot: CharacterSnapshot;
  /**
   * Per-run override on top of the snapshot's brainModel. Used by the
   * `--config` and `--sweep` flags. null = no override (snapshot wins).
   */
  overrideConfig: Partial<CharacterBrainModel> | null;
  /**
   * Effective model config applied to the character call (post-merge).
   * Stored explicitly so rerun doesn't need to recompute the merge.
   */
  effectiveModelConfig: {
    model: string;
    temperature?: number;
    topP?: number;
    maxTokens: number;
    cacheControl: boolean;
  };

  judgeModel: string;
  probeSuiteId: string;
  probeSuiteVersion: string;

  probes: ProbeResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
    avgOverall: number;
    avgLatencyMs: number;
    /** Sum of every probe's input + output tokens, both character and judge. */
    totalTokens: number;
    /** Estimated total cost (USD) — character + judge calls. */
    estimatedCostUsd: number;
  };
};

/* ── Probe suite ─────────────────────────────────────────── */

export type ProbeSuite = {
  /** Stable id (e.g. "abraham"). One suite per character + variant. */
  id: string;
  /** Version bump when the suite materially changes (semver-ish). */
  version: string;
  /** Optional human label. */
  label?: string;
  probes: Probe[];
};
