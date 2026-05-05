import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCharacterStore } from "@odyssey/db";
import { buildVoiceSystemPrompt } from "@/lib/character-system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/voice-chat
 *
 * Streaming chat for voice mode. Skips the curator entirely — the caller
 * supplies a pre-built `promptChunk` (typically obtained from POST
 * /voice-context at the start of the voice session). This shaves ~2s of
 * server-side latency off every reply.
 *
 * Two providers are supported:
 *   - **cerebras** (default): Llama 3.3 70B via the Cerebras Cloud API.
 *     ~80–150ms TTFT thanks to wafer-scale custom silicon.
 *   - **anthropic**: Claude Haiku 4.5. ~600–1200ms TTFT but higher reasoning
 *     quality. Pick this when the character system prompt is heavy or you
 *     want Anthropic-grade output for a specific demo.
 *
 * Body: {
 *   promptChunk?: string;  // cached curator output (empty/missing is OK)
 *   message: string;
 *   history?: Array<{ role: "user" | "assistant"; content: string }>;
 *   provider?: "cerebras" | "anthropic";  // defaults to cerebras
 *   model?: string;        // provider-specific; sensible default per provider
 *   maxTokens?: number;    // default 200 (~1-2 sentences spoken)
 * }
 *
 * Streams SSE events:
 *   event: "token"  { delta: string }
 *   event: "done"   { inputTokens, outputTokens, totalTokens, provider, model }
 *   event: "error"  { message: string }
 */

type LlmProvider = "cerebras" | "anthropic";

type VoiceChatBody = {
  promptChunk?: string;
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  provider?: LlmProvider;
  model?: string;
  maxTokens?: number;
};

// Cerebras model IDs vary across families. Keep this in sync with the
// streaming sibling route's CEREBRAS_DEFAULT_MODEL and with
// DEFAULT_VOICE_MODEL in apps/admin/src/lib/model-registry.ts.
const CEREBRAS_DEFAULT_MODEL = "qwen-3-235b-a22b-instruct-2507";
const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
// 200 tokens is roughly 130-150 words of speech, ~10s of audio at typical
// TTS pace. The prompt nudges the model toward 1-2 sentences; this is a
// hard ceiling that stops runaway replies.
const DEFAULT_MAX_TOKENS = 200;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: VoiceChatBody;
  try {
    body = (await req.json()) as VoiceChatBody;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const message = body.message?.trim();
  if (!message) return jsonError(400, "message is required");
  const promptChunk = body.promptChunk ?? "";

  const character = await getCharacterStore().getById(id);
  if (!character) return jsonError(404, "character not found");

  const provider: LlmProvider = body.provider ?? "cerebras";
  const maxTokens = Math.max(64, Math.min(1024, body.maxTokens ?? DEFAULT_MAX_TOKENS));

  if (provider === "cerebras") {
    const cerebrasKey = process.env.CEREBRAS_API_KEY?.trim();
    if (!cerebrasKey) {
      return jsonError(
        500,
        "CEREBRAS_API_KEY is not set on the server. Set it in .env or pass provider:'anthropic' in the request body.",
      );
    }
  } else {
    const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!anthropicKey) {
      return jsonError(500, "ANTHROPIC_API_KEY is not set on the server.");
    }
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
        const systemPrompt = buildVoiceSystemPrompt(character.title, promptChunk);
        const history: Array<{ role: "user" | "assistant"; content: string }> =
          (body.history ?? []).filter(
            (m) =>
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string" &&
              m.content.trim().length > 0,
          );

        if (provider === "cerebras") {
          await streamFromCerebras({
            apiKey: process.env.CEREBRAS_API_KEY!.trim(),
            model: body.model ?? CEREBRAS_DEFAULT_MODEL,
            systemPrompt,
            history,
            message,
            maxTokens,
            send,
          });
        } else {
          await streamFromAnthropic({
            apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
            model: body.model ?? ANTHROPIC_DEFAULT_MODEL,
            systemPrompt,
            history,
            message,
            maxTokens,
            send,
          });
        }
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

/* ── Provider: Anthropic ────────────────────────────────────────── */

async function streamFromAnthropic(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  maxTokens: number;
  send: (event: string, data: unknown) => void;
}) {
  const anthropic = new Anthropic({ apiKey: opts.apiKey });
  const messages = [
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: opts.message },
  ];

  const resp = anthropic.messages.stream({
    model: opts.model,
    system: opts.systemPrompt,
    messages,
    max_tokens: opts.maxTokens,
  });

  let outputTokens = 0;
  let inputTokens = 0;
  for await (const ev of resp) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      opts.send("token", { delta: ev.delta.text });
    }
    if (ev.type === "message_start" && ev.message.usage) {
      inputTokens = ev.message.usage.input_tokens ?? 0;
    }
    if (ev.type === "message_delta" && ev.usage) {
      outputTokens = ev.usage.output_tokens ?? 0;
    }
  }

  opts.send("done", {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    provider: "anthropic",
    model: opts.model,
  });
}

/* ── Provider: Cerebras ────────────────────────────────────────── */

/**
 * Cerebras exposes an OpenAI-compatible Chat Completions API. We hit it with
 * raw `fetch` (no SDK dep) and adapt their SSE deltas to our event shape.
 *
 * Wire format: `data: {"choices":[{"delta":{"content":"..."}}],"usage":...}`
 * terminated by `data: [DONE]`. Final usage often arrives in the second-to-last
 * frame.
 */
async function streamFromCerebras(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
  maxTokens: number;
  send: (event: string, data: unknown) => void;
}) {
  const messages = [
    { role: "system", content: opts.systemPrompt },
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.message },
  ];

  const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      stream: true,
      max_completion_tokens: opts.maxTokens,
    }),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Cerebras ${resp.status}: ${text.slice(0, 300) || "no body"}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let lineEnd: number;
    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      if (payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          opts.send("token", { delta });
        }
        if (event.usage) {
          inputTokens = event.usage.prompt_tokens ?? inputTokens;
          outputTokens = event.usage.completion_tokens ?? outputTokens;
        }
      } catch {
        // Skip malformed frames — Cerebras occasionally pads with keepalive.
      }
    }
  }

  opts.send("done", {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    provider: "cerebras",
    model: opts.model,
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
