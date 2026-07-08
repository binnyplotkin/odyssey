var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var _a;
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, worldNodesTable, worldsTable } from "./schema";
import { isoNow } from "@odyssey/utils";
import { worldRecordSchema } from "@odyssey/types";
const globalWorldStore = globalThis;
const memoryWorldStore = (_a = globalWorldStore.__odysseyWorldStore) !== null && _a !== void 0 ? _a : (globalWorldStore.__odysseyWorldStore = {
    worlds: new Map(),
});
function mergeWorlds(staticWorlds, dynamicWorlds) {
    const merged = new Map();
    staticWorlds.forEach((world) => {
        merged.set(world.id, world);
    });
    dynamicWorlds.forEach((world) => {
        merged.set(world.id, world);
    });
    return Array.from(merged.values());
}
function getStaticWorld(staticWorlds, worldId) {
    var _a;
    return (_a = staticWorlds.find((world) => world.id === worldId)) !== null && _a !== void 0 ? _a : null;
}
/**
 * Normalize a world definition that may use pre-rename field names
 * (factions→groups, factionId→groupId, politicalStability→stability, etc.)
 */
function normalizeDefinition(raw) {
    var _a, _b, _c, _d, _e, _f;
    if (!raw || typeof raw !== "object")
        return raw;
    const def = raw;
    // groups / factions
    const groups = Array.isArray(def.groups)
        ? def.groups
        : Array.isArray(def.factions)
            ? def.factions
            : undefined;
    // characters: factionId → groupId
    const characters = Array.isArray(def.characters)
        ? def.characters.map((c) => {
            if (!c || typeof c !== "object")
                return c;
            const ch = c;
            if (ch.groupId === undefined && ch.factionId !== undefined) {
                const { factionId } = ch, rest = __rest(ch, ["factionId"]);
                return Object.assign(Object.assign({}, rest), { groupId: factionId });
            }
            return ch;
        })
        : undefined;
    // initialState: old field names → new
    let initialState = def.initialState;
    if (initialState && typeof initialState === "object") {
        const s = initialState;
        const stability = ((_a = s.stability) !== null && _a !== void 0 ? _a : s.politicalStability);
        const morale = ((_b = s.morale) !== null && _b !== void 0 ? _b : s.publicSentiment);
        const resources = ((_c = s.resources) !== null && _c !== void 0 ? _c : s.treasury);
        const pressure = ((_e = (_d = s.pressure) !== null && _d !== void 0 ? _d : s.militaryPressure) !== null && _e !== void 0 ? _e : s.warPressure);
        // Synthesize metricValues from legacy flat fields if absent
        let metricValues = s.metricValues;
        if (!metricValues || Object.keys(metricValues).length === 0) {
            metricValues = {};
            if (stability !== undefined)
                metricValues.stability = stability;
            if (morale !== undefined)
                metricValues.morale = morale;
            if (resources !== undefined)
                metricValues.resources = resources;
            if (pressure !== undefined)
                metricValues.pressure = pressure;
        }
        initialState = Object.assign(Object.assign({}, s), { stability,
            morale,
            resources,
            pressure,
            metricValues, groupInfluence: (_f = s.groupInfluence) !== null && _f !== void 0 ? _f : s.factionInfluence });
    }
    return Object.assign(Object.assign(Object.assign(Object.assign({}, def), (groups !== undefined ? { groups } : {})), (characters !== undefined ? { characters } : {})), (initialState !== undefined ? { initialState } : {}));
}
function parseWorldRow(row) {
    return worldRecordSchema.parse({
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        status: row.status,
        definition: normalizeDefinition(row.definition),
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    });
}
function isMissingWorldsTableError(error) {
    var _a, _b;
    const code = (_a = error === null || error === void 0 ? void 0 : error.code) !== null && _a !== void 0 ? _a : (_b = error === null || error === void 0 ? void 0 : error.cause) === null || _b === void 0 ? void 0 : _b.code;
    return code === "42P01";
}
/**
 * Graph-is-source-of-truth hydration.
 *
 * If the world has character nodes in the unified graph, synthesize the
 * `WorldDefinition.characters[]` array from them (merged with any existing
 * entry for default-filling). The engine keeps reading `world.characters`
 * synchronously; this function is the seam between the graph and the legacy
 * JSONB shape. Worlds with no graph character nodes pass through untouched
 * so non-migrated worlds keep working.
 */
async function hydrateCharactersFromGraph(worldId, definition) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const db = getDb();
    if (!db)
        return definition;
    let nodes;
    try {
        nodes = await retryRead(() => db
            .select()
            .from(worldNodesTable)
            .where(and(eq(worldNodesTable.worldId, worldId), eq(worldNodesTable.kind, "character"))));
    }
    catch (error) {
        if (isMissingWorldsTableError(error))
            return definition;
        throw error;
    }
    if (nodes.length === 0)
        return definition;
    const refIds = nodes.map((n) => n.refId).filter((id) => !!id);
    if (refIds.length === 0)
        return definition;
    const chars = await retryRead(() => db
        .select({
        id: charactersTable.id,
        slug: charactersTable.slug,
        title: charactersTable.title,
    })
        .from(charactersTable)
        .where(inArray(charactersTable.id, refIds)));
    const charById = new Map(chars.map((c) => [c.id, c]));
    const existingBySlug = new Map(definition.characters.map((c) => [c.id, c]));
    const hydrated = [];
    const seenSlugs = new Set();
    for (const node of nodes) {
        if (!node.refId)
            continue;
        const global = charById.get(node.refId);
        if (!global)
            continue;
        const slug = global.slug;
        seenSlugs.add(slug);
        const data = ((_a = node.data) !== null && _a !== void 0 ? _a : {});
        const overrides = ((_b = data.overrides) !== null && _b !== void 0 ? _b : {});
        const existing = existingBySlug.get(slug);
        const motivations = (_e = (_d = (_c = overrides.motivationsList) !== null && _c !== void 0 ? _c : (data.motivations ? data.motivations.split("; ").filter(Boolean) : undefined)) !== null && _d !== void 0 ? _d : existing === null || existing === void 0 ? void 0 : existing.motivations) !== null && _e !== void 0 ? _e : ["(unspecified)"];
        const emotionalBaseline = (_g = (_f = overrides.emotionalBaselineScores) !== null && _f !== void 0 ? _f : existing === null || existing === void 0 ? void 0 : existing.emotionalBaseline) !== null && _g !== void 0 ? _g : { anger: 50, fear: 50, hope: 50, loyalty: 50 };
        hydrated.push(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: slug, name: node.label || global.title, title: (_h = existing === null || existing === void 0 ? void 0 : existing.title) !== null && _h !== void 0 ? _h : global.title, archetype: (_k = (_j = data.archetype) !== null && _j !== void 0 ? _j : existing === null || existing === void 0 ? void 0 : existing.archetype) !== null && _k !== void 0 ? _k : "unspecified" }, (overrides.groupId !== undefined ? { groupId: overrides.groupId } : (existing === null || existing === void 0 ? void 0 : existing.groupId) ? { groupId: existing.groupId } : {})), (overrides.groupIds !== undefined ? { groupIds: overrides.groupIds } : (existing === null || existing === void 0 ? void 0 : existing.groupIds) ? { groupIds: existing.groupIds } : {})), { motivations: motivations.length > 0 ? motivations : ["(unspecified)"], emotionalBaseline, speakingStyle: (_m = (_l = data.speakingStyle) !== null && _l !== void 0 ? _l : existing === null || existing === void 0 ? void 0 : existing.speakingStyle) !== null && _m !== void 0 ? _m : "unspecified" }), (overrides.voice !== undefined ? { voice: overrides.voice } : (existing === null || existing === void 0 ? void 0 : existing.voice) ? { voice: existing.voice } : {})), (overrides.backstory !== undefined ? { backstory: overrides.backstory } : (existing === null || existing === void 0 ? void 0 : existing.backstory) ? { backstory: existing.backstory } : {})), (overrides.visualDescription !== undefined ? { visualDescription: overrides.visualDescription } : (existing === null || existing === void 0 ? void 0 : existing.visualDescription) ? { visualDescription: existing.visualDescription } : {})), (overrides.knowledgeDomains !== undefined ? { knowledgeDomains: overrides.knowledgeDomains } : (existing === null || existing === void 0 ? void 0 : existing.knowledgeDomains) ? { knowledgeDomains: existing.knowledgeDomains } : {})), (data.behaviorTriggers !== undefined ? { behaviorTriggers: data.behaviorTriggers } : (existing === null || existing === void 0 ? void 0 : existing.behaviorTriggers) ? { behaviorTriggers: existing.behaviorTriggers } : {})), (overrides.dialogueExamples !== undefined ? { dialogueExamples: overrides.dialogueExamples } : (existing === null || existing === void 0 ? void 0 : existing.dialogueExamples) ? { dialogueExamples: existing.dialogueExamples } : {})), (overrides.secrets !== undefined ? { secrets: overrides.secrets } : (existing === null || existing === void 0 ? void 0 : existing.secrets) ? { secrets: existing.secrets } : {})), (overrides.deathCondition !== undefined ? { deathCondition: overrides.deathCondition } : (existing === null || existing === void 0 ? void 0 : existing.deathCondition) ? { deathCondition: existing.deathCondition } : {})), (overrides.tags !== undefined ? { tags: overrides.tags } : (existing === null || existing === void 0 ? void 0 : existing.tags) ? { tags: existing.tags } : {})), ((existing === null || existing === void 0 ? void 0 : existing.npcRelationships) ? { npcRelationships: existing.npcRelationships } : {})));
    }
    // Preserve characters in the JSONB that aren't yet in the graph
    const legacy = definition.characters.filter((c) => !seenSlugs.has(c.id));
    const merged = [...hydrated, ...legacy];
    if (merged.length === 0)
        return definition;
    return Object.assign(Object.assign({}, definition), { characters: merged });
}
class MemoryWorldRepository {
    constructor(staticWorlds) {
        this.staticWorlds = staticWorlds;
    }
    async listWorlds() {
        const dynamicWorlds = Array.from(memoryWorldStore.worlds.values()).map((record) => record.definition);
        return mergeWorlds(this.staticWorlds, dynamicWorlds);
    }
    async getWorldById(worldId) {
        const dynamic = memoryWorldStore.worlds.get(worldId);
        if (dynamic) {
            return dynamic.definition;
        }
        return getStaticWorld(this.staticWorlds, worldId);
    }
    async getWorldDetail(worldId) {
        const dynamic = memoryWorldStore.worlds.get(worldId);
        if (dynamic) {
            return {
                source: "dynamic",
                editable: true,
                world: dynamic.definition,
                record: dynamic,
            };
        }
        const staticWorld = getStaticWorld(this.staticWorlds, worldId);
        if (!staticWorld) {
            return null;
        }
        return {
            source: "static",
            editable: false,
            world: staticWorld,
            record: null,
        };
    }
    async createWorldFromDefinition({ prompt, definition, status = "published" }) {
        const timestamp = isoNow();
        const record = worldRecordSchema.parse({
            id: definition.id,
            title: definition.title,
            prompt,
            status,
            definition,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        memoryWorldStore.worlds.set(record.id, record);
        return record;
    }
    async updateWorld({ worldId, definition }) {
        const existing = memoryWorldStore.worlds.get(worldId);
        if (!existing) {
            return null;
        }
        const record = worldRecordSchema.parse(Object.assign(Object.assign({}, existing), { id: worldId, title: definition.title, definition, version: existing.version + 1, updatedAt: isoNow() }));
        memoryWorldStore.worlds.set(worldId, record);
        return record;
    }
}
class NeonWorldRepository {
    constructor(staticWorlds) {
        this.staticWorlds = staticWorlds;
        this.db = getDb();
        this.memoryFallback = new MemoryWorldRepository(staticWorlds);
    }
    async listWorlds() {
        if (!this.db) {
            return mergeWorlds(this.staticWorlds, []);
        }
        const db = this.db;
        try {
            const rows = await retryRead(() => db
                .select()
                .from(worldsTable)
                .where(eq(worldsTable.status, "published"))
                .orderBy(desc(worldsTable.updatedAt)));
            const dynamicWorlds = await Promise.all(rows.map(async (row) => {
                const def = parseWorldRow(row).definition;
                return hydrateCharactersFromGraph(def.id, def);
            }));
            return mergeWorlds(this.staticWorlds, dynamicWorlds);
        }
        catch (error) {
            if (isMissingWorldsTableError(error)) {
                return this.memoryFallback.listWorlds();
            }
            throw error;
        }
    }
    async getWorldById(worldId) {
        if (!this.db) {
            return getStaticWorld(this.staticWorlds, worldId);
        }
        const db = this.db;
        try {
            const rows = await retryRead(() => db
                .select()
                .from(worldsTable)
                .where(eq(worldsTable.id, worldId))
                .limit(1));
            const row = rows[0];
            if (row) {
                const def = parseWorldRow(row).definition;
                return hydrateCharactersFromGraph(def.id, def);
            }
            return getStaticWorld(this.staticWorlds, worldId);
        }
        catch (error) {
            if (isMissingWorldsTableError(error)) {
                return this.memoryFallback.getWorldById(worldId);
            }
            throw error;
        }
    }
    async getWorldDetail(worldId) {
        if (!this.db) {
            const world = getStaticWorld(this.staticWorlds, worldId);
            if (!world) {
                return null;
            }
            return {
                source: "static",
                editable: false,
                world,
                record: null,
            };
        }
        const db = this.db;
        try {
            const rows = await retryRead(() => db
                .select()
                .from(worldsTable)
                .where(eq(worldsTable.id, worldId))
                .limit(1));
            const row = rows[0];
            if (row) {
                const record = parseWorldRow(row);
                const hydrated = await hydrateCharactersFromGraph(record.definition.id, record.definition);
                return {
                    source: "dynamic",
                    editable: true,
                    world: hydrated,
                    record: Object.assign(Object.assign({}, record), { definition: hydrated }),
                };
            }
            const staticWorld = getStaticWorld(this.staticWorlds, worldId);
            if (!staticWorld) {
                return null;
            }
            return {
                source: "static",
                editable: false,
                world: staticWorld,
                record: null,
            };
        }
        catch (error) {
            if (isMissingWorldsTableError(error)) {
                return this.memoryFallback.getWorldDetail(worldId);
            }
            throw error;
        }
    }
    async createWorldFromDefinition({ prompt, definition, status = "published" }) {
        if (!this.db) {
            throw new Error("Neon database unavailable.");
        }
        const now = new Date();
        await this.db.insert(worldsTable).values({
            id: definition.id,
            title: definition.title,
            prompt,
            status,
            definition,
            version: 1,
            createdAt: now,
            updatedAt: now,
        });
        return worldRecordSchema.parse({
            id: definition.id,
            title: definition.title,
            prompt,
            status,
            definition,
            version: 1,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
    }
    async updateWorld({ worldId, definition }) {
        if (!this.db) {
            throw new Error("Neon database unavailable.");
        }
        const db = this.db;
        const existingRows = await retryRead(() => db
            .select()
            .from(worldsTable)
            .where(eq(worldsTable.id, worldId))
            .limit(1));
        const existing = existingRows[0];
        if (!existing) {
            return null;
        }
        const nextVersion = existing.version + 1;
        const updatedAt = new Date();
        await this.db
            .update(worldsTable)
            .set({
            title: definition.title,
            definition,
            version: nextVersion,
            updatedAt,
        })
            .where(eq(worldsTable.id, worldId));
        return worldRecordSchema.parse({
            id: existing.id,
            title: definition.title,
            prompt: existing.prompt,
            status: existing.status,
            definition,
            version: nextVersion,
            createdAt: existing.createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        });
    }
}
export function getWorldRepository(staticWorlds = []) {
    return process.env.DATABASE_URL
        ? new NeonWorldRepository(staticWorlds)
        : new MemoryWorldRepository(staticWorlds);
}
