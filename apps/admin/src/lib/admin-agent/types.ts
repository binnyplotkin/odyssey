import type {
  AdminAgentOperationRecord,
  AdminAgentRiskLevel,
} from "@odyssey/db";
import type { z } from "zod";

export type AdminAgentRouteContext = {
  pathname: string;
  params?: Record<string, string>;
  title?: string;
};

export type AdminAgentUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
};

export type AdminAgentContext = {
  adminUser: AdminAgentUser;
  conversationId: string;
  routeContext?: AdminAgentRouteContext;
};

export type AdminAgentToolResult = {
  summary: string;
  data?: unknown;
};

export type AdminAgentDryRunResult = {
  intent: string;
  riskLevel: AdminAgentRiskLevel;
  affectedRecords: unknown[];
  previewDiff: unknown;
  beforeSnapshot?: unknown;
  resultSummary?: unknown;
};

export type AdminAgentExecutionResult = {
  afterSnapshot?: unknown;
  resultSummary: unknown;
};

export type AdminAgentReadTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  kind: "read";
  name: string;
  description: string;
  inputSchema: TSchema;
  run(args: z.infer<TSchema>, context: AdminAgentContext): Promise<AdminAgentToolResult>;
};

export type AdminAgentMutationTool<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  kind: "mutation";
  name: string;
  description: string;
  inputSchema: TSchema;
  dryRun(args: z.infer<TSchema>, context: AdminAgentContext): Promise<AdminAgentDryRunResult>;
  execute(args: z.infer<TSchema>, operation: AdminAgentOperationRecord, context: AdminAgentContext): Promise<AdminAgentExecutionResult>;
};

export type AdminAgentTool = AdminAgentReadTool | AdminAgentMutationTool;

export type AdminAgentModelOutput = {
  response?: string;
  toolCalls?: Array<{ name: string; args?: unknown }>;
  operationProposals?: Array<{ toolName: string; intent: string; args?: unknown }>;
};

export type AdminAgentStreamEvent =
  | { type: "message_delta"; delta: string }
  | { type: "tool_started"; toolName: string; toolKind: "read" | "mutation"; args: unknown }
  | { type: "tool_result"; toolName: string; status: "completed" | "failed"; result?: unknown; error?: string }
  | { type: "operation_proposed"; operation: AdminAgentOperationRecord }
  | { type: "operation_executed"; operation: AdminAgentOperationRecord }
  | { type: "error"; message: string }
  | { type: "done"; conversationId: string; messageId?: string; model?: string; provider?: string };
