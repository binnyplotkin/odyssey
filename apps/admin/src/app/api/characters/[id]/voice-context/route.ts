import { NextRequest } from "next/server";
import {
  buildCharacterContext,
  CharacterContextError,
} from "@/lib/character-context";
import { getWorldSessionStore } from "@odyssey/db";

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
 * The curator runs with `query: undefined`, which it interprets as "give me
 * the character's baseline context (voice + core ideas + key entities)".
 * Voice replies are short and conversational — this baseline is enough for
 * 90%+ of voice questions, while query-specific deep retrieval remains
 * available via the regular /chat route.
 */
type ContextBody = {
  sessionId?: string;
  turnId?: string;
  moment?: { era: string; index: number };
  scene?: { activeEntities?: string[]; location?: string };
  tokenBudget?: number;
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
      id === "abraham-fallback" ? { id, slug: "abraham", title: "Abraham" } : undefined;
    const context = await buildCharacterContext({
      characterId: id,
      character: fallbackCharacter,
      mode: "voice-baseline",
      promptKind: "voice",
      query: undefined, // baseline — no specific query
      currentMoment: body.moment,
      scene: body.scene,
      tokenBudget: body.tokenBudget ?? 2500,
    });

    if (body.sessionId) {
      await getWorldSessionStore().recordContextBuild({
        sessionId: body.sessionId,
        turnId: body.turnId ?? null,
        mode: context.routingMode,
        promptKind: context.promptKind,
        query: null,
        moment: body.moment,
        scene: body.scene,
        tokenBudget: body.tokenBudget ?? 2500,
        tokensUsed: context.tokensUsed,
        tokensBudget: context.tokensBudget,
        selectedPages: context.pages,
        curatorTrace: context.trace,
        timingTrace: context.timingTrace,
        promptChunk: context.promptChunk,
        systemPrompt: context.systemPrompt,
      });
      await getWorldSessionStore().appendEvent({
        sessionId: body.sessionId,
        type: "context.built",
        source: "system",
        payload: {
          mode: context.routingMode,
          promptKind: context.promptKind,
          tokensUsed: context.tokensUsed,
          selectedPages: context.pages.map((p) => p.slug),
          elapsedMs: context.elapsedMs,
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Curator failed.";
    const status = err instanceof CharacterContextError ? err.status : 500;
    return jsonError(status, message);
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
