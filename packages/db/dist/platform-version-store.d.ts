export type PlatformVersionRecord = {
    id: string;
    version: string;
    title: string;
    summary: string | null;
    status: string;
    releasedAt: string | null;
    createdAt: string;
    updatedAt: string;
};
export type CreatePlatformVersionInput = {
    version: string;
    title: string;
    summary?: string;
    status?: string;
};
export type UpdatePlatformVersionInput = Partial<Omit<PlatformVersionRecord, "id" | "createdAt">>;
export interface PlatformVersionStore {
    list(): Promise<PlatformVersionRecord[]>;
    getById(id: string): Promise<PlatformVersionRecord | null>;
    getByVersion(version: string): Promise<PlatformVersionRecord | null>;
    create(input: CreatePlatformVersionInput): Promise<PlatformVersionRecord>;
    update(id: string, input: UpdatePlatformVersionInput): Promise<PlatformVersionRecord | null>;
    remove(id: string): Promise<boolean>;
}
export declare function getPlatformVersionStore(): PlatformVersionStore;
//# sourceMappingURL=platform-version-store.d.ts.map