import { NextRequest } from "next/server";
import { getCharacterStore, getSceneSessionStore } from "@odyssey/db";
import { getChatProviderForModel, type ChatSystemBlock } from "@odyssey/engine";
import { buildCharacterContext } from "@/lib/character-context";
import { estimateSessionTurnCost } from "@/lib/session-cost";

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
  sessionId?: string;
  turnId?: string;
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

  // API key check is now per-provider — the ChatProvider constructor
  // throws a clear "<PROVIDER>_API_KEY is required" if the env var is
  // missing, which the stream's try/catch surfaces as an SSE error event.
  // No up-front check here because the right provider depends on which
  // model the character has authored.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const startedAt = new Date();
      let replyText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheReadTokens = 0;
      let cacheCreationTokens = 0;
      let cacheState: string | null = null;
      let selectedProvider: string | null = null;
      let selectedModel: string | null = null;
      let streamError: string | null = null;

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

        // ── Provider-routed streaming ───────────────────────────
        // Resolve per-character mind/model config (L04). Priority:
        //   1. Explicit request body override (used by old test-chat UI)
        //   2. Character's saved brainModel
        //   3. Hardcoded defaults (DEFAULT_MODEL, max_tokens 1024,
        //      provider defaults for temp + top_p)
        const mind = character.brainModel ?? null;
        const modelId = body.model ?? mind?.model ?? DEFAULT_MODEL;
        const maxTokens = mind?.maxTokens ?? 1024;
        const cacheEnabled = mind?.cacheControl !== false; // default true

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

        // Build the system as TWO provider-neutral blocks so the static
        // envelope (identity + directive XML, ~3k tokens for Abraham) gets
        // marked for caching while the per-turn curator chunk stays
        // un-cached. The Anthropic provider applies cache_control; the
        // OpenAI provider concatenates and ignores the cache hint (no
        // OpenAI prompt cache today). See `buildSystemPromptParts` for
        // the split.
        //
        // When brainModel.cacheControl is explicitly false, build the
        // system without the cache flag — useful for cost A/B testing.
        const sysBlocks = buildSystemBlocks(context.systemPromptParts, cacheEnabled);

        const provider = getChatProviderForModel(modelId);
        selectedProvider = provider.id;
        selectedModel = modelId;

        if (body.sessionId && body.turnId) {
          const sessionStore = getSceneSessionStore();
          try {
            await sessionStore.upsertTurn({
              id: body.turnId,
              sessionId: body.sessionId,
              inputMode: "chat",
              userText: message,
              status: "in_progress",
              startedAt: startedAt.toISOString(),
              provider: provider.id,
              model: modelId,
              metadata: { source: "character-sandbox" },
            });
          } catch (turnErr) {
            console.error("[chat] upsertTurn (start) failed", turnErr);
          }
          try {
            await sessionStore.recordContextBuild({
              sessionId: body.sessionId,
              turnId: body.turnId,
              mode: context.routingMode,
              promptKind: context.promptKind,
              query: message,
              scene: body.scene,
              tokenBudget: context.tokensBudget,
              tokensUsed: context.tokensUsed,
              selectedPages: context.pages,
              curatorTrace: context.trace,
              timingTrace: context.timingTrace,
              promptChunk: context.promptChunk,
              systemPrompt: context.systemPrompt,
              metadata: {
                source: "character-sandbox",
                overridden: context.routingMode === "override",
                pageSlugs: context.pageSlugs,
              },
            });
          } catch (ctxErr) {
            console.error("[chat] recordContextBuild failed", ctxErr);
          }
        }

        await provider.stream(
          {
            model: modelId,
            system: sysBlocks,
            messages,
            maxTokens,
            ...(typeof mind?.temperature === "number" ? { temperature: mind.temperature } : {}),
            ...(typeof mind?.topP === "number" ? { topP: mind.topP } : {}),
          },
          (ev) => {
            if (ev.type === "token") {
              replyText += ev.delta;
              send("token", { delta: ev.delta });
            } else if (ev.type === "done") {
              inputTokens = ev.inputTokens;
              outputTokens = ev.outputTokens;
              cacheReadTokens = ev.cacheReadTokens;
              cacheCreationTokens = ev.cacheCreationTokens;
              cacheState = ev.cacheState;
              selectedModel = ev.model;
              const doneCost = estimateSessionTurnCost(ev.model, {
                inputTokens: ev.inputTokens,
                outputTokens: ev.outputTokens,
                cacheReadTokens: ev.cacheReadTokens,
                cacheCreationTokens: ev.cacheCreationTokens,
              });
              // Telemetry — same line the pre-abstraction route logged so
              // operators can grep historical logs the same way.
              console.log(
                `[chat] usage character=${character.slug} provider=${provider.id} model=${ev.model} ` +
                `input=${ev.inputTokens} cache_read=${ev.cacheReadTokens} ` +
                `cache_creation=${ev.cacheCreationTokens} ` +
                `cached_block_chars=${context.systemPromptParts.cached.length}`,
              );
              send("done", {
                inputTokens: ev.inputTokens,
                outputTokens: ev.outputTokens,
                totalTokens:
                  ev.inputTokens + ev.outputTokens + ev.cacheReadTokens + ev.cacheCreationTokens,
                cacheCreationInputTokens: ev.cacheCreationTokens,
                cacheReadInputTokens: ev.cacheReadTokens,
                cacheState: ev.cacheState,
                provider: provider.id,
                model: ev.model,
                estimatedCostUsd: doneCost.estimatedCostUsd,
              });
            } else if (ev.type === "error") {
              streamError = ev.message;
              send("error", { message: ev.message });
            }
          },
        );
        if (streamError) throw new Error(streamError);

        if (body.sessionId && body.turnId) {
          const cost = estimateSessionTurnCost(selectedModel, {
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
          });
          try {
            await getSceneSessionStore().upsertTurn({
              id: body.turnId,
              sessionId: body.sessionId,
              inputMode: "chat",
              userText: message,
              assistantText: replyText,
              provider: selectedProvider,
              model: selectedModel,
              status: "completed",
              startedAt: startedAt.toISOString(),
              completedAt: new Date().toISOString(),
              tokenUsage: {
                input: inputTokens,
                output: outputTokens,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheCreationTokens,
                totalTokens: inputTokens + outputTokens,
                billableTokens:
                  inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
                cacheState,
                estimatedCostUsd: cost.estimatedCostUsd,
              },
              metadata: {
                source: "character-sandbox",
                cost,
              },
              trace: context.timingTrace,
            });
            await getSceneSessionStore().appendEvent({
              sessionId: body.sessionId,
              turnId: body.turnId,
              type: "chat_stream.done",
              source: "system",
              payload: {
                provider: selectedProvider,
                model: selectedModel,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheCreationTokens,
                cacheState,
                estimatedCostUsd: cost.estimatedCostUsd,
              },
            });
          } catch (turnErr) {
            console.error("[chat] upsertTurn (complete) failed", turnErr);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (body.sessionId && body.turnId) {
          try {
            await getSceneSessionStore().upsertTurn({
              id: body.turnId,
              sessionId: body.sessionId,
              inputMode: "chat",
              userText: message,
              assistantText: replyText,
              provider: selectedProvider,
              model: selectedModel,
              status: "errored",
              startedAt: startedAt.toISOString(),
              completedAt: new Date().toISOString(),
              tokenUsage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
              metadata: {
                source: "character-sandbox",
                error: msg,
              },
            });
          } catch (turnErr) {
            console.error("[chat] upsertTurn (error) failed", turnErr);
          }
        }
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

/**
 * Translate `buildSystemPromptParts` output into provider-neutral
 * `ChatSystemBlock[]`. The `cached` block carries the cacheControl hint;
 * the per-turn block doesn't. Providers that support per-block caching
 * (Anthropic) will apply `cache_control: { type: "ephemeral" }`; ones
 * that don't (OpenAI) concatenate the blocks into one system message.
 *
 * When `cacheEnabled` is false, the cacheControl hint is dropped so
 * Anthropic processes the static envelope from scratch every turn —
 * used by L04's cost A/B test toggle.
 */
function buildSystemBlocks(
  parts: { cached: string; perTurn: string },
  cacheEnabled: boolean,
): ChatSystemBlock[] {
  const blocks: ChatSystemBlock[] = [];
  if (parts.cached.trim()) {
    blocks.push({
      type: "text",
      text: parts.cached,
      ...(cacheEnabled ? { cacheControl: true } : {}),
    });
  }
  if (parts.perTurn.trim()) {
    blocks.push({ type: "text", text: parts.perTurn });
  }
  // Defensive fallback — the provider also pads with a single space if
  // we send an empty list, but a sensible non-empty block here keeps the
  // intent clear.
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: " " });
  }
  return blocks;
}
