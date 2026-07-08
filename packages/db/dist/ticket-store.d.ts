export type TicketRecord = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    domain: string | null;
    priority: string | null;
    assignee: string | null;
    phase: string | null;
    featureId: string | null;
    sortOrder: number;
    startDate: string | null;
    endDate: string | null;
    subtasks: unknown | null;
    activity: unknown | null;
    createdAt: string;
    updatedAt: string;
};
export type CreateTicketInput = {
    title: string;
    description?: string;
    status: string;
    domain?: string;
    priority?: string;
    assignee?: string;
    phase?: string;
    featureId?: string;
    sortOrder?: number;
    startDate?: string;
    endDate?: string;
    subtasks?: unknown;
    activity?: unknown;
};
export type UpdateTicketInput = Partial<Omit<TicketRecord, "id" | "createdAt">>;
export interface TicketStore {
    list(): Promise<TicketRecord[]>;
    getById(id: string): Promise<TicketRecord | null>;
    create(input: CreateTicketInput): Promise<TicketRecord>;
    update(id: string, input: UpdateTicketInput): Promise<TicketRecord | null>;
    remove(id: string): Promise<boolean>;
    listByFeature(featureId: string): Promise<TicketRecord[]>;
}
export declare function getTicketStore(): TicketStore;
//# sourceMappingURL=ticket-store.d.ts.map