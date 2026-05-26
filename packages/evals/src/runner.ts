import {
  getCharacterStore,
  type CharacterBrainModel,
  type CharacterRecord,
} from "@odyssey/db";
import {
  buildSystemPromptParts,
  getChatProviderForModel,
  pricingFor,
  type ChatSystemBlock,
} from "@odyssey/engine";
import { curate } from "@odyssey/wiki-curator";
import { captureCharacterSnapshot } from "./snapshot";
import { judgeResponse } from "./judge";
import type {
  CharacterSnapshot,
  EvalRun,
  Probe,
  ProbeResult,
  ProbeSuite,
} from "./types";

/**
 * Bypasses the HTTP/admin auth layer and calls the character's chat
 * pipeline directly. Same code paths as production (`buildSystemPromptParts`
 * + Anthropic SDK with the same cache_control wrapping), so eval results
 * reflect real runtime behavior — not a parallel implementation that
 * could drift.
 *
 * Concurrency: 4 probes in flight at a time. Each in-flight probe also
 * does one judge call, so the worst case is 8 concurrent Anthropic
 * requests. Comfortable below tier limits.
 *
 * Timeout strategy:
 *   - SDK `maxRetries: 0` on the eval Anthropic clients so the harness
 *     never silently spends 10+ minutes on internal exponential backoff.
 *     If a probe errors, it errors; re-run that config later.
 *   - Each probe's character work (curator + character LLM call) is
 *     bounded by a single `withTimeout` so a stuck curator can't burn
 *     wall time before the LLM call even starts.
 *   - Judge calls are bounded separately with a shorter ceiling.
 */

const DEFAULT_MAX_CONCURRENCY = 4;
// Anthropic can spike to 5min+ TTFT under load (observed during testing).
// 180s covers the slow tail without letting a stuck call hang the suite.
// Wraps the WHOLE character path (curator + LLM call); the provider's
// own SDK-level timeout (170s by default) is slightly below this so the
// outer wall gets the last word with a clean error.
const DEFAULT_CHARACTER_TIMEOUT_MS = 180_000;

/* Pricing is read from the shared model registry via `pricingFor(modelId)`
 * — see `summarize()` below. The pre-v2 hardcoded table that lived here
 * is gone; one source of truth in packages/engine/src/model-registry.ts. */

export type RunOptions = {
  /** Character slug, e.g. "abraham". */
  characterSlug: string;
  /** The probe suite to run. */
  suite: ProbeSuite;
  /**
   * Optional pre-fetched character record. Used by the sweep to fetch
   * once and pass down — avoids N DB hits per sweep AND eliminates
   * the transient-null failure mode where a Neon hiccup turns a real
   * character into "not found".
   */
  character?: CharacterRecord;
  /**
   * Optional per-run override on top of the character's saved
   * brainModel. Fields here trump the snapshot. Used by `--config` and
   * `--sweep` flags.
   */
  overrideConfig?: Partial<CharacterBrainModel>;
  /** Judge model id (default "claude-opus-4-5"). */
  judgeModel?: string;
  /** Subset of probe ids — runs only these. */
  probeIds?: string[];
  /** Max in-flight probes (default 4). */
  maxConcurrency?: number;
  /** Streams per-probe progress to the caller. */
  onProgress?: (event: ProgressEvent) => void;
};

export type ProgressEvent =
  | { kind: "snapshot"; snapshot: CharacterSnapshot }
  | { kind: "probe-start"; probeId: string }
  | { kind: "probe-done"; result: ProbeResult };

/** Top-level entrypoint. Captures snapshot, runs every probe (with
 * bounded concurrency), judges each, returns the full EvalRun. */
export async function runEvalSuite(opts: RunOptions): Promise<EvalRun> {
  const startedAt = new Date().toISOString();

  // 1. Resolve character + snapshot config
  // The store has graceful-null fallback on transient DB errors, which is
  // sensible for cold reads but means we can see null for a character we
  // know exists. One retry with backoff handles the common Neon hiccup;
  // callers can also pre-fetch and pass `character` to bypass entirely.
  const character = opts.character ?? (await resolveCharacterWithRetry(opts.characterSlug));
  const snapshot = captureCharacterSnapshot(character);
  opts.onProgress?.({ kind: "snapshot", snapshot });

  // 2. Compute the effective model config (snapshot.brainModel + override)
  const effective = mergeModelConfig(character.brainModel, opts.overrideConfig);

  // 3. Pick subset of probes if requested
  const probes = opts.probeIds?.length
    ? opts.suite.probes.filter((p) => opts.probeIds!.includes(p.id))
    : opts.suite.probes;

  if (probes.length === 0) {
    throw new Error("No probes to run (subset filter excluded everything?)");
  }

  // 4. Run with bounded concurrency
  const concurrency = opts.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const judgeModel = opts.judgeModel ?? "claude-opus-4-5";
  // The character call routes through the multi-provider abstraction
  // (`getChatProviderForModel`), so its env key is checked inside the
  // provider constructor. The JUDGE is still Anthropic-only (uses
  // tool_use) and takes the api key as input — verify it up front so a
  // missing key fails the run before any probes hit the network.
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the judge call");
  }

  const results = await runWithConcurrency(probes, concurrency, async (probe) => {
    opts.onProgress?.({ kind: "probe-start", probeId: probe.id });
    const result = await runSingleProbe({
      probe,
      character,
      effective,
      judgeModel,
      apiKey,
      characterTimeoutMs: DEFAULT_CHARACTER_TIMEOUT_MS,
    });
    opts.onProgress?.({ kind: "probe-done", result });
    return result;
  });

  const completedAt = new Date().toISOString();

  // 5. Roll up the summary
  const summary = summarize(results, judgeModel, effective);

  return {
    id: `${opts.characterSlug}-${startedAt.replace(/[:.]/g, "-")}`,
    startedAt,
    completedAt,
    characterSnapshot: snapshot,
    overrideConfig: opts.overrideConfig ?? null,
    effectiveModelConfig: effective,
    judgeModel,
    probeSuiteId: opts.suite.id,
    probeSuiteVersion: opts.suite.version,
    probes: results,
    summary,
  };
}

/**
 * Fetch the character with one retry. The store returns null on transient
 * Neon errors (graceful fallback for cold reads), which we have to treat as
 * "real not-found" by the second attempt — anything past that is almost
 * certainly a real config problem the operator should see.
 */
async function resolveCharacterWithRetry(slug: string): Promise<CharacterRecord> {
  const store = getCharacterStore();
  let character = await store.getBySlug(slug);
  if (!character) {
    await new Promise((r) => setTimeout(r, 500));
    character = await store.getBySlug(slug);
  }
  if (!character) {
    throw new Error(
      `Character not found: ${slug} (checked twice — verify slug + DB connectivity)`,
    );
  }
  return character;
}

/* ── Per-probe execution ──────────────────────────────────── */

type ProbeRunContext = {
  probe: Probe;
  character: CharacterRecord;
  effective: EvalRun["effectiveModelConfig"];
  judgeModel: string;
  apiKey: string;
  characterTimeoutMs: number;
};

async function runSingleProbe(ctx: ProbeRunContext): Promise<ProbeResult> {
  const errors: string[] = [];
  let response = "";
  let latencyMs = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  // ── 1. Call the character ──
  // Bound the entire character path (curator + LLM call). Curator hits
  // Anthropic too — if it stalls and we only bound the LLM call, a stuck
  // curator silently burns minutes before the LLM call even starts.
  try {
    const charResult = await withTimeout(
      callCharacter(ctx),
      ctx.characterTimeoutMs,
    );
    response = charResult.response;
    latencyMs = charResult.latencyMs;
    tokens.input = charResult.inputTokens;
    tokens.output = charResult.outputTokens;
    tokens.cacheRead = charResult.cacheReadTokens;
    tokens.cacheCreation = charResult.cacheCreationTokens;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`character call failed: ${msg}`);
    return errorResult(ctx.probe, errors);
  }

  // ── 2. Mechanical checks (cheap, deterministic) ──
  const mechanicalFailures = mechanicalChecks(ctx.probe, response);

  // ── 3. Judge ──
  let judgement;
  try {
    judgement = await judgeResponse({
      probe: ctx.probe,
      response,
      characterTitle: ctx.character.title,
      characterIdentityEssence: ctx.character.identity?.essence ?? null,
      judgeModel: ctx.judgeModel,
      apiKey: ctx.apiKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`judge call failed: ${msg}`);
    return errorResult(ctx.probe, errors, response, latencyMs, tokens);
  }

  // ── 4. Compose final pass/fail ──
  const passThreshold = ctx.probe.passThreshold ?? 3;
  const allDimsAboveOne = Object.values(judgement.scores).every((d) => d.score >= 2);
  const pass =
    judgement.overall >= passThreshold &&
    allDimsAboveOne &&
    mechanicalFailures.length === 0;

  return {
    probeId: ctx.probe.id,
    probeCategory: ctx.probe.category,
    input: ctx.probe.input,
    response,
    latencyMs,
    tokens,
    scores: judgement.scores,
    overall: judgement.overall,
    pass,
    rationale: judgement.rationale,
    mechanicalFailures,
    errors,
  };
}

/* ── Character call (direct, no HTTP) ─────────────────────── */

async function callCharacter(ctx: ProbeRunContext): Promise<{
  response: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> {
  const { probe, character, effective } = ctx;

  // Run the curator the same way buildCharacterContext does.
  const curated = await curate({
    characterId: character.id,
    query: probe.input,
    tokenBudget: 3000,
  });

  const parts = buildSystemPromptParts(
    character.title,
    curated.promptChunk,
    character.directive,
    character.identity,
    character.voiceStyle,
  );

  // Provider-neutral system blocks — `cacheControl` is a hint that the
  // Anthropic provider applies and the OpenAI provider ignores.
  const sysBlocks: ChatSystemBlock[] = [];
  if (parts.cached.trim()) {
    sysBlocks.push({
      type: "text",
      text: parts.cached,
      ...(effective.cacheControl ? { cacheControl: true } : {}),
    });
  }
  if (parts.perTurn.trim()) {
    sysBlocks.push({ type: "text", text: parts.perTurn });
  }
  if (sysBlocks.length === 0) {
    sysBlocks.push({ type: "text", text: " " });
  }

  // Resolve provider from the model id via the shared registry. Anthropic
  // models route through AnthropicChatProvider, OpenAI through
  // OpenAIChatProvider — same call shape on this side.
  const provider = getChatProviderForModel(effective.model);
  const resp = await provider.complete({
    model: effective.model,
    system: sysBlocks,
    messages: [{ role: "user", content: probe.input }],
    maxTokens: effective.maxTokens,
    ...(typeof effective.temperature === "number" ? { temperature: effective.temperature } : {}),
    ...(typeof effective.topP === "number" ? { topP: effective.topP } : {}),
  });

  return {
    response: resp.text,
    latencyMs: resp.latencyMs,
    inputTokens: resp.inputTokens,
    outputTokens: resp.outputTokens,
    cacheReadTokens: resp.cacheReadTokens,
    cacheCreationTokens: resp.cacheCreationTokens,
  };
}

/* ── Mechanical checks ──────────────────────────────────── */

function mechanicalChecks(probe: Probe, response: string): string[] {
  const failures: string[] = [];
  const haystack = response.toLowerCase();

  for (const needle of probe.expectations?.mustContain ?? []) {
    if (!haystack.includes(needle.toLowerCase())) {
      failures.push(`missing required substring: "${needle}"`);
    }
  }
  for (const banned of probe.expectations?.mustNotContain ?? []) {
    if (haystack.includes(banned.toLowerCase())) {
      failures.push(`contains forbidden substring: "${banned}"`);
    }
  }
  // Brevity is judged by the rubric; we don't fail here on length alone.

  return failures;
}

/* ── Merge + helpers ─────────────────────────────────────── */

function mergeModelConfig(
  base: CharacterBrainModel | null,
  override: Partial<CharacterBrainModel> | undefined,
): EvalRun["effectiveModelConfig"] {
  const m = override ?? {};
  const result: EvalRun["effectiveModelConfig"] = {
    model: m.model ?? base?.model ?? "claude-sonnet-4-5",
    maxTokens: m.maxTokens ?? base?.maxTokens ?? 1024,
    cacheControl: m.cacheControl ?? base?.cacheControl ?? true,
  };
  const t = m.temperature ?? base?.temperature;
  if (typeof t === "number") result.temperature = t;
  const p = m.topP ?? base?.topP;
  if (typeof p === "number") result.topP = p;
  return result;
}

function errorResult(
  probe: Probe,
  errors: string[],
  response = "",
  latencyMs = 0,
  tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
): ProbeResult {
  const zero = { score: 1, rationale: "skipped — probe errored" };
  return {
    probeId: probe.id,
    probeCategory: probe.category,
    input: probe.input,
    response,
    latencyMs,
    tokens,
    scores: {
      voice: zero,
      scope: zero,
      frame: zero,
      brevity: zero,
      factual: zero,
    },
    overall: 1,
    pass: false,
    rationale: errors.join("; ") || "errored",
    mechanicalFailures: [],
    errors,
  };
}

function summarize(
  results: ProbeResult[],
  judgeModel: string,
  effective: EvalRun["effectiveModelConfig"],
): EvalRun["summary"] {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const errored = results.filter((r) => r.errors.length > 0).length;
  const failed = total - passed;
  const avgOverall =
    results.reduce((a, r) => a + r.overall, 0) / Math.max(1, total);
  const avgLatencyMs =
    results.reduce((a, r) => a + r.latencyMs, 0) / Math.max(1, total);
  const totalTokens = results.reduce(
    (a, r) => a + r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheCreation,
    0,
  );

  // Crude per-run cost estimate. Includes only character calls — judge
  // cost is approximated as +50% (small but real overhead). Real billing
  // is on the provider dashboard. Pricing comes from the shared registry;
  // models without a pricing entry contribute 0 (caller sees $0 and can
  // fix the registry).
  let charUsd = 0;
  const cp = pricingFor(effective.model);
  if (cp) {
    for (const r of results) {
      charUsd +=
        (r.tokens.input * cp.input) / 1_000_000 +
        (r.tokens.output * cp.output) / 1_000_000 +
        // cacheRead/cacheWrite are optional on the registry record (only
        // Anthropic exposes them today). Default to 0 when absent so the
        // math stays correct for providers without prompt caching.
        (r.tokens.cacheRead * (cp.cacheRead ?? 0)) / 1_000_000 +
        (r.tokens.cacheCreation * (cp.cacheWrite ?? 0)) / 1_000_000;
    }
  }
  const judgeUsd = charUsd * 0.5; // rough; judge model + token shape differ

  return {
    total,
    passed,
    failed,
    errored,
    avgOverall: round(avgOverall, 2),
    avgLatencyMs: Math.round(avgLatencyMs),
    totalTokens,
    estimatedCostUsd: round(charUsd + judgeUsd, 4),
  };
}

function round(n: number, places: number): number {
  const k = Math.pow(10, places);
  return Math.round(n * k) / k;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const item = items[idx];
      results[idx] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}
