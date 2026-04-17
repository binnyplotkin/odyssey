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
import type { ModelId } from "./models.js";

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
  _client = new Anthropic({ apiKey });
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
  /** The stop reason — `end_turn`, `tool_use`, `max_tokens`, … */
  stopReason: string | null;
};

/**
 * Single non-streaming call. Returns content blocks; caller decides whether
 * to pull text, tool use, etc. out of them.
 */
export async function call(opts: CallOptions): Promise<CallResult> {
  const client = getClient();
  const res = await client.messages.create({
    model: opts.model,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.toolChoice,
    max_tokens: opts.maxTokens ?? 4096,
  });

  return {
    content: res.content,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    tokens: res.usage.input_tokens + res.usage.output_tokens,
    stopReason: res.stop_reason,
  };
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
