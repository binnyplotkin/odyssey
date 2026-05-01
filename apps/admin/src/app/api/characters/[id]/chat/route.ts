import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCharacterStore } from "@odyssey/db";
import { buildCharacterContext } from "@/lib/character-context";

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
  /**
   * When set to a non-empty string, replaces the entire system prompt and
   * skips the curator. Used by the test-chat "system prompt" tab so the
   * user can isolate model behavior from curator context.
   */
  systemPromptOverride?: string;
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
        const override = body.systemPromptOverride?.trim();
        const context = await buildCharacterContext({
          characterId: character.id,
          character,
          mode: override ? "override" : "chat-turn",
          promptKind: "chat",
          query: message,
          currentMoment: body.moment,
          scene: body.scene,
          tokenBudget: body.tokenBudget ?? 3000,
          systemPromptOverride: override,
        });
        const systemPrompt = context.systemPrompt;
        send("curator", {
          trace: context.trace,
          pages: context.pages,
          promptChunk: context.promptChunk,
          tokensUsed: context.tokensUsed,
          tokensBudget: context.tokensBudget,
          elapsedMs: context.elapsedMs,
          systemPrompt,
          overridden: context.routingMode === "override",
          routingMode: context.routingMode,
          promptKind: context.promptKind,
          timingTrace: context.timingTrace,
        });

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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
