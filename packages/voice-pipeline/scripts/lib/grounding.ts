/**
 * Replay layer for the eval CLIs: runs a turn through the real runVoiceStream
 * (debug → full retrieval + captured context) and hands it to the package judges
 * (@odyssey/voice-pipeline `eval`). The judges themselves live in the package so
 * the /sessions route can grade PERSISTED turns without replaying.
 */
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import {
  gradeGrounding,
  gradeTurn,
  runVoiceStream,
  type GroundingVerdict,
  type JudgeMeta,
  type TurnGrade,
} from "@odyssey/voice-pipeline";

// Re-export the judge surface so the CLIs import everything from one module.
export {
  DEFAULT_JUDGE_MODEL,
  gradeGrounding,
  gradeQuality,
  gradeTurn,
} from "@odyssey/voice-pipeline";
export type {
  ClaimKind,
  GroundingClaim,
  GroundingVerdict,
  JudgeMeta,
  QualityDimension,
  QualityVerdict,
  TurnGrade,
} from "@odyssey/voice-pipeline";

/** Replay one turn through the real pipeline and return the response + the context
 *  the character actually saw. */
export async function replayTurn(
  characterId: string,
  message: string,
  opts?: { model?: string },
): Promise<{
  response: string;
  systemPrompt: string;
  promptChunk: string;
  pageSlugs: string[];
  firstTokenMs: number | null;
}> {
  const character =
    (await getCharacterStore().getById(characterId)) ??
    (await getCharacterStore().getBySlug(characterId));
  if (!character) throw new Error(`character "${characterId}" not found`);

  const session = await getSceneSessionStore().createSession({ characterId: character.id, mode: "voice" });
  const turnId = crypto.randomUUID();

  let response = "";
  let firstTokenMs: number | null = null;
  const startedAt = Date.now();
  const controller = new AbortController();
  // opts.model overrides the character's configured brain (must be in the model
  // registry). Same retrieval/curator/prompt for every model — only the LLM swaps —
  // so first-token deltas are a fair (retrieval-constant) latency comparison.
  for await (const ev of runVoiceStream(
    { characterId: character.id, message, sessionId: session.id, turnId, debug: true, model: opts?.model },
    { signal: controller.signal },
  )) {
    if (ev.event === "token") {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
      response += (ev.data as { delta: string }).delta;
    }
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
    firstTokenMs,
  };
}

export type GradedTurn = {
  message: string;
  response: string;
  pageSlugs: string[];
  verdict: GroundingVerdict;
  judge: JudgeMeta;
};

/** Replay + grade (grounding only). `responseOverride` grades an injected answer. */
export async function replayAndGrade(opts: {
  characterId: string;
  message: string;
  judgeModel?: string;
  responseOverride?: string;
}): Promise<GradedTurn> {
  const { response, systemPrompt, promptChunk, pageSlugs } = await replayTurn(opts.characterId, opts.message);
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

export type EvalResult = {
  message: string;
  response: string;
  pageSlugs: string[];
  firstTokenMs: number | null;
} & TurnGrade;

/** Replay a turn ONCE and grade it on the requested axes (judges run in parallel).
 *  `model` overrides the character's brain (registry id) for brain-model A/B. */
export async function replayAndEval(opts: {
  characterId: string;
  message: string;
  judgeModel?: string;
  model?: string;
  responseOverride?: string;
  axes?: { grounding?: boolean; quality?: boolean };
}): Promise<EvalResult> {
  const { response, systemPrompt, promptChunk, pageSlugs, firstTokenMs } = await replayTurn(
    opts.characterId,
    opts.message,
    { model: opts.model },
  );
  const toGrade = opts.responseOverride?.trim() || response;
  if (!toGrade.trim()) throw new Error("no response generated — cannot grade");
  const { grounding, quality } = await gradeTurn({
    message: opts.message,
    response: toGrade,
    systemPrompt,
    promptChunk,
    judgeModel: opts.judgeModel,
    axes: opts.axes ?? { grounding: true },
  });
  return { message: opts.message, response: toGrade, pageSlugs, firstTokenMs, grounding, quality };
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
