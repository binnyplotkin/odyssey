import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCharacterStore } from "@odyssey/db";
import { curate, type CurateRequest } from "@odyssey/wiki-curator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/chat
 *
 * Body: {
 *   message: string,
 *   history?: Array<{ role: "user" | "assistant", content: string }>,
 *   moment?: { era: string, index: number },
 *   scene?: { activeEntities?: string[], location?: string },
 *   model?: string,
 *   tokenBudget?: number,
 * }
 *
 * Streams SSE events:
 *   event: "curator"  { trace, pages, promptChunk, tokensUsed, tokensBudget, elapsedMs }
 *   event: "token"    { delta: string }
 *   event: "done"     { outputTokens: number, totalTokens: number }
 *   event: "error"    { message: string }
 */

type ChatBody = {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  moment?: { era: string; index: number };
  scene?: { activeEntities?: string[]; location?: string };
  model?: string;
  tokenBudget?: number;
};

const DEFAULT_MODEL = "claude-sonnet-4-5";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const message = body.message?.trim();
  if (!message) return jsonError(400, "message is required");

  const character = await getCharacterStore().getById(id);
  if (!character) return jsonError(404, "character not found");

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return jsonError(500, "ANTHROPIC_API_KEY is not set on the server.");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // ── Curator ───────────────────────────────────────────────
        const curateReq: CurateRequest = {
          characterId: character.id,
          query: message,
          currentMoment: body.moment,
          scene: body.scene,
          tokenBudget: body.tokenBudget ?? 3000,
        };
        const curated = await curate(curateReq);
        send("curator", {
          trace: curated.trace,
          pages: curated.pages.map((p) => ({
            slug: p.page.slug,
            title: p.page.title,
            type: p.page.type,
            rendering: p.rendering,
            score: p.score,
            origin: p.origin,
            trail: p.trail,
            tokens: p.tokens,
          })),
          promptChunk: curated.promptChunk,
          tokensUsed: curated.tokensUsed,
          tokensBudget: curated.tokensBudget,
          elapsedMs: curated.elapsedMs,
        });

        // ── LLM system prompt: curator chunk + voice directive ───
        const systemPrompt = buildSystemPrompt(
          character.title,
          curated.promptChunk,
        );

        // ── Claude streaming ─────────────────────────────────────
        const anthropic = new Anthropic({ apiKey });
        const modelId = body.model ?? DEFAULT_MODEL;

        const history: Array<{ role: "user" | "assistant"; content: string }> =
          (body.history ?? []).filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          );
        const messages = [
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: message },
        ];

        const resp = anthropic.messages.stream({
          model: modelId,
          system: systemPrompt,
          messages,
          max_tokens: 1024,
        });

        let outputTokens = 0;
        let inputTokens = 0;
        for await (const ev of resp) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            send("token", { delta: ev.delta.text });
          }
          if (ev.type === "message_start" && ev.message.usage) {
            inputTokens = ev.message.usage.input_tokens ?? 0;
          }
          if (ev.type === "message_delta" && ev.usage) {
            outputTokens = ev.usage.output_tokens ?? 0;
          }
        }

        send("done", {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        send("error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function buildSystemPrompt(characterName: string, curatorChunk: string): string {
  return `You are ${characterName}. The context below is what the runtime has pulled from your knowledge graph for this turn — your voice, the people around you, the places you know, the events you've lived.

You speak in first person as ${characterName}. You do not narrate, stage-direct, or refer to yourself in the third person. You do not break character. Your language matches the Voice Identity section exactly — register, idiom, beliefs, taboos.

Stay inside the knowledge the curator surfaced. If asked about something not in your context, say you do not know it — plainly, as you would. Do not invent facts. Do not quote scripture at yourself.

Respond briefly. The cadence is intimate conversation, not exposition.

---

${curatorChunk}`;
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
