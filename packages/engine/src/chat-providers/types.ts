/**
 * Provider-neutral chat call interface.
 *
 * The chat route + evals runner used to talk directly to the Anthropic
 * SDK. Adding a second provider (OpenAI GPT-5) without an abstraction
 * would mean branching on `provider === "openai"` everywhere those calls
 * live. This interface unifies them so callers can `getChatProvider(id)`
 * and not care which SDK is on the other side.
 *
 * Two methods cover the two call sites:
 *   - `complete()` — single-shot, returns the full response (evals)
 *   - `stream()`   — streams tokens as they arrive (chat route SSE)
 *
 * Both take the same `ChatRequestOptions` shape; the provider translates
 * to whatever its SDK wants. Cache control is a hint — providers that
 * don't support it just ignore the flag.
 */

/** A single system-prompt block. Multiple blocks let Anthropic cache the
 * first N (the L01-L04 envelope) while keeping the per-turn curator chunk
 * uncached. OpenAI doesn't have per-block caching today; its provider
 * concatenates the blocks into one system message. */
export type ChatSystemBlock = {
  type: "text";
  text: string;
  /** Hint to the provider — apply prompt caching to this block if supported. */
  cacheControl?: boolean;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequestOptions = {
  /** Model id from the registry. The provider validates it belongs to
   * itself; foreign ids throw before any network call. */
  model: string;
  system: ChatSystemBlock[];
  messages: ChatMessage[];
  /** Sampling. Omit when the model doesn't support a knob; the registry's
   * capabilities field is the source of truth for caller-side gating. */
  temperature?: number;
  topP?: number;
  maxTokens: number;
  /** Optional abort signal — wire to AbortController for cancellation. */
  signal?: AbortSignal;
};

export type ChatStreamEvent =
  | { type: "token"; delta: string }
  | {
      type: "done";
      /** Total input tokens billed (post-cache for Anthropic = uncached portion). */
      inputTokens: number;
      outputTokens: number;
      /** Tokens served from prompt cache (Anthropic only; 0 for others). */
      cacheReadTokens: number;
      /** Tokens written to cache as a cold start (Anthropic only; 0 for others). */
      cacheCreationTokens: number;
      /** "hit" | "write" | "ignored" | "off". See chat route for semantics. */
      cacheState: "hit" | "write" | "ignored" | "off";
      /** The model id that actually ran (after fallback resolution, when wired). */
      model: string;
    }
  | { type: "error"; message: string };

export type ChatResponse = {
  /** Full assembled text (concatenated from streamed tokens for completeness). */
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheState: "hit" | "write" | "ignored" | "off";
  model: string;
  /** Wall time for the whole call (ms). */
  latencyMs: number;
};

export interface ChatProvider {
  /** Provider name, matches `ProviderId` from the registry. */
  readonly id: "anthropic" | "openai" | "cerebras" | "groq";

  /** Single-shot completion — used by the evals runner. Internally may use
   * the SDK's non-streaming endpoint, or wrap stream() and accumulate. */
  complete(opts: ChatRequestOptions): Promise<ChatResponse>;

  /** Streaming variant — used by the admin chat route's SSE. Callers get
   * incremental `token` events followed by exactly one `done` event (or
   * one `error` event if something fails). Errors are reported through
   * the callback rather than thrown so the SSE stream can serialize them
   * before closing. */
  stream(
    opts: ChatRequestOptions,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void>;
}
