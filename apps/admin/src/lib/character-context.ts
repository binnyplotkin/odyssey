import {
  getCharacterStore,
  type CharacterRecord,
  type TimeIndex,
} from "@odyssey/db";
import {
  curate,
  type CuratorTrace,
  type Scene,
} from "@odyssey/wiki-curator";
import {
  buildVoicePromptPlan,
  OrchestrationContextError,
  type VoicePromptPlan,
} from "@odyssey/orchestration/server";
import type { TraceContract } from "@/lib/voice-trace";

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
  /**
   * The full assembled system prompt — `cached + "\n\n" + perTurn`. Use
   * this when you need a single string (preview endpoints, debugging,
   * voice paths that don't yet support multi-block system).
   */
  systemPrompt: string;
  /**
   * The same prompt, split for Anthropic's `cache_control` API. Pass
   * `cached` as a block with `cache_control: { type: "ephemeral" }` and
   * `perTurn` as a separate un-cached block. See
   * `buildSystemPromptParts` for the cache profile rationale.
   *
   * Always populated. When override mode is on, `cached` holds the
   * override and `perTurn` is empty.
   */
  systemPromptParts: { cached: string; perTurn: string };
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

export class CharacterContextError extends OrchestrationContextError {
  constructor(message: string, status = 500) {
    super(message, status);
    this.name = "CharacterContextError";
  }
}

export async function buildCharacterContext(
  input: BuildCharacterContextInput,
): Promise<BuiltCharacterContext> {
  try {
    const plan: VoicePromptPlan = await buildVoicePromptPlan(
      {
        characterId: input.characterId,
        character: input.character ?? null,
        mode: input.mode,
        promptKind: input.promptKind ?? "chat",
        query: input.query,
        currentMoment: input.currentMoment,
        scene: input.scene,
        tokenBudget: input.tokenBudget,
        systemPromptOverride: input.systemPromptOverride,
      },
      {
        getCharacterById: (id) => getCharacterStore().getById(id),
        curate,
      },
    );
    return plan as BuiltCharacterContext;
  } catch (err) {
    if (err instanceof OrchestrationContextError) {
      throw new CharacterContextError(err.message, err.status);
    }
    throw err;
  }
}
