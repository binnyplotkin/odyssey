export type ChangelogEntryRecord = {
    id: string;
    versionId: string | null;
    title: string;
    body: string | null;
    category: string;
    commitSha: string | null;
    prNumber: number | null;
    prTitle: string | null;
    branch: string | null;
    author: string | null;
    diffSummary: string | null;
    createdAt: string;
};
export type CreateChangelogEntryInput = {
    versionId?: string;
    title: string;
    body?: string;
    category: string;
    commitSha?: string;
    prNumber?: number;
    prTitle?: string;
    branch?: string;
    author?: string;
    diffSummary?: string;
};
export type UpdateChangelogEntryInput = Partial<Omit<ChangelogEntryRecord, "id" | "createdAt">>;
export interface ChangelogStore {
    list(versionId?: string): Promise<ChangelogEntryRecord[]>;
    getById(id: string): Promise<ChangelogEntryRecord | null>;
    create(input: CreateChangelogEntryInput): Promise<ChangelogEntryRecord>;
    update(id: string, input: UpdateChangelogEntryInput): Promise<ChangelogEntryRecord | null>;
    remove(id: string): Promise<boolean>;
}
export declare function getChangelogStore(): ChangelogStore;
//# sourceMappingURL=changelog-store.d.ts.map