import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { charactersTable, worldNodesTable, worldsTable } from "./schema";
import { isoNow } from "@odyssey/utils";
import { CharacterDefinition, WorldDefinition, worldRecordSchema, WorldRecord } from "@odyssey/types";
import type { CharacterNodeData } from "./world-graph-store";

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
  updateWorld(input: { worldId: string; definition: WorldDefinition }): Promise<WorldRecord | null>;
}

type WorldStoreState = {
  worlds: Map<string, WorldRecord>;
};

const globalWorldStore = globalThis as typeof globalThis & {
  __odysseyWorldStore?: WorldStoreState;
};

const memoryWorldStore =
  globalWorldStore.__odysseyWorldStore ??
  (globalWorldStore.__odysseyWorldStore = {
    worlds: new Map(),
  });

function mergeWorlds(staticWorlds: WorldDefinition[], dynamicWorlds: WorldDefinition[]) {
  const merged = new Map<string, WorldDefinition>();

  staticWorlds.forEach((world) => {
    merged.set(world.id, world);
  });

  dynamicWorlds.forEach((world) => {
    merged.set(world.id, world);
  });

  return Array.from(merged.values());
}

function getStaticWorld(staticWorlds: WorldDefinition[], worldId: string) {
  return staticWorlds.find((world) => world.id === worldId) ?? null;
}

/**
 * Normalize a world definition that may use pre-rename field names
 * (factions→groups, factionId→groupId, politicalStability→stability, etc.)
 */
function normalizeDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const def = raw as Record<string, unknown>;

  // groups / factions
  const groups = Array.isArray(def.groups)
    ? def.groups
    : Array.isArray(def.factions)
      ? def.factions
      : undefined;

  // characters: factionId → groupId
  const characters = Array.isArray(def.characters)
    ? def.characters.map((c: unknown) => {
        if (!c || typeof c !== "object") return c;
        const ch = c as Record<string, unknown>;
        if (ch.groupId === undefined && ch.factionId !== undefined) {
          const { factionId, ...rest } = ch;
          return { ...rest, groupId: factionId };
        }
        return ch;
      })
    : undefined;

  // initialState: old field names → new
  let initialState = def.initialState as Record<string, unknown> | undefined;
  if (initialState && typeof initialState === "object") {
    const s = initialState;
    const stability = (s.stability ?? s.politicalStability) as number | undefined;
    const morale = (s.morale ?? s.publicSentiment) as number | undefined;
    const resources = (s.resources ?? s.treasury) as number | undefined;
    const pressure = (s.pressure ?? s.militaryPressure ?? s.warPressure) as number | undefined;

    // Synthesize metricValues from legacy flat fields if absent
    let metricValues = s.metricValues as Record<string, number> | undefined;
    if (!metricValues || Object.keys(metricValues).length === 0) {
      metricValues = {};
      if (stability !== undefined) metricValues.stability = stability;
      if (morale !== undefined) metricValues.morale = morale;
      if (resources !== undefined) metricValues.resources = resources;
      if (pressure !== undefined) metricValues.pressure = pressure;
    }

    initialState = {
      ...s,
      stability,
      morale,
      resources,
      pressure,
      metricValues,
      groupInfluence: s.groupInfluence ?? s.factionInfluence,
    };
  }

  return {
    ...def,
    ...(groups !== undefined ? { groups } : {}),
    ...(characters !== undefined ? { characters } : {}),
    ...(initialState !== undefined ? { initialState } : {}),
  };
}

function parseWorldRow(row: {
  id: string;
  title: string;
  prompt: string;
  status: string;
  definition: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
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

function isMissingWorldsTableError(error: unknown) {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;

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
async function hydrateCharactersFromGraph(
  worldId: string,
  definition: WorldDefinition,
): Promise<WorldDefinition> {
  const db = getDb();
  if (!db) return definition;

  let nodes: Array<typeof worldNodesTable.$inferSelect>;
  try {
    nodes = await retryRead(() =>
      db
        .select()
        .from(worldNodesTable)
        .where(and(eq(worldNodesTable.worldId, worldId), eq(worldNodesTable.kind, "character"))),
    );
  } catch (error) {
    if (isMissingWorldsTableError(error)) return definition;
    throw error;
  }
  if (nodes.length === 0) return definition;

  const refIds = nodes.map((n) => n.refId).filter((id): id is string => !!id);
  if (refIds.length === 0) return definition;

  const chars = await retryRead(() =>
    db
      .select({
        id: charactersTable.id,
        slug: charactersTable.slug,
        title: charactersTable.title,
      })
      .from(charactersTable)
      .where(inArray(charactersTable.id, refIds)),
  );
  const charById = new Map(chars.map((c) => [c.id, c]));

  const existingBySlug = new Map(definition.characters.map((c) => [c.id, c]));

  const hydrated: CharacterDefinition[] = [];
  const seenSlugs = new Set<string>();

  for (const node of nodes) {
    if (!node.refId) continue;
    const global = charById.get(node.refId);
    if (!global) continue;
    const slug = global.slug;
    seenSlugs.add(slug);

    const data = (node.data ?? {}) as CharacterNodeData;
    const overrides = (data.overrides ?? {}) as Record<string, unknown>;
    const existing = existingBySlug.get(slug);

    const motivations =
      (overrides.motivationsList as string[] | undefined) ??
      (data.motivations ? data.motivations.split("; ").filter(Boolean) : undefined) ??
      existing?.motivations ??
      ["(unspecified)"];

    const emotionalBaseline =
      (overrides.emotionalBaselineScores as CharacterDefinition["emotionalBaseline"] | undefined) ??
      existing?.emotionalBaseline ??
      { anger: 50, fear: 50, hope: 50, loyalty: 50 };

    hydrated.push({
      id: slug,
      name: node.label || global.title,
      title: existing?.title ?? global.title,
      archetype: data.archetype ?? existing?.archetype ?? "unspecified",
      ...(overrides.groupId !== undefined ? { groupId: overrides.groupId as string } : existing?.groupId ? { groupId: existing.groupId } : {}),
      ...(overrides.groupIds !== undefined ? { groupIds: overrides.groupIds as string[] } : existing?.groupIds ? { groupIds: existing.groupIds } : {}),
      motivations: motivations.length > 0 ? motivations : ["(unspecified)"],
      emotionalBaseline,
      speakingStyle: data.speakingStyle ?? existing?.speakingStyle ?? "unspecified",
      ...(overrides.voice !== undefined ? { voice: overrides.voice as CharacterDefinition["voice"] } : existing?.voice ? { voice: existing.voice } : {}),
      ...(overrides.backstory !== undefined ? { backstory: overrides.backstory as string } : existing?.backstory ? { backstory: existing.backstory } : {}),
      ...(overrides.visualDescription !== undefined ? { visualDescription: overrides.visualDescription as string } : existing?.visualDescription ? { visualDescription: existing.visualDescription } : {}),
      ...(overrides.knowledgeDomains !== undefined ? { knowledgeDomains: overrides.knowledgeDomains as string[] } : existing?.knowledgeDomains ? { knowledgeDomains: existing.knowledgeDomains } : {}),
      ...(data.behaviorTriggers !== undefined ? { behaviorTriggers: data.behaviorTriggers } : existing?.behaviorTriggers ? { behaviorTriggers: existing.behaviorTriggers } : {}),
      ...(overrides.dialogueExamples !== undefined ? { dialogueExamples: overrides.dialogueExamples as string[] } : existing?.dialogueExamples ? { dialogueExamples: existing.dialogueExamples } : {}),
      ...(overrides.secrets !== undefined ? { secrets: overrides.secrets as string[] } : existing?.secrets ? { secrets: existing.secrets } : {}),
      ...(overrides.deathCondition !== undefined ? { deathCondition: overrides.deathCondition as string } : existing?.deathCondition ? { deathCondition: existing.deathCondition } : {}),
      ...(overrides.tags !== undefined ? { tags: overrides.tags as string[] } : existing?.tags ? { tags: existing.tags } : {}),
      ...(existing?.npcRelationships ? { npcRelationships: existing.npcRelationships } : {}),
    });
  }

  // Preserve characters in the JSONB that aren't yet in the graph
  const legacy = definition.characters.filter((c) => !seenSlugs.has(c.id));
  const merged = [...hydrated, ...legacy];
  if (merged.length === 0) return definition;

  return { ...definition, characters: merged };
}

class MemoryWorldRepository implements WorldRepository {
  constructor(private readonly staticWorlds: WorldDefinition[]) {}

  async listWorlds() {
    const dynamicWorlds = Array.from(memoryWorldStore.worlds.values()).map(
      (record) => record.definition,
    );

    return mergeWorlds(this.staticWorlds, dynamicWorlds);
  }

  async getWorldById(worldId: string) {
    const dynamic = memoryWorldStore.worlds.get(worldId);

    if (dynamic) {
      return dynamic.definition;
    }

    return getStaticWorld(this.staticWorlds, worldId);
  }

  async getWorldDetail(worldId: string) {
    const dynamic = memoryWorldStore.worlds.get(worldId);

    if (dynamic) {
      return {
        source: "dynamic" as const,
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
      source: "static" as const,
      editable: false,
      world: staticWorld,
      record: null,
    };
  }

  async createWorldFromDefinition({ prompt, definition, status = "published" }: {
    prompt: string;
    definition: WorldDefinition;
    status?: "published" | "draft";
  }) {
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

  async updateWorld({ worldId, definition }: { worldId: string; definition: WorldDefinition }) {
    const existing = memoryWorldStore.worlds.get(worldId);

    if (!existing) {
      return null;
    }

    const record = worldRecordSchema.parse({
      ...existing,
      id: worldId,
      title: definition.title,
      definition,
      version: existing.version + 1,
      updatedAt: isoNow(),
    });

    memoryWorldStore.worlds.set(worldId, record);

    return record;
  }
}

class NeonWorldRepository implements WorldRepository {
  private db = getDb();
  private memoryFallback: MemoryWorldRepository;

  constructor(private readonly staticWorlds: WorldDefinition[]) {
    this.memoryFallback = new MemoryWorldRepository(staticWorlds);
  }

  async listWorlds() {
    if (!this.db) {
      return mergeWorlds(this.staticWorlds, []);
    }
    const db = this.db;

    try {
      const rows = await retryRead(() =>
        db
          .select()
          .from(worldsTable)
          .where(eq(worldsTable.status, "published"))
          .orderBy(desc(worldsTable.updatedAt)),
      );

      const dynamicWorlds = await Promise.all(
        rows.map(async (row) => {
          const def = parseWorldRow(row).definition;
          return hydrateCharactersFromGraph(def.id, def);
        }),
      );

      return mergeWorlds(this.staticWorlds, dynamicWorlds);
    } catch (error) {
      if (isMissingWorldsTableError(error)) {
        return this.memoryFallback.listWorlds();
      }

      throw error;
    }
  }

  async getWorldById(worldId: string) {
    if (!this.db) {
      return getStaticWorld(this.staticWorlds, worldId);
    }
    const db = this.db;

    try {
      const rows = await retryRead(() =>
        db
          .select()
          .from(worldsTable)
          .where(eq(worldsTable.id, worldId))
          .limit(1),
      );

      const row = rows[0];

      if (row) {
        const def = parseWorldRow(row).definition;
        return hydrateCharactersFromGraph(def.id, def);
      }

      return getStaticWorld(this.staticWorlds, worldId);
    } catch (error) {
      if (isMissingWorldsTableError(error)) {
        return this.memoryFallback.getWorldById(worldId);
      }

      throw error;
    }
  }

  async getWorldDetail(worldId: string) {
    if (!this.db) {
      const world = getStaticWorld(this.staticWorlds, worldId);

      if (!world) {
        return null;
      }

      return {
        source: "static" as const,
        editable: false,
        world,
        record: null,
      };
    }

    const db = this.db;
    try {
      const rows = await retryRead(() =>
        db
          .select()
          .from(worldsTable)
          .where(eq(worldsTable.id, worldId))
          .limit(1),
      );

      const row = rows[0];

      if (row) {
        const record = parseWorldRow(row);
        const hydrated = await hydrateCharactersFromGraph(record.definition.id, record.definition);

        return {
          source: "dynamic" as const,
          editable: true,
          world: hydrated,
          record: { ...record, definition: hydrated },
        };
      }

      const staticWorld = getStaticWorld(this.staticWorlds, worldId);

      if (!staticWorld) {
        return null;
      }

      return {
        source: "static" as const,
        editable: false,
        world: staticWorld,
        record: null,
      };
    } catch (error) {
      if (isMissingWorldsTableError(error)) {
        return this.memoryFallback.getWorldDetail(worldId);
      }

      throw error;
    }
  }

  async createWorldFromDefinition({ prompt, definition, status = "published" }: {
    prompt: string;
    definition: WorldDefinition;
    status?: "published" | "draft";
  }) {
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

  async updateWorld({ worldId, definition }: { worldId: string; definition: WorldDefinition }) {
    if (!this.db) {
      throw new Error("Neon database unavailable.");
    }

    const db = this.db;
    const existingRows = await retryRead(() =>
      db
        .select()
        .from(worldsTable)
        .where(eq(worldsTable.id, worldId))
        .limit(1),
    );

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

export function getWorldRepository(staticWorlds: WorldDefinition[] = []): WorldRepository {
  return process.env.DATABASE_URL
    ? new NeonWorldRepository(staticWorlds)
    : new MemoryWorldRepository(staticWorlds);
}
