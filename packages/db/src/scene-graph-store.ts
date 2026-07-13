import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./client";
import { retryRead } from "./retry";
import {
  audioAssetsTable,
  charactersTable,
  sceneEdgesTable,
  sceneNodesTable,
} from "./schema";

/* ── Kind registry ──────────────────────────────────────────────────
 * Adding a new node kind = add an entry here. The Zod schema validates
 * the `data` JSONB column; the registry also declares whether this kind
 * is backed by a library (ref_id required) or native to the scene.
 */

// "ambience" is legacy — replaced by the library-backed "audio" kind
// (refId → audio_assets). Kept in the registry for read tolerance on
// rows the conversion script hasn't touched; the editors no longer
// create it.
export const NODE_KINDS = ["character", "place", "event", "ambience", "audio"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const behaviorTriggerSchema = z
  .object({
    condition: z.string().trim().min(1),
    behavior: z.string().trim().min(1),
  })
  .strict();

export const characterDataSchema = z
  .object({
    roleInScene: z.string().trim().min(1).optional(),
    archetype: z.string().trim().min(1).optional(),
    emotionalBaseline: z.string().trim().min(1).optional(),
    motivations: z.string().trim().optional(),
    speakingStyle: z.string().trim().optional(),
    behaviorTriggers: z.array(behaviorTriggerSchema).optional(),
    // Scene-scoped knowledge horizon: this character's dramatic present on
    // their own era timeline. Curator drops later-timeIndexed pages.
    knowledgeHorizon: z
      .object({ era: z.string().trim().min(1), index: z.number().int() })
      .optional(),
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

export const ambienceDataSchema = z
  .object({
    trackId: z.string().trim().min(1),
    description: z.string().trim().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export type AmbienceNodeData = z.infer<typeof ambienceDataSchema>;

// Library-backed sound placement. Asset-level facts (description, tags,
// loopable) live on audio_assets; node data is placement-level only:
// why this sound is in THIS scene and how the director should use it.
export const audioDataSchema = z
  .object({
    // bed = looping ambience (exclusive per scene at runtime);
    // oneshot = sfx the director can cue on a decision.
    role: z.enum(["bed", "oneshot"]),
    // Authoring hint surfaced to the director ("when the fire is
    // mentioned", "when tension breaks").
    triggerHint: z.string().trim().min(1).optional(),
    // Opening bed for the scene (beds only; first-by-createdAt wins if
    // several are flagged).
    isDefault: z.boolean().optional(),
    // Per-scene gain trim in dB applied on top of the asset's
    // normalized level.
    gainDb: z.number().min(-24).max(12).optional(),
  })
  .strict();

export type AudioNodeData = z.infer<typeof audioDataSchema>;

const dataSchemasByKind = {
  character: characterDataSchema,
  place: placeDataSchema,
  event: eventDataSchema,
  ambience: ambienceDataSchema,
  audio: audioDataSchema,
} as const satisfies Record<NodeKind, z.ZodTypeAny>;

const kindsRequiringRef = new Set<NodeKind>(["character", "audio"]);

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

export type SceneEdgeKind = (typeof KNOWN_EDGE_KINDS)[number] | (string & {});

/* ── Records ─────────────────────────────────────────────────────── */

export interface SceneNodeRecord {
  id: string;
  sceneId: string;
  kind: NodeKind;
  refId: string | null;
  label: string;
  summary: string | null;
  data: Record<string, unknown>;
  position: { x: number; y: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SceneEdgeRecord {
  id: string;
  sceneId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface CreateNodeInput {
  sceneId: string;
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
  sceneId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: string;
  data?: Record<string, unknown>;
}

export interface SceneGraph {
  nodes: SceneNodeRecord[];
  edges: SceneEdgeRecord[];
}

/* ── Public interface ───────────────────────────────────────────── */

export interface SceneGraphStore {
  listNodes(sceneId: string): Promise<SceneNodeRecord[]>;
  getNode(id: string): Promise<SceneNodeRecord | null>;
  createNode(input: CreateNodeInput): Promise<SceneNodeRecord>;
  updateNode(id: string, input: UpdateNodeInput): Promise<SceneNodeRecord | null>;
  removeNode(id: string): Promise<boolean>;

  ingestCharacter(
    sceneId: string,
    characterId: string,
    opts?: {
      label?: string;
      roleInScene?: string;
      data?: CharacterNodeData;
      position?: { x: number; y: number };
      mergeOnExist?: boolean;
    },
  ): Promise<SceneNodeRecord>;

  listEdges(sceneId: string): Promise<SceneEdgeRecord[]>;
  createEdge(input: CreateEdgeInput): Promise<SceneEdgeRecord>;
  removeEdge(id: string): Promise<boolean>;

  getGraph(sceneId: string): Promise<SceneGraph>;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the scene graph store");
  return db;
}

function isUniqueViolation(err: unknown): boolean {
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

function normalizeNode(row: typeof sceneNodesTable.$inferSelect): SceneNodeRecord {
  return {
    id: row.id,
    sceneId: row.sceneId,
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

function normalizeEdge(row: typeof sceneEdgesTable.$inferSelect): SceneEdgeRecord {
  return {
    id: row.id,
    sceneId: row.sceneId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    kind: row.kind,
    data: (row.data as Record<string, unknown> | null) ?? {},
    createdAt: toIso(row.createdAt),
  };
}

/* ── Implementation ─────────────────────────────────────────────── */

function neonStore(): SceneGraphStore {
  return {
    async listNodes(sceneId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(sceneNodesTable)
          .where(eq(sceneNodesTable.sceneId, sceneId)),
      );
      return rows.map(normalizeNode).sort((a, b) => a.label.localeCompare(b.label));
    },

    async getNode(id) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db
          .select()
          .from(sceneNodesTable)
          .where(eq(sceneNodesTable.id, id))
          .limit(1),
      );
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

      if (input.kind === "character" && input.refId) {
        const db = requireDb();
        const refId = input.refId;
        const [c] = await retryRead(() =>
          db
            .select({ id: charactersTable.id })
            .from(charactersTable)
            .where(eq(charactersTable.id, refId))
            .limit(1),
        );
        if (!c) throw new Error(`character ${input.refId} not found`);
      }

      if (input.kind === "audio" && input.refId) {
        const db = requireDb();
        const refId = input.refId;
        const [a] = await retryRead(() =>
          db
            .select({ id: audioAssetsTable.id })
            .from(audioAssetsTable)
            .where(eq(audioAssetsTable.id, refId))
            .limit(1),
        );
        if (!a) throw new Error(`audio asset ${input.refId} not found`);
      }

      const db = requireDb();
      const [row] = await db
        .insert(sceneNodesTable)
        .values({
          sceneId: input.sceneId,
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
      const [existing] = await retryRead(() =>
        db
          .select()
          .from(sceneNodesTable)
          .where(eq(sceneNodesTable.id, id))
          .limit(1),
      );
      if (!existing) return null;

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (input.label !== undefined) values.label = input.label;
      if (input.summary !== undefined) values.summary = input.summary;
      if (input.position !== undefined) values.position = input.position;
      if (input.data !== undefined) {
        values.data = validateNodeData(existing.kind as NodeKind, input.data);
      }

      const [row] = await db
        .update(sceneNodesTable)
        .set(values)
        .where(eq(sceneNodesTable.id, id))
        .returning();
      return row ? normalizeNode(row) : null;
    },

    async removeNode(id) {
      const db = requireDb();
      const result = await db
        .delete(sceneNodesTable)
        .where(eq(sceneNodesTable.id, id))
        .returning();
      return result.length > 0;
    },

    async ingestCharacter(sceneId, characterId, opts) {
      const db = requireDb();
      const [character] = await retryRead(() =>
        db
          .select({ id: charactersTable.id, title: charactersTable.title })
          .from(charactersTable)
          .where(eq(charactersTable.id, characterId))
          .limit(1),
      );
      if (!character) throw new Error(`character ${characterId} not found`);

      const incomingData: Record<string, unknown> = {
        ...(opts?.roleInScene ? { roleInScene: opts.roleInScene } : {}),
        ...(opts?.data ?? {}),
      };

      const [existing] = await retryRead(() =>
        db
          .select()
          .from(sceneNodesTable)
          .where(
            and(
              eq(sceneNodesTable.sceneId, sceneId),
              eq(sceneNodesTable.kind, "character"),
              eq(sceneNodesTable.refId, characterId),
            ),
          )
          .limit(1),
      );

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
          .update(sceneNodesTable)
          .set({ data: validated, updatedAt: new Date() })
          .where(eq(sceneNodesTable.id, existing.id))
          .returning();
        return normalizeNode(row);
      }

      return this.createNode({
        sceneId,
        kind: "character",
        refId: characterId,
        label: opts?.label ?? character.title,
        data: incomingData,
        position: opts?.position ?? null,
      });
    },

    async listEdges(sceneId) {
      const db = requireDb();
      const rows = await retryRead(() =>
        db
          .select()
          .from(sceneEdgesTable)
          .where(eq(sceneEdgesTable.sceneId, sceneId)),
      );
      return rows.map(normalizeEdge);
    },

    async createEdge(input) {
      const db = requireDb();
      const endpoints = await retryRead(() =>
        db
          .select({ id: sceneNodesTable.id, sceneId: sceneNodesTable.sceneId })
          .from(sceneNodesTable)
          .where(
            sql`${sceneNodesTable.id} IN (${input.fromNodeId}, ${input.toNodeId})`,
          ),
      );
      if (endpoints.length !== 2) {
        throw new Error("edge endpoints not found");
      }
      for (const ep of endpoints) {
        if (ep.sceneId !== input.sceneId) {
          throw new Error("edge endpoints must belong to the same scene");
        }
      }
      if (input.fromNodeId === input.toNodeId) {
        throw new Error("edge endpoints must differ");
      }

      try {
        const [row] = await db
          .insert(sceneEdgesTable)
          .values({
            sceneId: input.sceneId,
            fromNodeId: input.fromNodeId,
            toNodeId: input.toNodeId,
            kind: input.kind,
            data: input.data ?? {},
          })
          .returning();
        return normalizeEdge(row);
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          const [row] = await retryRead(() =>
            db
              .select()
              .from(sceneEdgesTable)
              .where(
                and(
                  eq(sceneEdgesTable.fromNodeId, input.fromNodeId),
                  eq(sceneEdgesTable.toNodeId, input.toNodeId),
                  eq(sceneEdgesTable.kind, input.kind),
                ),
              )
              .limit(1),
          );
          if (row) return normalizeEdge(row);
        }
        throw e;
      }
    },

    async removeEdge(id) {
      const db = requireDb();
      const result = await db
        .delete(sceneEdgesTable)
        .where(eq(sceneEdgesTable.id, id))
        .returning();
      return result.length > 0;
    },

    async getGraph(sceneId) {
      const [nodes, edges] = await Promise.all([
        this.listNodes(sceneId),
        this.listEdges(sceneId),
      ]);
      return { nodes, edges };
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────── */

let _store: SceneGraphStore | null = null;

export function getSceneGraphStore(): SceneGraphStore {
  if (!_store) _store = neonStore();
  return _store;
}
