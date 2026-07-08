import { z } from "zod";
export declare const NODE_KINDS: readonly ["character", "place", "event"];
export type NodeKind = (typeof NODE_KINDS)[number];
export declare const behaviorTriggerSchema: z.ZodObject<{
    condition: z.ZodString;
    behavior: z.ZodString;
}, z.core.$strict>;
export declare const characterDataSchema: z.ZodObject<{
    roleInWorld: z.ZodOptional<z.ZodString>;
    archetype: z.ZodOptional<z.ZodString>;
    emotionalBaseline: z.ZodOptional<z.ZodString>;
    motivations: z.ZodOptional<z.ZodString>;
    speakingStyle: z.ZodOptional<z.ZodString>;
    behaviorTriggers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        condition: z.ZodString;
        behavior: z.ZodString;
    }, z.core.$strict>>>;
    overrides: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
export type CharacterNodeData = z.infer<typeof characterDataSchema>;
export declare const placeDataSchema: z.ZodObject<{
    region: z.ZodOptional<z.ZodString>;
    climate: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const eventDataSchema: z.ZodObject<{
    era: z.ZodOptional<z.ZodString>;
    timeIndex: z.ZodOptional<z.ZodNumber>;
    summary: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const KNOWN_EDGE_KINDS: readonly ["knows", "happens_at", "involves", "member_of", "plays", "parent_of", "allied_with", "opposes"];
export type WorldEdgeKind = (typeof KNOWN_EDGE_KINDS)[number] | (string & {});
export interface WorldNodeRecord {
    id: string;
    worldId: string;
    kind: NodeKind;
    refId: string | null;
    label: string;
    summary: string | null;
    data: Record<string, unknown>;
    position: {
        x: number;
        y: number;
    } | null;
    createdAt: string;
    updatedAt: string;
}
export interface WorldEdgeRecord {
    id: string;
    worldId: string;
    fromNodeId: string;
    toNodeId: string;
    kind: string;
    data: Record<string, unknown>;
    createdAt: string;
}
export interface CreateNodeInput {
    worldId: string;
    kind: NodeKind;
    refId?: string | null;
    label: string;
    summary?: string | null;
    data?: Record<string, unknown>;
    position?: {
        x: number;
        y: number;
    } | null;
}
export interface UpdateNodeInput {
    label?: string;
    summary?: string | null;
    data?: Record<string, unknown>;
    position?: {
        x: number;
        y: number;
    } | null;
}
export interface CreateEdgeInput {
    worldId: string;
    fromNodeId: string;
    toNodeId: string;
    kind: string;
    data?: Record<string, unknown>;
}
export interface WorldGraph {
    nodes: WorldNodeRecord[];
    edges: WorldEdgeRecord[];
}
export interface WorldGraphStore {
    listNodes(worldId: string): Promise<WorldNodeRecord[]>;
    getNode(id: string): Promise<WorldNodeRecord | null>;
    createNode(input: CreateNodeInput): Promise<WorldNodeRecord>;
    updateNode(id: string, input: UpdateNodeInput): Promise<WorldNodeRecord | null>;
    removeNode(id: string): Promise<boolean>;
    ingestCharacter(worldId: string, characterId: string, opts?: {
        label?: string;
        roleInWorld?: string;
        data?: CharacterNodeData;
        position?: {
            x: number;
            y: number;
        };
        mergeOnExist?: boolean;
    }): Promise<WorldNodeRecord>;
    listEdges(worldId: string): Promise<WorldEdgeRecord[]>;
    createEdge(input: CreateEdgeInput): Promise<WorldEdgeRecord>;
    removeEdge(id: string): Promise<boolean>;
    getGraph(worldId: string): Promise<WorldGraph>;
}
export declare function getWorldGraphStore(): WorldGraphStore;
//# sourceMappingURL=world-graph-store.d.ts.map