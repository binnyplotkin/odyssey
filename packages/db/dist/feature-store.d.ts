export type FeatureRecord = {
    id: string;
    versionId: string;
    title: string;
    description: string | null;
    color: string | null;
    status: string;
    assignee: string | null;
    startDate: string | null;
    endDate: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};
export type CreateFeatureInput = {
    versionId: string;
    title: string;
    description?: string;
    color?: string;
    status: string;
    assignee?: string;
    startDate?: string;
    endDate?: string;
    sortOrder?: number;
};
export type UpdateFeatureInput = Partial<Omit<FeatureRecord, "id" | "createdAt">>;
export interface FeatureStore {
    list(versionId?: string): Promise<FeatureRecord[]>;
    getById(id: string): Promise<FeatureRecord | null>;
    create(input: CreateFeatureInput): Promise<FeatureRecord>;
    update(id: string, input: UpdateFeatureInput): Promise<FeatureRecord | null>;
    remove(id: string): Promise<boolean>;
}
export declare function getFeatureStore(): FeatureStore;
//# sourceMappingURL=feature-store.d.ts.map