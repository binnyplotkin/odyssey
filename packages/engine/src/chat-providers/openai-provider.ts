import OpenAI from "openai";
import { modelMetaFor } from "../model-registry";
import type {
  ChatProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamEvent,
  ChatSystemBlock,
} from "./types";

/**
 * OpenAI Chat Completions API implementation of ChatProvider.
 *
 * Notable differences from Anthropic:
 *   - System prompt is a single message (role:"system"), not an array of
 *     blocks. We concatenate the ChatSystemBlocks with `\n\n` separators.
 *   - No prompt caching today, so we always report `cacheState: "off"`
 *     and `cacheRead/CreationTokens: 0`. (OpenAI announced auto-caching
 *     for GPT-5 but no header you opt into; the registry's
 *     `capabilities.promptCache` flag will go true when we wire it.)
 *   - Usage object is `{ prompt_tokens, completion_tokens, total_tokens }`
 *     — mapped to our `inputTokens / outputTokens`.
 *   - Streaming uses Server-Sent Events with `delta.content` per chunk;
 *     a `[DONE]` sentinel ends the stream (handled by the SDK iterator).
 */
export class OpenAIChatProvider implements ChatProvider {
  readonly id = "openai" as const;

  private readonly client: OpenAI;

  constructor(opts?: {
    apiKey?: string;
    /** Default 170s — same conservative ceiling we use for Anthropic. */
    timeoutMs?: number;
    /** Default 0 — see Anthropic provider for rationale. */
    maxRetries?: number;
  }) {
    const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAIChatProvider");
    }
    this.client = new OpenAI({
      apiKey,
      maxRetries: opts?.maxRetries ?? 0,
      timeout: opts?.timeoutMs ?? 170_000,
    });
  }

  async complete(opts: ChatRequestOptions): Promise<ChatResponse> {
    const t0 = Date.now();
    const messages = toOpenAIMessages(opts.system, opts.messages);
    const knobs = compatibleSampling(opts);

    const resp = await this.client.chat.completions.create({
      model: opts.model,
      messages,
      max_completion_tokens: opts.maxTokens,
      ...knobs,
    });

    const text = (resp.choices[0]?.message?.content ?? "").trim();
    const inputTokens = resp.usage?.prompt_tokens ?? 0;
    const outputTokens = resp.usage?.completion_tokens ?? 0;

    return {
      text,
      inputTokens,
      outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheState: "off",
      model: opts.model,
      latencyMs: Date.now() - t0,
    };
  }

  async stream(
    opts: ChatRequestOptions,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> {
    const messages = toOpenAIMessages(opts.system, opts.messages);

    const knobs = compatibleSampling(opts);
    try {
      const stream = await this.client.chat.completions.create({
        model: opts.model,
        messages,
        max_completion_tokens: opts.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...knobs,
      });

      let inputTokens = 0;
      let outputTokens = 0;

      for await (const chunk of stream) {
        if (opts.signal?.aborted) {
          throw new Error("request aborted");
        }
        // The SDK emits per-token chunks with `choices[0].delta.content`
        // and (when `include_usage: true`) a final chunk whose `usage`
        // field carries the totals. Token chunks have `choices` non-empty
        // but `usage` undefined; the totals chunk is the inverse.
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          onEvent({ type: "token", delta });
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      onEvent({
        type: "done",
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheState: "off",
        model: opts.model,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onEvent({ type: "error", message: msg });
    }
  }
}

/* ── Translation helpers ────────────────────────────────────── */

/**
 * Drop sampling params the target model doesn't accept. GPT-5 family
 * locks `temperature` and `top_p` to their default (1.0); sending custom
 * values returns a 400. The registry's `capabilities.temperature` /
 * `.topP` flag is the source of truth — false means "omit even if the
 * caller passed a value". When the registry doesn't know the model
 * (unlisted ids the user typed in manually), we pass the params through
 * and let the API surface its own error.
 */
function compatibleSampling(opts: ChatRequestOptions): { temperature?: number; top_p?: number } {
  const meta = modelMetaFor(opts.model);
  const out: { temperature?: number; top_p?: number } = {};
  const allowTemp = meta?.capabilities.temperature ?? true;
  const allowTopP = meta?.capabilities.topP ?? true;
  if (allowTemp && typeof opts.temperature === "number") out.temperature = opts.temperature;
  if (allowTopP && typeof opts.topP === "number") out.top_p = opts.topP;
  return out;
}

/**
 * Build the OpenAI `messages` array from our system blocks + conversation
 * history. The system blocks get concatenated into one system message
 * because OpenAI doesn't have a per-block array (and doesn't expose
 * cache_control). User/assistant messages pass through unchanged.
 */
function toOpenAIMessages(
  system: ChatSystemBlock[],
  messages: { role: "user" | "assistant"; content: string }[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  const systemText = system
    .filter((b) => b.text.trim().length > 0)
    .map((b) => b.text)
    .join("\n\n");
  if (systemText.length > 0) {
    out.push({ role: "system", content: systemText });
  }
  for (const m of messages) {
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
