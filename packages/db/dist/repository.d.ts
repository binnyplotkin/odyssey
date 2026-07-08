import { WorldDefinition, WorldRecord } from "@odyssey/types";
export type WorldSource = "static" | "dynamic";
export type WorldDetail = {
    source: WorldSource;
    editable: boolean;
    world: WorldDefinition;
    record: WorldRecord | null;
};
export interface WorldRepository {
    listWorlds(): Promise<WorldDefinition[]>;
    getWorldById(worldId: string): Promise<WorldDefinition | null>;
    getWorldDetail(worldId: string): Promise<WorldDetail | null>;
    createWorldFromDefinition(input: {
        prompt: string;
        definition: WorldDefinition;
        status?: "published" | "draft";
    }): Promise<WorldRecord>;
    updateWorld(input: {
        worldId: string;
        definition: WorldDefinition;
    }): Promise<WorldRecord | null>;
}
export declare function getWorldRepository(staticWorlds?: WorldDefinition[]): WorldRepository;
//# sourceMappingURL=repository.d.ts.map