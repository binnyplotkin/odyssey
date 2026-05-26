import type {
  CharacterDirective,
  CharacterIdentity,
  CharacterRecord,
  CharacterVoiceStyle,
  TimeIndex,
} from "@odyssey/db";
import {
  buildSystemPromptParts,
  buildVoiceSystemPromptParts,
} from "@odyssey/engine";
import type {
  CurateRequest,
  CurateResult,
  CuratorTrace,
  Scene as CuratorScene,
  SelectedPage,
} from "@odyssey/wiki-curator";

export type VoicePromptPlanMode =
  | "chat-turn"
  | "prompt-preview"
  | "voice-baseline"
  | "voice-turn"
  | "override";

export type VoicePromptKind = "chat" | "voice";

export type VoicePromptCharacter = Pick<CharacterRecord, "id" | "slug" | "title"> & {
  directive?: CharacterDirective | null;
  identity?: CharacterIdentity | null;
  voiceStyle?: CharacterVoiceStyle | null;
};

export type VoicePromptPlanPage = {
  slug: string;
  title: string;
  type: string;
  rendering: "full" | "summary" | "title";
  score: number;
  origin: string;
  trail: string[];
  tokens: number;
};

export type VoicePromptTimingTrace = {
  startedAt: string;
  elapsedMs: number;
  events: Array<{ name: string; elapsedMs: number; meta?: Record<string, unknown> }>;
};

export type VoicePromptPlan = {
  character: VoicePromptCharacter;
  systemPrompt: string;
  systemPromptParts: { cached: string; perTurn: string };
  promptChunk: string;
  trace: CuratorTrace;
  pages: VoicePromptPlanPage[];
  pageSlugs: string[];
  tokensUsed: number;
  tokensBudget: number;
  elapsedMs: number;
  routingMode: VoicePromptPlanMode;
  promptKind: VoicePromptKind;
  timingTrace: VoicePromptTimingTrace;
};

export type BuildVoicePromptPlanInput = {
  characterId: string;
  character?: VoicePromptCharacter | null;
  mode: VoicePromptPlanMode;
  promptKind?: VoicePromptKind;
  query?: string;
  currentMoment?: TimeIndex;
  scene?: CuratorScene;
  tokenBudget?: number;
  systemPromptOverride?: string;
  curatedContext?: Pick<
    CurateResult,
    "promptChunk" | "trace" | "pages" | "tokensUsed" | "tokensBudget" | "elapsedMs"
  >;
};

export type VoicePromptPlanDeps = {
  getCharacterById: (id: string) => Promise<VoicePromptCharacter | null>;
  curate: (request: CurateRequest) => Promise<CurateResult>;
};

export class OrchestrationContextError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "OrchestrationContextError";
  }
}

const DEFAULT_CHAT_BUDGET = 3000;
const DEFAULT_VOICE_BUDGET = 2500;

const EMPTY_TRACE: CuratorTrace = {
  totalPages: 0,
  seeds: [],
  edges: [],
  timelineFiltered: [],
  scoreDropped: [],
  budgetDropped: [],
};

export async function buildVoicePromptPlan(
  input: BuildVoicePromptPlanInput,
  deps: VoicePromptPlanDeps,
): Promise<VoicePromptPlan> {
  const timing = createTimingTrace();
  const promptKind = input.promptKind ?? "voice";
  const tokenBudget =
    input.tokenBudget ?? (promptKind === "voice" ? DEFAULT_VOICE_BUDGET : DEFAULT_CHAT_BUDGET);
  const override = input.systemPromptOverride?.trim();

  timing.mark("context.start", {
    mode: input.mode,
    promptKind,
    hasQuery: Boolean(input.query?.trim()),
    hasScene: Boolean(input.scene?.activeEntities?.length || input.scene?.location),
    tokenBudget,
    hasCuratedContext: Boolean(input.curatedContext),
  });

  const character = input.character ?? (await deps.getCharacterById(input.characterId));
  timing.mark("character.loaded", { found: Boolean(character) });
  if (!character) {
    throw new OrchestrationContextError("character not found", 404);
  }

  if (override) {
    timing.mark("prompt.override");
    const timingTrace = timing.toJSON();
    return {
      character,
      systemPrompt: override,
      systemPromptParts: { cached: override, perTurn: "" },
      promptChunk: "",
      trace: EMPTY_TRACE,
      pages: [],
      pageSlugs: [],
      tokensUsed: 0,
      tokensBudget: tokenBudget,
      elapsedMs: Math.round(timingTrace.elapsedMs),
      routingMode: "override",
      promptKind,
      timingTrace,
    };
  }

  const curated = input.curatedContext ?? (await runCurator(input, deps, tokenBudget, timing));
  if (input.curatedContext) {
    timing.mark("curator.provided", {
      selectedPages: curated.pages.length,
      tokensUsed: curated.tokensUsed,
      curatorElapsedMs: curated.elapsedMs,
    });
  }

  const systemPromptParts =
    promptKind === "voice"
      ? buildVoiceSystemPromptParts(
          character.title,
          curated.promptChunk,
          character.directive ?? null,
          character.identity ?? null,
          character.voiceStyle ?? null,
        )
      : buildSystemPromptParts(
          character.title,
          curated.promptChunk,
          character.directive ?? null,
          character.identity ?? null,
          character.voiceStyle ?? null,
        );
  const systemPrompt = [systemPromptParts.cached, systemPromptParts.perTurn]
    .filter(Boolean)
    .join("\n\n");

  timing.mark("prompt.built", {
    chars: systemPrompt.length,
    cachedChars: systemPromptParts.cached.length,
    perTurnChars: systemPromptParts.perTurn.length,
    withDirective: Boolean(character.directive),
    withIdentity: Boolean(character.identity),
    withVoiceStyle: Boolean(character.voiceStyle),
  });

  const timingTrace = timing.toJSON();
  const pages = summarizePages(curated.pages);
  return {
    character,
    systemPrompt,
    systemPromptParts,
    promptChunk: curated.promptChunk,
    trace: curated.trace,
    pages,
    pageSlugs: pages.map((p) => p.slug),
    tokensUsed: curated.tokensUsed,
    tokensBudget: curated.tokensBudget,
    elapsedMs: Math.round(timingTrace.elapsedMs),
    routingMode: input.mode,
    promptKind,
    timingTrace,
  };
}

async function runCurator(
  input: BuildVoicePromptPlanInput,
  deps: VoicePromptPlanDeps,
  tokenBudget: number,
  timing: ReturnType<typeof createTimingTrace>,
) {
  timing.mark("curator.start");
  const curated = await deps.curate({
    characterId: input.characterId,
    query: input.query?.trim() || undefined,
    currentMoment: input.currentMoment,
    scene: input.scene,
    tokenBudget,
  });
  timing.mark("curator.done", {
    selectedPages: curated.pages.length,
    tokensUsed: curated.tokensUsed,
    curatorElapsedMs: curated.elapsedMs,
  });
  return curated;
}

function summarizePages(pages: SelectedPage[]): VoicePromptPlanPage[] {
  return pages.map((p) => ({
    slug: p.page.slug,
    title: p.page.title,
    type: p.page.type,
    rendering: p.rendering,
    score: p.score,
    origin: p.origin,
    trail: p.trail,
    tokens: p.tokens,
  }));
}

function createTimingTrace() {
  const startedAt = new Date();
  const started = performance.now();
  const events: VoicePromptTimingTrace["events"] = [];
  return {
    mark(name: string, meta?: Record<string, unknown>) {
      events.push({
        name,
        elapsedMs: Math.round(performance.now() - started),
        ...(meta ? { meta } : {}),
      });
    },
    toJSON(): VoicePromptTimingTrace {
      return {
        startedAt: startedAt.toISOString(),
        elapsedMs: Math.round(performance.now() - started),
        events,
      };
    },
  };
}
