export type AdminAgentMessageRole = "user" | "assistant" | "system";
export type AdminAgentToolKind = "read" | "mutation";
export type AdminAgentToolStatus = "running" | "completed" | "failed";
export type AdminAgentRiskLevel = "low" | "medium" | "high" | "destructive";
export type AdminAgentOperationStatus = "pending" | "approved" | "executing" | "completed" | "failed" | "cancelled";
export type AdminAgentConversationRecord = {
    id: string;
    adminUserId: string | null;
    title: string | null;
    routeContext: unknown;
    model: string | null;
    provider: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
};
export type AdminAgentMessageRecord = {
    id: string;
    conversationId: string;
    role: AdminAgentMessageRole;
    content: string;
    metadata: unknown;
    createdAt: string;
};
export type AdminAgentToolCallRecord = {
    id: string;
    conversationId: string;
    messageId: string | null;
    toolName: string;
    toolKind: AdminAgentToolKind;
    args: unknown;
    resultSummary: unknown;
    status: AdminAgentToolStatus;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
};
export type AdminAgentOperationRecord = {
    id: string;
    conversationId: string;
    toolCallId: string | null;
    toolName: string;
    intent: string;
    riskLevel: AdminAgentRiskLevel;
    status: AdminAgentOperationStatus;
    args: unknown;
    affectedRecords: unknown;
    previewDiff: unknown;
    beforeSnapshot: unknown | null;
    afterSnapshot: unknown | null;
    resultSummary: unknown;
    errorMessage: string | null;
    requiresConfirmation: boolean;
    proposedByUserId: string | null;
    approvedByUserId: string | null;
    approvedAt: string | null;
    executedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
export type AdminAgentContextSummaryRecord = {
    id: string;
    conversationId: string;
    summary: string;
    pinned: boolean;
    sourceMessageCount: number;
    lastMessageId: string | null;
    model: string | null;
    provider: string | null;
    metadata: unknown;
    createdAt: string;
    updatedAt: string;
};
export type AdminAgentConversationDetail = {
    conversation: AdminAgentConversationRecord;
    messages: AdminAgentMessageRecord[];
    operations: AdminAgentOperationRecord[];
    contextSummaries: AdminAgentContextSummaryRecord[];
};
export type CreateConversationInput = {
    id?: string;
    adminUserId?: string | null;
    title?: string | null;
    routeContext?: unknown;
    model?: string | null;
    provider?: string | null;
};
export type AppendMessageInput = {
    id?: string;
    conversationId: string;
    role: AdminAgentMessageRole;
    content: string;
    metadata?: unknown;
};
export type RecordToolCallInput = {
    id?: string;
    conversationId: string;
    messageId?: string | null;
    toolName: string;
    toolKind: AdminAgentToolKind;
    args?: unknown;
    resultSummary?: unknown;
    status: AdminAgentToolStatus;
    errorMessage?: string | null;
    startedAt?: string;
    completedAt?: string | null;
};
export type CreateOperationInput = {
    id?: string;
    conversationId: string;
    toolCallId?: string | null;
    toolName: string;
    intent: string;
    riskLevel: AdminAgentRiskLevel;
    args?: unknown;
    affectedRecords?: unknown;
    previewDiff?: unknown;
    beforeSnapshot?: unknown | null;
    resultSummary?: unknown;
    proposedByUserId?: string | null;
};
export type UpdateOperationInput = Partial<Pick<AdminAgentOperationRecord, "status" | "affectedRecords" | "previewDiff" | "beforeSnapshot" | "afterSnapshot" | "resultSummary" | "errorMessage" | "approvedByUserId" | "approvedAt" | "executedAt">>;
export type CreateContextSummaryInput = {
    id?: string;
    conversationId: string;
    summary: string;
    pinned?: boolean;
    sourceMessageCount?: number;
    lastMessageId?: string | null;
    model?: string | null;
    provider?: string | null;
    metadata?: unknown;
};
export interface AdminAgentStore {
    createConversation(input: CreateConversationInput): Promise<AdminAgentConversationRecord>;
    getConversation(id: string): Promise<AdminAgentConversationRecord | null>;
    getConversationDetail(id: string): Promise<AdminAgentConversationDetail | null>;
    touchConversation(id: string, input?: {
        title?: string | null;
        model?: string | null;
        provider?: string | null;
        routeContext?: unknown;
    }): Promise<void>;
    appendMessage(input: AppendMessageInput): Promise<AdminAgentMessageRecord>;
    listMessages(conversationId: string): Promise<AdminAgentMessageRecord[]>;
    recordToolCall(input: RecordToolCallInput): Promise<AdminAgentToolCallRecord>;
    createOperation(input: CreateOperationInput): Promise<AdminAgentOperationRecord>;
    getOperation(id: string): Promise<AdminAgentOperationRecord | null>;
    updateOperation(id: string, input: UpdateOperationInput): Promise<AdminAgentOperationRecord | null>;
    listOperationsForConversation(conversationId: string): Promise<AdminAgentOperationRecord[]>;
    createContextSummary(input: CreateContextSummaryInput): Promise<AdminAgentContextSummaryRecord>;
    listContextSummaries(conversationId: string, limit?: number): Promise<AdminAgentContextSummaryRecord[]>;
    getLatestContextSummary(conversationId: string): Promise<AdminAgentContextSummaryRecord | null>;
}
export declare function getAdminAgentStore(): AdminAgentStore;
//# sourceMappingURL=admin-agent-store.d.ts.map