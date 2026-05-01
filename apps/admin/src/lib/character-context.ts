import {
  getCharacterStore,
  type CharacterRecord,
  type TimeIndex,
} from "@odyssey/db";
import {
  curate,
  type CuratorTrace,
  type Scene,
  type SelectedPage,
} from "@odyssey/wiki-curator";
import {
  buildSystemPrompt,
  buildVoiceSystemPrompt,
} from "@/lib/character-system-prompt";
import { TraceEnvelope, type TraceContract } from "@/lib/voice-trace";

export type CharacterContextMode =
  | "chat-turn"
  | "prompt-preview"
  | "voice-baseline"
  | "override";

export type CharacterPromptKind = "chat" | "voice";

export type CharacterContextTimingEvent = TraceContract["events"][number];
export type CharacterContextTimingTrace = TraceContract;

export type CharacterContextPage = {
  slug: string;
  title: string;
  type: string;
  rendering: "full" | "summary" | "title";
  score: number;
  origin: string;
  trail: string[];
  tokens: number;
};

export type BuildCharacterContextInput = {
  characterId: string;
  mode: CharacterContextMode;
  promptKind?: CharacterPromptKind;
  query?: string;
  currentMoment?: TimeIndex;
  scene?: Scene;
  tokenBudget?: number;
  systemPromptOverride?: string;
  character?: CharacterRecord | LightweightCharacter;
};

export type BuiltCharacterContext = {
  character: CharacterRecord | LightweightCharacter;
  systemPrompt: string;
  promptChunk: string;
  trace: CuratorTrace;
  pages: CharacterContextPage[];
  pageSlugs: string[];
  tokensUsed: number;
  tokensBudget: number;
  elapsedMs: number;
  routingMode: CharacterContextMode;
  promptKind: CharacterPromptKind;
  timingTrace: CharacterContextTimingTrace;
};

type LightweightCharacter = Pick<CharacterRecord, "id" | "slug" | "title">;

export class CharacterContextError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "CharacterContextError";
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

export async function buildCharacterContext(
  input: BuildCharacterContextInput,
): Promise<BuiltCharacterContext> {
  const trace = new TraceEnvelope();

  const promptKind = input.promptKind ?? "chat";
  const tokenBudget =
    input.tokenBudget ?? (promptKind === "voice" ? DEFAULT_VOICE_BUDGET : DEFAULT_CHAT_BUDGET);
  const override = input.systemPromptOverride?.trim();

  trace.mark("context.start", {
    mode: input.mode,
    promptKind,
    hasQuery: Boolean(input.query?.trim()),
    hasScene: Boolean(input.scene?.activeEntities?.length || input.scene?.location),
    tokenBudget,
  });

  const character = input.character ?? (await getCharacterStore().getById(input.characterId));
  trace.mark("character.loaded", { found: Boolean(character) });
  if (!character) {
    throw new CharacterContextError("character not found", 404);
  }

  if (override) {
    trace.mark("prompt.override");
    const timingTrace = trace.toJSON();
    return {
      character,
      systemPrompt: override,
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

  trace.mark("curator.start");
  const curated = await curate({
    characterId: character.id,
    query: input.query?.trim() || undefined,
    currentMoment: input.currentMoment,
    scene: input.scene,
    tokenBudget,
  });
  trace.mark("curator.done", {
    selectedPages: curated.pages.length,
    tokensUsed: curated.tokensUsed,
    curatorElapsedMs: curated.elapsedMs,
  });

  const systemPrompt =
    promptKind === "voice"
      ? buildVoiceSystemPrompt(character.title, curated.promptChunk)
      : buildSystemPrompt(character.title, curated.promptChunk);
  trace.mark("prompt.built", { chars: systemPrompt.length });

  const timingTrace = trace.toJSON();
  return {
    character,
    systemPrompt,
    promptChunk: curated.promptChunk,
    trace: curated.trace,
    pages: summarizePages(curated.pages),
    pageSlugs: curated.pages.map((p) => p.page.slug),
    tokensUsed: curated.tokensUsed,
    tokensBudget: curated.tokensBudget,
    elapsedMs: Math.round(timingTrace.elapsedMs),
    routingMode: input.mode,
    promptKind,
    timingTrace,
  };
}

function summarizePages(pages: SelectedPage[]): CharacterContextPage[] {
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
