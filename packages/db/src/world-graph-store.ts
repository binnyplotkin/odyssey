import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./client";
import {
  charactersTable,
  worldEdgesTable,
  worldNodesTable,
} from "./schema";

/* ── Kind registry ──────────────────────────────────────────────────
 * Adding a new node kind = add an entry here. The Zod schema validates
 * the `data` JSONB column; the registry also declares whether this kind
 * is backed by a library (ref_id required) or native to the world.
 */

export const NODE_KINDS = ["character", "place", "event"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

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

export type CharacterNodeData = z.infer<typeof characterDataSchema>;

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
} as const satisfies Record<NodeKind, z.ZodTypeAny>;

const kindsRequiringRef = new Set<NodeKind>(["character"]);

function validateNodeData(kind: NodeKind, data: unknown): Record<string, unknown> {
  const schema = dataSchemasByKind[kind];
  const parsed = schema.parse(data ?? {});
  return parsed as Record<string, unknown>;
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
] as const;

export type WorldEdgeKind = (typeof KNOWN_EDGE_KINDS)[number] | (string & {});

/* ── Records ─────────────────────────────────────────────────────── */

export interface WorldNodeRecord {
  id: string;
  worldId: string;
  kind: NodeKind;
  refId: string | null;
  label: string;
  summary: string | null;
  data: Record<string, unknown>;
  position: { x: number; y: number } | null;
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
  position?: { x: number; y: number } | null;
}

export interface UpdateNodeInput {
  label?: string;
  summary?: string | null;
  data?: Record<string, unknown>;
  position?: { x: number; y: number } | null;
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

/* ── Public interface ───────────────────────────────────────────── */

export interface WorldGraphStore {
  // Nodes
  listNodes(worldId: string): Promise<WorldNodeRecord[]>;
  getNode(id: string): Promise<WorldNodeRecord | null>;
  createNode(input: CreateNodeInput): Promise<WorldNodeRecord>;
  updateNode(id: string, input: UpdateNodeInput): Promise<WorldNodeRecord | null>;
  removeNode(id: string): Promise<boolean>;

  // Character ingestion — thin wrapper over createNode for the common case.
  // When the character is already a node in this world:
  //   mergeOnExist=false (default) → return existing unchanged
  //   mergeOnExist=true            → merge incoming data into existing, return updated
  ingestCharacter(
    worldId: string,
    characterId: string,
    opts?: {
      label?: string;
      roleInWorld?: string;
      data?: CharacterNodeData;
      position?: { x: number; y: number };
      mergeOnExist?: boolean;
    },
  ): Promise<WorldNodeRecord>;

  // Edges
  listEdges(worldId: string): Promise<WorldEdgeRecord[]>;
  createEdge(input: CreateEdgeInput): Promise<WorldEdgeRecord>;
  removeEdge(id: string): Promise<boolean>;

  // Graph — both in one call for the editor canvas.
  getGraph(worldId: string): Promise<WorldGraph>;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the world graph store");
  return db;
}

function isUniqueViolation(err: unknown): boolean {
  // Drizzle wraps Postgres errors; check the full chain for code 23505 or
  // a "duplicate key" message.
  let cur: unknown = err;
  while (cur) {
    if (typeof cur === "object" && cur !== null) {
      const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
      if (c.code === "23505") return true;
      if (typeof c.message === "string" && /duplicate key/i.test(c.message)) return true;
      cur = c.cause;
    } else {
      break;
    }
  }
  return false;
}

function normalizeNode(row: typeof worldNodesTable.$inferSelect): WorldNodeRecord {
  return {
    id: row.id,
    worldId: row.worldId,
    kind: row.kind as NodeKind,
    refId: row.refId,
    label: row.label,
    summary: row.summary,
    data: (row.data as Record<string, unknown> | null) ?? {},
    position: (row.position as { x: number; y: number } | null) ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function normalizeEdge(row: typeof worldEdgesTable.$inferSelect): WorldEdgeRecord {
  return {
    id: row.id,
    worldId: row.worldId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    kind: row.kind,
    data: (row.data as Record<string, unknown> | null) ?? {},
    createdAt: toIso(row.createdAt),
  };
}

/* ── Implementation ─────────────────────────────────────────────── */

function neonStore(): WorldGraphStore {
  return {
    async listNodes(worldId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(worldNodesTable)
        .where(eq(worldNodesTable.worldId, worldId));
      return rows.map(normalizeNode).sort((a, b) => a.label.localeCompare(b.label));
    },

    async getNode(id) {
      const db = requireDb();
      const [row] = await db
        .select()
        .from(worldNodesTable)
        .where(eq(worldNodesTable.id, id))
        .limit(1);
      return row ? normalizeNode(row) : null;
    },

    async createNode(input) {
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
        const [c] = await db
          .select({ id: charactersTable.id })
          .from(charactersTable)
          .where(eq(charactersTable.id, input.refId))
          .limit(1);
        if (!c) throw new Error(`character ${input.refId} not found`);
      }

      const db = requireDb();
      const [row] = await db
        .insert(worldNodesTable)
        .values({
          worldId: input.worldId,
          kind: input.kind,
          refId: input.refId ?? null,
          label: input.label,
          summary: input.summary ?? null,
          data,
          position: input.position ?? null,
        })
        .returning();
      return normalizeNode(row);
    },

    async updateNode(id, input) {
      const db = requireDb();
      const [existing] = await db
        .select()
        .from(worldNodesTable)
        .where(eq(worldNodesTable.id, id))
        .limit(1);
      if (!existing) return null;

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) values.label = input.label;
      if (input.summary !== undefined) values.summary = input.summary;
      if (input.position !== undefined) values.position = input.position;
      if (input.data !== undefined) {
        values.data = validateNodeData(existing.kind as NodeKind, input.data);
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
      const db = requireDb();
      const [character] = await db
        .select({ id: charactersTable.id, title: charactersTable.title })
        .from(charactersTable)
        .where(eq(charactersTable.id, characterId))
        .limit(1);
      if (!character) throw new Error(`character ${characterId} not found`);

      const incomingData: Record<string, unknown> = {
        ...(opts?.roleInWorld ? { roleInWorld: opts.roleInWorld } : {}),
        ...(opts?.data ?? {}),
      };

      const [existing] = await db
        .select()
        .from(worldNodesTable)
        .where(
          and(
            eq(worldNodesTable.worldId, worldId),
            eq(worldNodesTable.kind, "character"),
            eq(worldNodesTable.refId, characterId),
          ),
        )
        .limit(1);

      if (existing) {
        if (!opts?.mergeOnExist || Object.keys(incomingData).length === 0) {
          return normalizeNode(existing);
        }
        const merged = {
          ...((existing.data as Record<string, unknown> | null) ?? {}),
          ...incomingData,
        };
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
        label: opts?.label ?? character.title,
        data: incomingData,
        position: opts?.position ?? null,
      });
    },

    async listEdges(worldId) {
      const db = requireDb();
      const rows = await db
        .select()
        .from(worldEdgesTable)
        .where(eq(worldEdgesTable.worldId, worldId));
      return rows.map(normalizeEdge);
    },

    async createEdge(input) {
      // Both endpoints must be in the same world. FK can't express this, so
      // we check in the app layer.
      const db = requireDb();
      const endpoints = await db
        .select({ id: worldNodesTable.id, worldId: worldNodesTable.worldId })
        .from(worldNodesTable)
        .where(
          sql`${worldNodesTable.id} IN (${input.fromNodeId}, ${input.toNodeId})`,
        );
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
            data: input.data ?? {},
          })
          .returning();
        return normalizeEdge(row);
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          // Edge already exists — fetch and return it for idempotency.
          const [row] = await db
            .select()
            .from(worldEdgesTable)
            .where(
              and(
                eq(worldEdgesTable.fromNodeId, input.fromNodeId),
                eq(worldEdgesTable.toNodeId, input.toNodeId),
                eq(worldEdgesTable.kind, input.kind),
              ),
            )
            .limit(1);
          if (row) return normalizeEdge(row);
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

let _store: WorldGraphStore | null = null;

export function getWorldGraphStore(): WorldGraphStore {
  if (!_store) _store = neonStore();
  return _store;
}
