/**
 * Thin wrapper around @anthropic-ai/sdk.
 *
 * Why a wrapper:
 * - Centralize API key + base URL handling.
 * - Normalize error messages into something the pipeline can render.
 * - Enforce that every call passes a model (swappability — see models.ts).
 * - Keep the call-site in planner/writer ignorant of the SDK version.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import type { ModelId } from "./models";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  // Treat empty-string as unset — shells (.zshrc / .envrc) sometimes export
  // a blank key which would otherwise shadow the one in .env.
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set (or empty). If it's in .env but your shell exports it blank, load dotenv with { override: true }.",
    );
  }
  _client = new Anthropic({
    apiKey,
    // Long ingestion calls (planner/writer on big sources) legitimately run
    // 60–180s; abort at 5 minutes and let the retry ladder reissue instead of
    // hanging on a dead connection until the kernel read-timeout (~6 min).
    // NOTE: the real fix for `read ETIMEDOUT` was STREAMING (see call()) —
    // idle-timeout middleboxes kill silent non-streaming generations. Do not
    // add a node:https Agent here: the admin app's webpack build processes
    // this package and cannot handle `node:` scheme imports.
    timeout: 300_000,
  });
  return _client;
}

export type CallOptions = {
  model: ModelId;
  system: string | Anthropic.TextBlockParam[];
  messages: MessageParam[];
  tools?: Tool[];
  /** Force the model to use a specific tool — keeps structured output reliable. */
  toolChoice?: { type: "tool"; name: string };
  /** Max response tokens. Defaults to 4096 (plenty for an op plan or page). */
  maxTokens?: number;
};

export type CallResult = {
  /** Raw content blocks in the order returned. */
  content: Anthropic.Messages.ContentBlock[];
  /** Input + output tokens consumed. */
  inputTokens: number;
  outputTokens: number;
  /** Total tokens — convenience sum. */
  tokens: number;
  /** Prompt-cache accounting. Anthropic's `input_tokens` EXCLUDES both of
   * these, so a cache-hit call reports a small inputTokens plus a large
   * cacheReadTokens (billed at 0.1×). */
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** The stop reason — `end_turn`, `tool_use`, `max_tokens`, … */
  stopReason: string | null;
};

/** App-level retry on transient API failures, above the SDK's own short
 * retries. A multi-minute ingestion run should not die because one planner
 * call hit a connection blip; backoff is long enough to ride out brief
 * outages. Non-transient errors (4xx, malformed requests) throw immediately. */
const TRANSIENT_RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

function isTransientLlmError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 529) return true;
  if (status != null && status >= 500) return true;
  const message = err instanceof Error ? err.message : "";
  return /connection error|overloaded/i.test(message);
}

/**
 * Single non-streaming call. Returns content blocks; caller decides whether
 * to pull text, tool use, etc. out of them.
 */
export async function call(opts: CallOptions): Promise<CallResult> {
  const client = getClient();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      // Streamed under the hood (accumulated to a single Message): long
      // non-streaming generations sit minutes with ZERO bytes on the wire
      // while the model thinks, and idle-timeout middleboxes kill the silent
      // connection (`read ETIMEDOUT`). SSE deltas keep bytes flowing.
      const res = await client.messages
        .stream({
          model: opts.model,
          system: opts.system,
          messages: opts.messages,
          tools: opts.tools,
          tool_choice: opts.toolChoice,
          max_tokens: opts.maxTokens ?? 4096,
        })
        .finalMessage();

      return {
        content: res.content,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        tokens: res.usage.input_tokens + res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        stopReason: res.stop_reason,
      };
    } catch (err) {
      lastErr = err;
      const delay = TRANSIENT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTransientLlmError(err)) throw err;
      const cause =
        err instanceof Error && err.cause != null ? ` (cause: ${String(err.cause)})` : "";
      console.warn(
        `[wiki-ingest] transient LLM error (attempt ${attempt + 1}/${TRANSIENT_RETRY_DELAYS_MS.length + 1}): ` +
          `${err instanceof Error ? err.message : String(err)}${cause} — retrying in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

/**
 * Extract the first tool_use block of a given name, or throw.
 * The planner and writer both forced tool use via tool_choice, so we expect
 * exactly one tool_use block whose name matches.
 */
export function extractToolUse<T = unknown>(
  result: CallResult,
  toolName: string,
): T {
  for (const block of result.content) {
    if (block.type === "tool_use" && block.name === toolName) {
      return block.input as T;
    }
  }
  const types = result.content.map((b) => b.type).join(", ");
  throw new Error(
    `Expected tool_use "${toolName}" in LLM response; got [${types}]. stop=${result.stopReason}`,
  );
}
