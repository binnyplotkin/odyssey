import { NextRequest } from "next/server";
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import {
  buildVoicePromptPlan,
  OrchestrationContextError,
} from "@odyssey/orchestration/server";
import {
  sandboxVoiceContextCacheKeyForDebug,
  startSandboxVoiceContextCacheWarm,
} from "@/lib/sandbox-voice-context-cache";
import { curate } from "@odyssey/wiki-curator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/voice-context
 *
 * Returns a baseline curator chunk that voice-mode can cache for the duration
 * of a conversation, so per-turn replies skip the ~2s curator pass.
 *
 * Body: {
 *   moment?: { era: string; index: number };
 *   scene?: { activeEntities?: string[]; location?: string };
 *   tokenBudget?: number;   // default 2500
 * }
 *
 * Response: {
 *   characterTitle: string;
 *   promptChunk: string;
 *   pageSlugs: string[];
 *   tokensUsed: number;
 *   builtAt: string;        // ISO timestamp
 *   elapsedMs: number;
 * }
 *
 * The default warm path runs with `query: undefined`, which the curator
 * interprets as "give me the character's baseline context." Callers may pass
 * `query` when refreshing the session cache after a turn so follow-ups can
 * start from the last topic without putting curation on the first-audio path.
 */
type ContextBody = {
  sessionId?: string;
  turnId?: string;
  moment?: { era: string; index: number };
  scene?: { activeEntities?: string[]; location?: string };
  tokenBudget?: number;
  query?: string;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: ContextBody;
  try {
    body = (await req.json()) as ContextBody;
  } catch {
    body = {};
  }

  try {
    const fallbackCharacter =
      id === "abraham-fallback"
        ? { id, slug: "abraham", title: "Abraham" }
        : null;
    const character =
      fallbackCharacter ??
      (await getCharacterStore().getById(id)) ??
      (await getCharacterStore().getBySlug(id));
    if (!character) return jsonError(404, "character not found");

    const tokenBudget = body.tokenBudget ?? 2500;
    const cachedCurated = await startSandboxVoiceContextCacheWarm({
      characterId: character.id,
      sessionId: body.sessionId,
      query: body.query,
      scene: body.scene,
      tokenBudget,
    });
    const context = await buildVoicePromptPlan(
      {
        characterId: character.id,
        character,
        mode: "voice-baseline",
        promptKind: "voice",
        currentMoment: body.moment,
        scene: body.scene,
        tokenBudget,
        curatedContext: cachedCurated,
      },
      {
        getCharacterById: (characterId) => getCharacterStore().getById(characterId),
        curate,
      },
    );

    const cacheKey = sandboxVoiceContextCacheKeyForDebug({
      characterId: character.id,
      sessionId: body.sessionId,
      scene: body.scene,
      tokenBudget,
    });
    const routingMode = "voice-baseline";
    const promptKind = "voice";

    if (body.sessionId) {
      await getSceneSessionStore().recordContextBuild({
        sessionId: body.sessionId,
        turnId: body.turnId ?? null,
        mode: routingMode,
        promptKind,
        query: body.query?.trim() || null,
        scene: body.scene,
        tokenBudget,
        tokensUsed: context.tokensUsed,
        tokensBudget: context.tokensBudget,
        selectedPages: context.pages,
        curatorTrace: context.trace,
        timingTrace: context.timingTrace,
        promptChunk: context.promptChunk,
        systemPrompt: context.systemPrompt,
        metadata: {
          cacheKey,
          cacheWarmed: true,
          cacheScope: cachedCurated.cacheScope,
          sourceQuery: cachedCurated.sourceQuery,
        },
      });
      await getSceneSessionStore().appendEvent({
        sessionId: body.sessionId,
        type: "context.built",
        source: "system",
        payload: {
          mode: context.routingMode,
          promptKind: context.promptKind,
          tokensUsed: context.tokensUsed,
          selectedPages: context.pages.map((p) => p.slug),
          elapsedMs: context.elapsedMs,
          cacheKey,
          cacheWarmed: true,
        },
      });
    }

    return Response.json({
      characterTitle: context.character.title,
      promptChunk: context.promptChunk,
      systemPrompt: context.systemPrompt,
      pageSlugs: context.pageSlugs,
      pages: context.pages,
      trace: context.trace,
      tokensUsed: context.tokensUsed,
      tokensBudget: context.tokensBudget,
      builtAt: new Date().toISOString(),
      elapsedMs: context.elapsedMs,
      routingMode: context.routingMode,
      timingTrace: context.timingTrace,
      cacheKey,
      cacheWarmed: true,
      cacheScope: cachedCurated.cacheScope,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Curator failed.";
    const status = err instanceof OrchestrationContextError ? err.status : 500;
    return jsonError(status, message);
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
