import { NextRequest } from "next/server";
import { getCharacterStore } from "@odyssey/db";
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
 * The curator runs with `query: undefined`, which it interprets as "give me
 * the character's baseline context (voice + core ideas + key entities)".
 * Voice replies are short and conversational — this baseline is enough for
 * 90%+ of voice questions, while query-specific deep retrieval remains
 * available via the regular /chat route.
 */
type ContextBody = {
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

  const fallbackCharacter =
    id === "abraham-fallback" ? { id, slug: "abraham", title: "Abraham" } : null;
  const character = fallbackCharacter ?? (await getCharacterStore().getById(id));
  if (!character) {
    return jsonError(404, "character not found");
  }

  const startedAt = performance.now();
  try {
    const curated = await curate({
      characterId: character.id,
      query: undefined, // baseline — no specific query
      currentMoment: body.moment,
      scene: body.scene,
      tokenBudget: body.tokenBudget ?? 2500,
    });

    return Response.json({
      characterTitle: character.title,
      promptChunk: curated.promptChunk,
      pageSlugs: curated.pages.map((p) => p.page.slug),
      tokensUsed: curated.tokensUsed,
      builtAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - startedAt),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Curator failed.";
    return jsonError(500, message);
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
