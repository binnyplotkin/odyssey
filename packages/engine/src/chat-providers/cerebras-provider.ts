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
 * Cerebras Chat Completions implementation of ChatProvider.
 *
 * Cerebras serves open-weights models (Llama, Qwen, GPT-OSS, GLM, ...)
 * on their wafer-scale silicon with sub-200ms TTFT. The HTTP API is
 * OpenAI-compatible, so we reuse the `openai` SDK pointed at
 * `https://api.cerebras.ai/v1` and benefit from all the same streaming
 * machinery — no second SDK to maintain.
 *
 * Notable differences from OpenAI's own API:
 *   - No prompt cache (open-weights serving) — `cacheState: "off"` always.
 *   - Tools / vision / structured output: model-dependent; registry's
 *     capabilities field is the source of truth. We pass requests through
 *     regardless; the API errors back if a model doesn't support what was
 *     asked.
 *   - Some models lock `temperature` and `top_p` to defaults the same way
 *     OpenAI's reasoning models do. Capability-aware sampling drops the
 *     param up-front (mirrors the OpenAI provider's behavior).
 *   - Voice-first model lineup — most Cerebras IDs are also marked
 *     `modes: ["chat"]` in the registry now, but their character-coherence
 *     at long-form chat is uneven (per the original registry note).
 *     Author beware; eval before adopting.
 */
export class CerebrasChatProvider implements ChatProvider {
  readonly id = "cerebras" as const;

  private readonly client: OpenAI;

  constructor(opts?: {
    apiKey?: string;
    /** Override base URL — defaults to Cerebras production. */
    baseURL?: string;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    const apiKey = opts?.apiKey ?? process.env.CEREBRAS_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("CEREBRAS_API_KEY is required for CerebrasChatProvider");
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: opts?.baseURL ?? "https://api.cerebras.ai/v1",
      maxRetries: opts?.maxRetries ?? 0,
      timeout: opts?.timeoutMs ?? 170_000,
    });
  }

  async complete(opts: ChatRequestOptions): Promise<ChatResponse> {
    const t0 = Date.now();
    const messages = toCerebrasMessages(opts.system, opts.messages);
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
    const messages = toCerebrasMessages(opts.system, opts.messages);
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

/* ── Helpers (mirror OpenAI provider's, kept local so each provider
 *    stays self-contained and the next provider can deviate freely) ── */

function compatibleSampling(opts: ChatRequestOptions): { temperature?: number; top_p?: number } {
  const meta = modelMetaFor(opts.model);
  const out: { temperature?: number; top_p?: number } = {};
  const allowTemp = meta?.capabilities.temperature ?? true;
  const allowTopP = meta?.capabilities.topP ?? true;
  if (allowTemp && typeof opts.temperature === "number") out.temperature = opts.temperature;
  if (allowTopP && typeof opts.topP === "number") out.top_p = opts.topP;
  return out;
}

function toCerebrasMessages(
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
