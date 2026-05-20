import Anthropic from "@anthropic-ai/sdk";
import type {
  ChatProvider,
  ChatRequestOptions,
  ChatResponse,
  ChatStreamEvent,
  ChatSystemBlock,
} from "./types";

/**
 * Anthropic Messages API implementation of ChatProvider.
 *
 * Maps `ChatSystemBlock` → Anthropic's system array, with
 * `cache_control: { type: "ephemeral" }` applied to any block whose
 * `cacheControl: true` flag is set. That's how the per-character static
 * envelope (L01-L04, ~3k tokens for Abraham) cache-hits across turns
 * within Anthropic's 5-min TTL while the per-turn curator chunk stays
 * un-cached.
 *
 * Pre-v2 the chat route + evals runner each duplicated this mapping +
 * the usage parsing. Both now go through this single provider so the
 * cache_control logic, retry policy, and cache-state derivation live in
 * one place.
 */
export class AnthropicChatProvider implements ChatProvider {
  readonly id = "anthropic" as const;

  private readonly client: Anthropic;
  /** SDK timeout per request — covers TTFT + streaming wall time. Distinct
   * from any outer `AbortSignal` the caller passes. */
  private readonly timeoutMs: number;

  constructor(opts?: {
    apiKey?: string;
    /** Default 170s — slightly below typical outer wall so the outer
     * timeout (if any) gets the last word with a clean error. */
    timeoutMs?: number;
    /** Default 0 — eval/runtime contexts prefer explicit errors over
     * silent SDK retries that can burn 10+ min on Anthropic load spikes. */
    maxRetries?: number;
  }) {
    const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for AnthropicChatProvider");
    }
    this.client = new Anthropic({
      apiKey,
      maxRetries: opts?.maxRetries ?? 0,
      timeout: opts?.timeoutMs ?? 170_000,
    });
    this.timeoutMs = opts?.timeoutMs ?? 170_000;
  }

  async complete(opts: ChatRequestOptions): Promise<ChatResponse> {
    const t0 = Date.now();
    const systemBlocks = toAnthropicSystem(opts.system);
    const hadCacheControl = systemBlocks.some(
      (b) => "cache_control" in b && Boolean(b.cache_control),
    );

    const args: Parameters<typeof this.client.messages.create>[0] = {
      model: opts.model,
      system: systemBlocks,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
    };
    if (typeof opts.temperature === "number") args.temperature = opts.temperature;
    if (typeof opts.topP === "number") args.top_p = opts.topP;

    // `messages.create` returns `Message | Stream`; we never set stream:true
    // so cast through the concrete type. Same trick the evals runner used
    // before this refactor.
    const resp = (await this.client.messages.create(args)) as Anthropic.Messages.Message;

    const text = resp.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const u = resp.usage as {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const inputTokens = u.input_tokens ?? 0;
    const outputTokens = u.output_tokens ?? 0;
    const cacheReadTokens = u.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = u.cache_creation_input_tokens ?? 0;

    return {
      text,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      cacheState: deriveCacheState(cacheReadTokens, cacheCreationTokens, hadCacheControl),
      model: opts.model,
      latencyMs: Date.now() - t0,
    };
  }

  async stream(
    opts: ChatRequestOptions,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> {
    const systemBlocks = toAnthropicSystem(opts.system);
    const hadCacheControl = systemBlocks.some(
      (b) => "cache_control" in b && Boolean(b.cache_control),
    );

    const args: Parameters<typeof this.client.messages.stream>[0] = {
      model: opts.model,
      system: systemBlocks,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
    };
    if (typeof opts.temperature === "number") args.temperature = opts.temperature;
    if (typeof opts.topP === "number") args.top_p = opts.topP;

    try {
      const resp = this.client.messages.stream(args);

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;

      for await (const ev of resp) {
        if (opts.signal?.aborted) {
          // Caller cancelled — break the loop. Anthropic's SDK will see
          // the abort downstream via the controller signal we set on
          // `messages.stream` (when we wire that in a future pass).
          throw new Error("request aborted");
        }
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          onEvent({ type: "token", delta: ev.delta.text });
        }
        if (ev.type === "message_start" && ev.message.usage) {
          const u = ev.message.usage as {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
          inputTokens = u.input_tokens ?? 0;
          cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
          cacheReadTokens = u.cache_read_input_tokens ?? 0;
        }
        if (ev.type === "message_delta" && ev.usage) {
          outputTokens = ev.usage.output_tokens ?? 0;
        }
      }

      onEvent({
        type: "done",
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cacheState: deriveCacheState(cacheReadTokens, cacheCreationTokens, hadCacheControl),
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
 * Maps `ChatSystemBlock[]` → Anthropic's system array shape, applying
 * `cache_control: { type: "ephemeral" }` to any block whose `cacheControl`
 * is true.
 *
 * If no blocks are present, returns a single space (Anthropic rejects an
 * empty system; the space is harmless).
 */
function toAnthropicSystem(blocks: ChatSystemBlock[]) {
  if (blocks.length === 0) {
    return [{ type: "text" as const, text: " " }];
  }
  return blocks
    .filter((b) => b.text.trim().length > 0)
    .map((b) => {
      const out: { type: "text"; text: string; cache_control?: { type: "ephemeral" } } = {
        type: "text",
        text: b.text,
      };
      if (b.cacheControl) out.cache_control = { type: "ephemeral" };
      return out;
    });
}

/**
 * Derive the `cacheState` enum from the usage numbers + whether we
 * actually asked for caching. See the chat route for the original
 * semantics:
 *   HIT      = cached blocks were re-used from a prior turn
 *   WRITE    = cached blocks just got persisted (cold-start)
 *   IGNORED  = we sent cache_control but Anthropic returned 0 cache
 *              tokens (typically: cached block under the per-model
 *              minimum — 1024 tok for Sonnet 4.5, 2048 for Haiku)
 *   OFF      = no cached blocks went out (cacheControl flag was false)
 */
function deriveCacheState(
  cacheReadTokens: number,
  cacheCreationTokens: number,
  hadCacheControl: boolean,
): "hit" | "write" | "ignored" | "off" {
  if (cacheReadTokens > 0) return "hit";
  if (cacheCreationTokens > 0) return "write";
  if (hadCacheControl) return "ignored";
  return "off";
}
