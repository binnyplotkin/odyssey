import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, worldEdgesTable, worldNodesTable, } from "./schema";
/* ── Kind registry ──────────────────────────────────────────────────
 * Adding a new node kind = add an entry here. The Zod schema validates
 * the `data` JSONB column; the registry also declares whether this kind
 * is backed by a library (ref_id required) or native to the world.
 */
export const NODE_KINDS = ["character", "place", "event"];
export const behaviorTriggerSchema = z
    .object({
    condition: z.string().trim().min(1),
    behavior: z.string().trim().min(1),
})
    .strict();
export const characterDataSchema = z
    .object({
    roleInWorld: z.string().trim().min(1).optional(),
    archetype: z.string().trim().min(1).optional(),
    emotionalBaseline: z.string().trim().min(1).optional(),
    motivations: z.string().trim().optional(),
    speakingStyle: z.string().trim().optional(),
    behaviorTriggers: z.array(behaviorTriggerSchema).optional(),
    overrides: z.record(z.string(), z.unknown()).optional(),
})
    .strict();
export const placeDataSchema = z
    .object({
    region: z.string().trim().min(1).optional(),
    climate: z.string().trim().min(1).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
})
    .strict();
export const eventDataSchema = z
    .object({
    era: z.string().trim().min(1).optional(),
    timeIndex: z.number().int().optional(),
    summary: z.string().trim().optional(),
})
    .strict();
const dataSchemasByKind = {
    character: characterDataSchema,
    place: placeDataSchema,
    event: eventDataSchema,
};
const kindsRequiringRef = new Set(["character"]);
function validateNodeData(kind, data) {
    const schema = dataSchemasByKind[kind];
    const parsed = schema.parse(data !== null && data !== void 0 ? data : {});
    return parsed;
}
/* ── Edge kinds ──────────────────────────────────────────────────────
 * Free-string on DB, but we keep a known list here to help editors and
 * catch typos early. Unknown kinds are accepted — just logged as a warn.
 */
export const KNOWN_EDGE_KINDS = [
    "knows",
    "happens_at",
    "involves",
    "member_of",
    "plays",
    "parent_of",
    "allied_with",
    "opposes",
];
/* ── Helpers ─────────────────────────────────────────────────────── */
function toIso(d) {
    return d instanceof Date ? d.toISOString() : String(d);
}
function requireDb() {
    const db = getDb();
    if (!db)
        throw new Error("DATABASE_URL is required for the world graph store");
    return db;
}
function isUniqueViolation(err) {
    // Drizzle wraps Postgres errors; check the full chain for code 23505 or
    // a "duplicate key" message.
    let cur = err;
    while (cur) {
        if (typeof cur === "object" && cur !== null) {
            const c = cur;
            if (c.code === "23505")
                return true;
            if (typeof c.message === "string" && /duplicate key/i.test(c.message))
                return true;
            cur = c.cause;
        }
        else {
            break;
        }
    }
    return false;
}
function normalizeNode(row) {
    var _a, _b;
    return {
        id: row.id,
        worldId: row.worldId,
        kind: row.kind,
        refId: row.refId,
        label: row.label,
        summary: row.summary,
        data: (_a = row.data) !== null && _a !== void 0 ? _a : {},
        position: (_b = row.position) !== null && _b !== void 0 ? _b : null,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}
function normalizeEdge(row) {
    var _a;
    return {
        id: row.id,
        worldId: row.worldId,
        fromNodeId: row.fromNodeId,
        toNodeId: row.toNodeId,
        kind: row.kind,
        data: (_a = row.data) !== null && _a !== void 0 ? _a : {},
        createdAt: toIso(row.createdAt),
    };
}
/* ── Implementation ─────────────────────────────────────────────── */
function neonStore() {
    return {
        async listNodes(worldId) {
            const db = requireDb();
            const rows = await retryRead(() => db
                .select()
                .from(worldNodesTable)
                .where(eq(worldNodesTable.worldId, worldId)));
            return rows.map(normalizeNode).sort((a, b) => a.label.localeCompare(b.label));
        },
        async getNode(id) {
            const db = requireDb();
            const [row] = await retryRead(() => db
                .select()
                .from(worldNodesTable)
                .where(eq(worldNodesTable.id, id))
                .limit(1));
            return row ? normalizeNode(row) : null;
        },
        async createNode(input) {
            var _a, _b, _c;
            if (!NODE_KINDS.includes(input.kind)) {
                throw new Error(`Unknown node kind: ${input.kind}`);
            }
            if (kindsRequiringRef.has(input.kind) && !input.refId) {
                throw new Error(`kind='${input.kind}' requires refId`);
            }
            if (!kindsRequiringRef.has(input.kind) && input.refId) {
                throw new Error(`kind='${input.kind}' must not carry refId`);
            }
            const data = validateNodeData(input.kind, input.data);
            // If backed by a library (characters), validate the referenced row exists.
            if (input.kind === "character" && input.refId) {
                const db = requireDb();
                const refId = input.refId;
                const [c] = await retryRead(() => db
                    .select({ id: charactersTable.id })
                    .from(charactersTable)
                    .where(eq(charactersTable.id, refId))
                    .limit(1));
                if (!c)
                    throw new Error(`character ${input.refId} not found`);
            }
            const db = requireDb();
            const [row] = await db
                .insert(worldNodesTable)
                .values({
                worldId: input.worldId,
                kind: input.kind,
                refId: (_a = input.refId) !== null && _a !== void 0 ? _a : null,
                label: input.label,
                summary: (_b = input.summary) !== null && _b !== void 0 ? _b : null,
                data,
                position: (_c = input.position) !== null && _c !== void 0 ? _c : null,
            })
                .returning();
            return normalizeNode(row);
        },
        async updateNode(id, input) {
            const db = requireDb();
            const [existing] = await retryRead(() => db
                .select()
                .from(worldNodesTable)
                .where(eq(worldNodesTable.id, id))
                .limit(1));
            if (!existing)
                return null;
            const values = { updatedAt: new Date() };
            if (input.label !== undefined)
                values.label = input.label;
            if (input.summary !== undefined)
                values.summary = input.summary;
            if (input.position !== undefined)
                values.position = input.position;
            if (input.data !== undefined) {
                values.data = validateNodeData(existing.kind, input.data);
            }
            const [row] = await db
                .update(worldNodesTable)
                .set(values)
                .where(eq(worldNodesTable.id, id))
                .returning();
            return row ? normalizeNode(row) : null;
        },
        async removeNode(id) {
            const db = requireDb();
            const result = await db
                .delete(worldNodesTable)
                .where(eq(worldNodesTable.id, id))
                .returning();
            return result.length > 0;
        },
        async ingestCharacter(worldId, characterId, opts) {
            var _a, _b, _c, _d;
            const db = requireDb();
            const [character] = await retryRead(() => db
                .select({ id: charactersTable.id, title: charactersTable.title })
                .from(charactersTable)
                .where(eq(charactersTable.id, characterId))
                .limit(1));
            if (!character)
                throw new Error(`character ${characterId} not found`);
            const incomingData = Object.assign(Object.assign({}, ((opts === null || opts === void 0 ? void 0 : opts.roleInWorld) ? { roleInWorld: opts.roleInWorld } : {})), ((_a = opts === null || opts === void 0 ? void 0 : opts.data) !== null && _a !== void 0 ? _a : {}));
            const [existing] = await retryRead(() => db
                .select()
                .from(worldNodesTable)
                .where(and(eq(worldNodesTable.worldId, worldId), eq(worldNodesTable.kind, "character"), eq(worldNodesTable.refId, characterId)))
                .limit(1));
            if (existing) {
                if (!(opts === null || opts === void 0 ? void 0 : opts.mergeOnExist) || Object.keys(incomingData).length === 0) {
                    return normalizeNode(existing);
                }
                const merged = Object.assign(Object.assign({}, ((_b = existing.data) !== null && _b !== void 0 ? _b : {})), incomingData);
                const validated = validateNodeData("character", merged);
                const [row] = await db
                    .update(worldNodesTable)
                    .set({ data: validated, updatedAt: new Date() })
                    .where(eq(worldNodesTable.id, existing.id))
                    .returning();
                return normalizeNode(row);
            }
            return this.createNode({
                worldId,
                kind: "character",
                refId: characterId,
                label: (_c = opts === null || opts === void 0 ? void 0 : opts.label) !== null && _c !== void 0 ? _c : character.title,
                data: incomingData,
                position: (_d = opts === null || opts === void 0 ? void 0 : opts.position) !== null && _d !== void 0 ? _d : null,
            });
        },
        async listEdges(worldId) {
            const db = requireDb();
            const rows = await retryRead(() => db
                .select()
                .from(worldEdgesTable)
                .where(eq(worldEdgesTable.worldId, worldId)));
            return rows.map(normalizeEdge);
        },
        async createEdge(input) {
            var _a;
            // Both endpoints must be in the same world. FK can't express this, so
            // we check in the app layer.
            const db = requireDb();
            const endpoints = await retryRead(() => db
                .select({ id: worldNodesTable.id, worldId: worldNodesTable.worldId })
                .from(worldNodesTable)
                .where(sql `${worldNodesTable.id} IN (${input.fromNodeId}, ${input.toNodeId})`));
            if (endpoints.length !== 2) {
                throw new Error("edge endpoints not found");
            }
            for (const ep of endpoints) {
                if (ep.worldId !== input.worldId) {
                    throw new Error("edge endpoints must belong to the same world");
                }
            }
            if (input.fromNodeId === input.toNodeId) {
                throw new Error("edge endpoints must differ");
            }
            try {
                const [row] = await db
                    .insert(worldEdgesTable)
                    .values({
                    worldId: input.worldId,
                    fromNodeId: input.fromNodeId,
                    toNodeId: input.toNodeId,
                    kind: input.kind,
                    data: (_a = input.data) !== null && _a !== void 0 ? _a : {},
                })
                    .returning();
                return normalizeEdge(row);
            }
            catch (e) {
                if (isUniqueViolation(e)) {
                    // Edge already exists — fetch and return it for idempotency.
                    const [row] = await retryRead(() => db
                        .select()
                        .from(worldEdgesTable)
                        .where(and(eq(worldEdgesTable.fromNodeId, input.fromNodeId), eq(worldEdgesTable.toNodeId, input.toNodeId), eq(worldEdgesTable.kind, input.kind)))
                        .limit(1));
                    if (row)
                        return normalizeEdge(row);
                }
                throw e;
            }
        },
        async removeEdge(id) {
            const db = requireDb();
            const result = await db
                .delete(worldEdgesTable)
                .where(eq(worldEdgesTable.id, id))
                .returning();
            return result.length > 0;
        },
        async getGraph(worldId) {
            const [nodes, edges] = await Promise.all([
                this.listNodes(worldId),
                this.listEdges(worldId),
            ]);
            return { nodes, edges };
        },
    };
}
/* ── Factory ───────────────────────────────────────────────────── */
let _store = null;
export function getWorldGraphStore() {
    if (!_store)
        _store = neonStore();
    return _store;
}
