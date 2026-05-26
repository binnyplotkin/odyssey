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
 * Groq Chat Completions implementation of ChatProvider.
 *
 * Groq exposes an OpenAI-compatible endpoint at `/openai/v1`, so this
 * mirrors the OpenAI/Cerebras providers while keeping API-key validation,
 * base URL, and provider identity separate.
 */
export class GroqChatProvider implements ChatProvider {
  readonly id = "groq" as const;

  private readonly client: OpenAI;

  constructor(opts?: {
    apiKey?: string;
    baseURL?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    const apiKey = opts?.apiKey ?? process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is required for GroqChatProvider");
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: opts?.baseURL ?? "https://api.groq.com/openai/v1",
      maxRetries: opts?.maxRetries ?? 0,
      timeout: opts?.timeoutMs ?? 170_000,
    });
  }

  async complete(opts: ChatRequestOptions): Promise<ChatResponse> {
    const t0 = Date.now();
    const messages = toGroqMessages(opts.system, opts.messages);
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
    const messages = toGroqMessages(opts.system, opts.messages);
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

function compatibleSampling(opts: ChatRequestOptions): { temperature?: number; top_p?: number } {
  const meta = modelMetaFor(opts.model);
  const out: { temperature?: number; top_p?: number } = {};
  const allowTemp = meta?.capabilities.temperature ?? true;
  const allowTopP = meta?.capabilities.topP ?? true;
  if (allowTemp && typeof opts.temperature === "number") out.temperature = opts.temperature;
  if (allowTopP && typeof opts.topP === "number") out.top_p = opts.topP;
  return out;
}

function toGroqMessages(
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
