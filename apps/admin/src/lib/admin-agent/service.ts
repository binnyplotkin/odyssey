import {
  getAdminAgentStore,
  type AdminAgentContextSummaryRecord,
  type AdminAgentMessageRecord,
  type AdminAgentOperationRecord,
  type AdminAgentStore,
} from "@odyssey/db";
import { getChatProviderForModel } from "@odyssey/engine";
import { buildAdminAgentSystemContext } from "./context";
import {
  dryRunMutationTool,
  executeMutationTool,
  getAdminAgentToolKind,
  getToolManifest,
  runReadTool,
} from "./tools";
import type {
  AdminAgentContext,
  AdminAgentModelOutput,
  AdminAgentRouteContext,
  AdminAgentStreamEvent,
  AdminAgentUser,
} from "./types";

type RunAgentInput = {
  conversationId?: string;
  message: string;
  routeContext?: AdminAgentRouteContext;
  adminUser: AdminAgentUser;
  onEvent: (event: AdminAgentStreamEvent) => void;
};

const MAX_HISTORY_MESSAGES = 16;
const MAX_TOOL_CALLS_PER_TURN = 5;
const MAX_OPERATION_PROPOSALS_PER_TURN = 5;
const SUMMARY_MIN_MESSAGES = 10;
const SUMMARY_EVERY_MESSAGES = 6;
const MAX_SUMMARY_CHARS = 3500;

export function resolveAdminAgentModel() {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return { model: "gpt-5-mini", provider: "openai" as const };
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return { model: "claude-sonnet-4-5", provider: "anthropic" as const };
  }
  return { model: null, provider: null };
}

export async function runAdminAgentTurn(input: RunAgentInput) {
  const store = getAdminAgentStore();
  const modelChoice = resolveAdminAgentModel();
  const existingConversation = input.conversationId
    ? await store.getConversation(input.conversationId)
    : null;
  if (
    existingConversation?.adminUserId &&
    existingConversation.adminUserId !== input.adminUser.id
  ) {
    throw new Error("Conversation does not belong to the current admin.");
  }
  const conversation =
    existingConversation ??
    await store.createConversation({
      ...(input.conversationId ? { id: input.conversationId } : {}),
      adminUserId: input.adminUser.id,
      title: titleFromMessage(input.message),
      routeContext: input.routeContext ?? {},
      model: modelChoice.model,
      provider: modelChoice.provider,
    });

  const context: AdminAgentContext = {
    adminUser: input.adminUser,
    conversationId: conversation.id,
    routeContext: input.routeContext,
  };

  await store.touchConversation(conversation.id, {
    routeContext: input.routeContext ?? {},
    model: modelChoice.model,
    provider: modelChoice.provider,
  });

  await store.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: input.message,
    metadata: { routeContext: input.routeContext ?? null },
  });

  if (!modelChoice.model) {
    const fallback =
      "The admin agent UI and audit trail are available, but no LLM provider key is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY to enable agent reasoning and tool selection.";
    input.onEvent({ type: "message_delta", delta: fallback });
    const assistant = await store.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: fallback,
      metadata: { provider: null, model: null },
    });
    input.onEvent({ type: "done", conversationId: conversation.id, messageId: assistant.id });
    return;
  }

  const systemContext = await buildAdminAgentSystemContext({
    adminUser: input.adminUser,
    routeContext: input.routeContext,
  });
  const latestSummary = await store.getLatestContextSummary(conversation.id);
  const history = await store.listMessages(conversation.id);
  const planner = await completeJson({
    model: modelChoice.model,
    system: buildPlannerSystemPrompt(systemContext, latestSummary),
    messages: historyToChat(history),
  });

  const toolResults: Array<{ name: string; result: unknown }> = [];
  const proposedOperations: AdminAgentOperationRecord[] = [];

  for (const call of (planner.toolCalls ?? []).slice(0, MAX_TOOL_CALLS_PER_TURN)) {
    const args = call.args ?? {};
    input.onEvent({ type: "tool_started", toolName: call.name, toolKind: "read", args });
    const startedAt = new Date().toISOString();
    try {
      const result = await runReadTool(call.name, args, context);
      toolResults.push({ name: call.name, result });
      await store.recordToolCall({
        conversationId: conversation.id,
        toolName: call.name,
        toolKind: "read",
        args,
        resultSummary: result,
        status: "completed",
        startedAt,
      });
      input.onEvent({ type: "tool_result", toolName: call.name, status: "completed", result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.recordToolCall({
        conversationId: conversation.id,
        toolName: call.name,
        toolKind: "read",
        args,
        status: "failed",
        errorMessage: message,
        startedAt,
      });
      input.onEvent({ type: "tool_result", toolName: call.name, status: "failed", error: message });
      toolResults.push({ name: call.name, result: { error: message } });
    }
  }

  for (const proposal of (planner.operationProposals ?? []).slice(0, MAX_OPERATION_PROPOSALS_PER_TURN)) {
    const args = proposal.args ?? {};
    if (getAdminAgentToolKind(proposal.toolName) === "read") {
      input.onEvent({ type: "tool_started", toolName: proposal.toolName, toolKind: "read", args });
      const startedAt = new Date().toISOString();
      try {
        const result = await runReadTool(proposal.toolName, args, context);
        toolResults.push({ name: proposal.toolName, result });
        await store.recordToolCall({
          conversationId: conversation.id,
          toolName: proposal.toolName,
          toolKind: "read",
          args,
          resultSummary: result,
          status: "completed",
          startedAt,
        });
        input.onEvent({ type: "tool_result", toolName: proposal.toolName, status: "completed", result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await store.recordToolCall({
          conversationId: conversation.id,
          toolName: proposal.toolName,
          toolKind: "read",
          args,
          status: "failed",
          errorMessage: message,
          startedAt,
        });
        input.onEvent({ type: "tool_result", toolName: proposal.toolName, status: "failed", error: message });
        toolResults.push({ name: proposal.toolName, result: { error: message } });
      }
      continue;
    }

    input.onEvent({ type: "tool_started", toolName: proposal.toolName, toolKind: "mutation", args });
    const startedAt = new Date().toISOString();
    try {
      const preview = await dryRunMutationTool(proposal.toolName, args, context);
      const toolCall = await store.recordToolCall({
        conversationId: conversation.id,
        toolName: proposal.toolName,
        toolKind: "mutation",
        args,
        resultSummary: preview.resultSummary ?? {},
        status: "completed",
        startedAt,
      });
      const operation = await store.createOperation({
        conversationId: conversation.id,
        toolCallId: toolCall.id,
        toolName: proposal.toolName,
        intent: proposal.intent?.trim() || preview.intent,
        riskLevel: preview.riskLevel,
        args,
        affectedRecords: preview.affectedRecords,
        previewDiff: preview.previewDiff,
        beforeSnapshot: preview.beforeSnapshot ?? null,
        resultSummary: preview.resultSummary ?? {},
        proposedByUserId: input.adminUser.id,
      });
      proposedOperations.push(operation);
      input.onEvent({ type: "operation_proposed", operation });
      input.onEvent({ type: "tool_result", toolName: proposal.toolName, status: "completed", result: preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.recordToolCall({
        conversationId: conversation.id,
        toolName: proposal.toolName,
        toolKind: "mutation",
        args,
        status: "failed",
        errorMessage: message,
        startedAt,
      });
      input.onEvent({ type: "tool_result", toolName: proposal.toolName, status: "failed", error: message });
      toolResults.push({ name: proposal.toolName, result: { error: message } });
    }
  }

  const finalText = await completeText({
    model: modelChoice.model,
    system: buildResponderSystemPrompt(systemContext, latestSummary),
    messages: [
      ...historyToChat(history),
      {
        role: "assistant",
        content: JSON.stringify({
          plannerResponse: planner.response,
          toolResults,
          proposedOperations,
        }),
      },
    ],
  });

  streamText(finalText, input.onEvent);
  const assistant = await store.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: finalText,
    metadata: {
      provider: modelChoice.provider,
      model: modelChoice.model,
      toolResults: toolResults.map((r) => r.name),
      proposedOperations: proposedOperations.map((o) => o.id),
    },
  });

  await maybeUpdateConversationSummary({
    store,
    conversationId: conversation.id,
    model: modelChoice.model,
    provider: modelChoice.provider,
  });

  input.onEvent({
    type: "done",
    conversationId: conversation.id,
    messageId: assistant.id,
    model: modelChoice.model,
    provider: modelChoice.provider,
  });
}

export async function approveAdminAgentOperation(input: {
  operationId: string;
  adminUser: AdminAgentUser;
  onEvent?: (event: AdminAgentStreamEvent) => void;
}) {
  const store = getAdminAgentStore();
  const operation = await store.getOperation(input.operationId);
  if (!operation) throw new Error("Operation not found.");
  if (operation.status !== "pending") {
    throw new Error(`Operation is ${operation.status}; only pending operations can be approved.`);
  }

  const conversation = await store.getConversation(operation.conversationId);
  if (!conversation) throw new Error("Conversation not found for operation.");
  if (conversation.adminUserId && conversation.adminUserId !== input.adminUser.id) {
    throw new Error("Operation does not belong to the current admin.");
  }

  const context: AdminAgentContext = {
    adminUser: input.adminUser,
    conversationId: operation.conversationId,
    routeContext: conversation.routeContext as AdminAgentRouteContext | undefined,
  };

  const approvedAt = new Date().toISOString();
  await store.updateOperation(operation.id, {
    status: "approved",
    approvedByUserId: input.adminUser.id,
    approvedAt,
  });
  const executing = await store.updateOperation(operation.id, { status: "executing" });
  if (executing) input.onEvent?.({ type: "operation_executed", operation: executing });

  try {
    const result = await executeMutationTool(operation.toolName, operation.args, operation, context);
    const completed = await store.updateOperation(operation.id, {
      status: "completed",
      afterSnapshot: result.afterSnapshot ?? null,
      resultSummary: result.resultSummary,
      executedAt: new Date().toISOString(),
    });
    if (!completed) throw new Error("Operation disappeared during execution.");
    await store.appendMessage({
      conversationId: operation.conversationId,
      role: "system",
      content: `Approved and executed operation ${operation.id}: ${operation.intent}`,
      metadata: { operationId: operation.id, result: result.resultSummary },
    });
    input.onEvent?.({ type: "operation_executed", operation: completed });
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await store.updateOperation(operation.id, {
      status: "failed",
      errorMessage: message,
      executedAt: new Date().toISOString(),
    });
    if (failed) input.onEvent?.({ type: "operation_executed", operation: failed });
    throw error;
  }
}

export async function cancelAdminAgentOperation(input: {
  operationId: string;
  adminUser: AdminAgentUser;
  reason?: string;
}) {
  const store = getAdminAgentStore();
  const operation = await store.getOperation(input.operationId);
  if (!operation) throw new Error("Operation not found.");
  if (operation.status !== "pending") {
    throw new Error(`Operation is ${operation.status}; only pending operations can be cancelled.`);
  }

  const conversation = await store.getConversation(operation.conversationId);
  if (!conversation) throw new Error("Conversation not found for operation.");
  if (conversation.adminUserId && conversation.adminUserId !== input.adminUser.id) {
    throw new Error("Operation does not belong to the current admin.");
  }

  const cancelled = await store.updateOperation(operation.id, {
    status: "cancelled",
    errorMessage: input.reason?.trim() || "Cancelled by admin.",
    executedAt: new Date().toISOString(),
  });
  if (!cancelled) throw new Error("Operation disappeared during cancellation.");

  await store.appendMessage({
    conversationId: operation.conversationId,
    role: "system",
    content: `Cancelled operation ${operation.id}: ${operation.intent}`,
    metadata: { operationId: operation.id, reason: input.reason ?? null },
  });

  return cancelled;
}

function buildPlannerSystemPrompt(
  systemContext: string,
  latestSummary?: AdminAgentContextSummaryRecord | null,
) {
  return [
    systemContext,
    "",
    "Conversation memory summary:",
    latestSummary?.summary || "(none yet)",
    "",
    "Available tools:",
    JSON.stringify(getToolManifest()),
    "",
    "Return ONLY valid JSON with this shape:",
    '{"response":"short natural-language note","toolCalls":[{"name":"list_tickets","args":{"limit":10}}],"operationProposals":[{"toolName":"create_ticket","intent":"Create a tracking ticket","args":{"title":"...","status":"backlog"}}]}',
    "Use toolCalls only for read tools. Use operationProposals only for write/delete/bulk/external-side-effect tools.",
    "analyze_sessions is read-only. Always put analyze_sessions in toolCalls, never in operationProposals. Use limit for the number of sessions and criteria as plain string labels.",
    "Prefer query_entities, get_entity_detail, search_entities, trace_entity_context, and analyze_sessions when the user asks broad operational questions across the database.",
    "Use semantic_search_context to gather evidence before answering vague quality, consistency, grounding, or improvement questions, especially for character/session/wiki/eval analysis.",
    "When the user asks about architecture, implementation details, files, routes, APIs, packages, or how the app works, use search_code, read_source_file, list_project_files, or inspect_route_source first.",
    "If a source search returns no matches, try broader source searches with simpler terms or inspect likely app routes/components before asking the admin for search strategy.",
    "Never use source tools to request or reveal secrets, env files, private keys, dependency folders, build outputs, or generated caches.",
    "When the user asks for dynamic content fixes to characters, wikis, wiki pages, voices, roadmap items, or changelog entries, use propose_entity_patch unless a narrower mutation tool is a better fit.",
    "When an audit produces multiple safe content/admin-data changes, prefer one propose_operation_batch containing propose_entity_patch and ticket operations. Do not put deletes, GitHub operations, or destructive work in a batch.",
    "When the user asks you to change code, first gather relevant source context, then propose create_codex_code_task or a Codex PR/issue comment. Do not claim code was pushed, reviewed, or merged unless an approved operation result proves it.",
    "Use merge_github_pull_request only when the user explicitly asks to merge or approves a merge plan; it rechecks PR status and CI at execution time.",
    "If the user asks for a write, do not say it is done. Propose the operation.",
    "If no tool is needed, return empty arrays.",
  ].join("\n");
}

function buildResponderSystemPrompt(
  systemContext: string,
  latestSummary?: AdminAgentContextSummaryRecord | null,
) {
  return [
    systemContext,
    "",
    "Conversation memory summary:",
    latestSummary?.summary || "(none yet)",
    "",
    "You are writing the final visible response for this admin-agent turn.",
    "Use the provided tool results and proposed operations. Be concise and concrete.",
    "If operations were proposed, state that they are awaiting admin approval.",
    "Never ask for approval to run read-only tools or audits. If an audit result is present in toolResults, summarize it directly.",
    "For GitHub/Codex operations, include the repository, issue/PR number, and URL when those are available.",
    "Do not invent database or source-code facts that are not present in tool results.",
  ].join("\n");
}

async function maybeUpdateConversationSummary(input: {
  store: AdminAgentStore;
  conversationId: string;
  model: string;
  provider: string;
}) {
  try {
    const messages = await input.store.listMessages(input.conversationId);
    if (messages.length < SUMMARY_MIN_MESSAGES) return;

    const latestSummary = await input.store.getLatestContextSummary(input.conversationId);
    const summarizedMessageCount = latestSummary?.sourceMessageCount ?? 0;
    if (messages.length - summarizedMessageCount < SUMMARY_EVERY_MESSAGES) return;

    const recentWindow = messages.slice(-24);
    const source = recentWindow
      .map((message) => `${message.role.toUpperCase()} ${message.createdAt}: ${message.content}`)
      .join("\n\n");
    const previous = latestSummary?.summary
      ? `Previous durable summary:\n${latestSummary.summary}\n\n`
      : "";
    const summary = await completeText({
      model: input.model,
      system: [
        "Summarize durable context for a long-running admin AI agent conversation.",
        "Keep facts that future turns need: user goals, decisions, approved/rejected operations, unresolved tasks, entities discussed, route/source context, and constraints.",
        "Do not include secrets or raw hidden prompts. Keep it compact and operational.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: `${previous}Recent conversation messages:\n${source}`,
        },
      ],
      maxTokens: 900,
    });

    await input.store.createContextSummary({
      conversationId: input.conversationId,
      summary: clampSummary(summary),
      sourceMessageCount: messages.length,
      lastMessageId: messages.at(-1)?.id ?? null,
      model: input.model,
      provider: input.provider,
      metadata: {
        previousSummaryId: latestSummary?.id ?? null,
        recentMessageCount: recentWindow.length,
      },
    });
  } catch (error) {
    console.warn("Admin agent context summary update failed", error);
  }
}

async function completeJson(input: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<AdminAgentModelOutput> {
  const text = await completeText(input);
  return parseModelJson(text);
}

async function completeText(input: {
  model: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
}) {
  const provider = getChatProviderForModel(input.model);
  const response = await provider.complete({
    model: input.model,
    system: [{ type: "text", text: input.system }],
    messages: input.messages,
    maxTokens: input.maxTokens ?? 1800,
  });
  return response.text.trim();
}

function parseModelJson(text: string): AdminAgentModelOutput {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned) as AdminAgentModelOutput;
    return {
      response: typeof parsed.response === "string" ? parsed.response : "",
      toolCalls: Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [],
      operationProposals: Array.isArray(parsed.operationProposals) ? parsed.operationProposals : [],
    };
  } catch {
    return { response: text, toolCalls: [], operationProposals: [] };
  }
}

function historyToChat(messages: AdminAgentMessageRecord[]) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
}

function titleFromMessage(message: string) {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > 72 ? `${oneLine.slice(0, 69)}...` : oneLine || "Admin agent chat";
}

function clampSummary(summary: string) {
  const trimmed = summary.replace(/\s+\n/g, "\n").trim();
  return trimmed.length > MAX_SUMMARY_CHARS
    ? `${trimmed.slice(0, MAX_SUMMARY_CHARS - 3)}...`
    : trimmed;
}

function streamText(text: string, onEvent: (event: AdminAgentStreamEvent) => void) {
  const chunkSize = 48;
  for (let i = 0; i < text.length; i += chunkSize) {
    onEvent({ type: "message_delta", delta: text.slice(i, i + chunkSize) });
  }
}
