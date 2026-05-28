"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AgentComposer } from "./admin-agent-sidebar/agent-composer";
import { AgentHeader } from "./admin-agent-sidebar/agent-header";
import { AgentRail } from "./admin-agent-sidebar/agent-rail";
import { AgentThread } from "./admin-agent-sidebar/agent-thread";
import type {
  ChatMessage,
  Operation,
  ToolCard,
} from "./admin-agent-sidebar/types";
import {
  documentTitle,
  extractParams,
  loadConversation,
  readSse,
  summarizeUnknown,
  upsertOperation,
} from "./admin-agent-sidebar/utils";

const STORAGE_KEY = "odyssey.admin-agent.conversation-id";

export function AdminAgentSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [toolCards, setToolCards] = useState<ToolCard[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return;
    setConversationId(id);
    void loadConversation(id).then((detail) => {
      if (!detail) return;
      setMessages(
        detail.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
      );
      setOperations(detail.operations);
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, operations, toolCards, open]);

  const routeContext = useMemo(
    () => ({
      pathname,
      params: extractParams(pathname ?? ""),
      title: documentTitle(),
    }),
    [pathname],
  );
  const pendingOperationCount = useMemo(
    () =>
      operations.filter((operation) => operation.status === "pending").length,
    [operations],
  );

  const submit = useCallback(async () => {
    const message = draft.trim();
    if (!message || streaming) return;
    setDraft("");
    onOpenChange(true);
    setStreaming(true);
    setToolCards([]);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/admin-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message, routeContext }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Agent request failed.");
      }

      await readSse(response.body, (event) => {
        if (event.type === "message_delta") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + event.delta }
                : m,
            ),
          );
        } else if (event.type === "tool_started") {
          setToolCards((prev) => [
            ...prev,
            {
              id: `${event.toolName}-${Date.now()}-${Math.random()}`,
              toolName: event.toolName,
              status: "running",
              args: event.args,
              detail:
                event.toolKind === "mutation"
                  ? "preparing approval preview"
                  : "reading database",
            },
          ]);
        } else if (event.type === "tool_result") {
          setToolCards((prev) => {
            const idx = prev.findLastIndex(
              (card) =>
                card.toolName === event.toolName && card.status === "running",
            );
            if (idx < 0) return prev;
            return prev.map((card, i) =>
              i === idx
                ? {
                    ...card,
                    status: event.status,
                    detail: event.error ?? summarizeUnknown(event.result),
                    result: event.result,
                  }
                : card,
            );
          });
        } else if (event.type === "operation_proposed") {
          setOperations((prev) => upsertOperation(prev, event.operation));
        } else if (event.type === "operation_executed") {
          setOperations((prev) => upsertOperation(prev, event.operation));
        } else if (event.type === "error") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || event.message }
                : m,
            ),
          );
        } else if (event.type === "done") {
          if (event.conversationId) {
            setConversationId(event.conversationId);
            localStorage.setItem(STORAGE_KEY, event.conversationId);
          }
        }
      });
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content } : m)),
      );
    } finally {
      setStreaming(false);
    }
  }, [conversationId, draft, onOpenChange, routeContext, streaming]);

  const approve = useCallback(async (operationId: string) => {
    setApprovingId(operationId);
    try {
      const response = await fetch(
        `/api/admin-agent/operations/${operationId}/approve`,
        {
          method: "POST",
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Approval failed.");
      setOperations((prev) => upsertOperation(prev, payload.operation));
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Operation ${operationId.slice(0, 8)} ${payload.operation.status}.`,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setApprovingId(null);
    }
  }, []);

  const cancel = useCallback(async (operationId: string) => {
    setCancellingId(operationId);
    try {
      const response = await fetch(
        `/api/admin-agent/operations/${operationId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Rejected in admin agent sidebar." }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Cancellation failed.");
      setOperations((prev) => upsertOperation(prev, payload.operation));
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Operation ${operationId.slice(0, 8)} cancelled.`,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setCancellingId(null);
    }
  }, []);

  return (
    <AgentRail open={open}>
      <AgentHeader
        pathname={pathname}
        pendingCount={pendingOperationCount}
        operationCount={operations.length}
        streaming={streaming}
        onClose={() => onOpenChange(false)}
      />
      <AgentThread
        scrollRef={scrollRef}
        messages={messages}
        toolCards={toolCards}
        operations={operations}
        approvingId={approvingId}
        cancellingId={cancellingId}
        streaming={streaming}
        onApprove={approve}
        onCancel={cancel}
        onUsePrompt={setDraft}
      />
      <AgentComposer
        draft={draft}
        streaming={streaming}
        onDraftChange={setDraft}
        onSubmit={submit}
      />
    </AgentRail>
  );
}
