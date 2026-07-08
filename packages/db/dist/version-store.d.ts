export type VersionRecord = {
    id: string;
    tag: string;
    title: string;
    description: string | null;
    color: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};
export type CreateVersionInput = {
    tag: string;
    title: string;
    description?: string;
    color: string;
    status: string;
    startDate?: string;
    endDate?: string;
    sortOrder?: number;
};
export type UpdateVersionInput = Partial<Omit<VersionRecord, "id" | "createdAt">>;
export interface VersionStore {
    list(): Promise<VersionRecord[]>;
    getById(id: string): Promise<VersionRecord | null>;
    create(input: CreateVersionInput): Promise<VersionRecord>;
    update(id: string, input: UpdateVersionInput): Promise<VersionRecord | null>;
    remove(id: string): Promise<boolean>;
}
export declare function getVersionStore(): VersionStore;
//# sourceMappingURL=version-store.d.ts.map