export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type Operation = {
  id: string;
  toolName: string;
  intent: string;
  riskLevel: "low" | "medium" | "high" | "destructive";
  status: string;
  affectedRecords: unknown;
  previewDiff: unknown;
  resultSummary: unknown;
  errorMessage?: string | null;
};

export type ToolCard = {
  id: string;
  toolName: string;
  status: "running" | "completed" | "failed";
  args?: unknown;
  detail?: string;
  result?: unknown;
};

export type StreamEvent =
  | { type: "message_delta"; delta: string }
  | { type: "tool_started"; toolName: string; toolKind: "read" | "mutation"; args: unknown }
  | { type: "tool_result"; toolName: string; status: "completed" | "failed"; result?: unknown; error?: string }
  | { type: "operation_proposed"; operation: Operation }
  | { type: "operation_executed"; operation: Operation }
  | { type: "error"; message: string }
  | { type: "done"; conversationId: string; messageId?: string };
