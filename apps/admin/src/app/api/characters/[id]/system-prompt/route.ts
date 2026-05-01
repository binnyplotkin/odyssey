import { NextRequest, NextResponse } from "next/server";
import {
  buildCharacterContext,
  CharacterContextError,
} from "@/lib/character-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/system-prompt
 *
 * Runs the curator with the given scene/moment + a placeholder query and
 * returns the assembled system prompt as it would be sent to the LLM. Used
 * by the test-chat "Prompt" tab so the user can see the resolved prompt
 * before sending a turn.
 */

type Body = {
  moment?: { era: string; index: number };
  scene?: { activeEntities?: string[]; location?: string };
  tokenBudget?: number;
  /** Optional probe query — defaults to a generic placeholder. */
  query?: string;
};

const PLACEHOLDER_QUERY = "tell me about yourself";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim() || PLACEHOLDER_QUERY;

  try {
    const context = await buildCharacterContext({
      characterId: id,
      mode: "prompt-preview",
      promptKind: "chat",
      query,
      currentMoment: body.moment,
      scene: body.scene,
      tokenBudget: body.tokenBudget ?? 3000,
    });
    return NextResponse.json({
      systemPrompt: context.systemPrompt,
      promptChunk: context.promptChunk,
      tokensUsed: context.tokensUsed,
      tokensBudget: context.tokensBudget,
      elapsedMs: context.elapsedMs,
      query,
      trace: context.trace,
      pages: context.pages,
      routingMode: context.routingMode,
      timingTrace: context.timingTrace,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof CharacterContextError ? err.status : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
