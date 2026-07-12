import { eq, inArray } from "drizzle-orm";
import type { Scene, SceneCharacter, SceneDefinition, SceneRecord } from "@odyssey/types";
import { sceneDefinitionSchema } from "@odyssey/types";
import { getDb } from "./client";
import { retryRead } from "./retry";
import { audioAssetsTable, charactersTable, scenesTable } from "./schema";
import { getSceneGraphStore, type SceneNodeRecord } from "./scene-graph-store";

/* ── Shape ─────────────────────────────────────────────────────────── */

export interface CreateSceneInput {
  userId: string | null;
  title: string;
  prompt?: string;
  definition?: Partial<SceneDefinition>;
}

export interface UpdateSceneInput {
  title?: string;
  prompt?: string;
  status?: "draft" | "active" | "archived";
  definition?: Partial<SceneDefinition>;
}

export interface SceneStore {
  listScenes(opts?: { userId?: string | null }): Promise<SceneRecord[]>;
  getSceneById(id: string): Promise<SceneRecord | null>;
  createScene(input: CreateSceneInput): Promise<SceneRecord>;
  updateScene(id: string, input: UpdateSceneInput): Promise<SceneRecord | null>;
  archiveScene(id: string): Promise<boolean>;

  /**
   * Resolve a scene to the orchestrator's `Scene` struct by hydrating
   * character nodes from the global library. Returns null if the scene
   * doesn't exist or has no character nodes. Solo character scenes are valid
   * for sandbox/rehearsal flows; richer authored scenes can include a larger
   * roster through the graph.
   */
  resolveOrchestratorScene(id: string): Promise<Scene | null>;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for the scene store");
  return db;
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

function normalizeDefinition(raw: unknown): SceneDefinition {
  const parsed = sceneDefinitionSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return sceneDefinitionSchema.parse({});
}

function normalizeRow(row: typeof scenesTable.$inferSelect): SceneRecord {
  return {
    id: row.id,
    userId: row.userId ?? null,
    title: row.title,
    prompt: row.prompt ?? "",
    status: (row.status as SceneRecord["status"]) ?? "draft",
    definition: normalizeDefinition(row.definition),
    version: row.version,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function selectDefaultAmbienceTrackId(
  nodes: Array<
    Pick<SceneNodeRecord, "kind" | "data" | "createdAt" | "id" | "refId">
  >,
  fallback?: string | null,
  /** refId → audio_assets.slug, for library-backed `audio` nodes. The
   * asset slug IS the runtime track id. */
  audioSlugByRefId?: Map<string, string>,
): string | null {
  const byCreation = (
    a: Pick<SceneNodeRecord, "createdAt" | "id">,
    b: Pick<SceneNodeRecord, "createdAt" | "id">,
  ) => {
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    return byCreatedAt === 0 ? a.id.localeCompare(b.id) : byCreatedAt;
  };

  // Library-backed audio beds win over legacy ambience nodes.
  const defaultAudioNode = nodes
    .filter(
      (n) =>
        n.kind === "audio" &&
        n.data.role === "bed" &&
        n.data.isDefault === true &&
        n.refId,
    )
    .sort(byCreation)[0];
  if (defaultAudioNode?.refId) {
    const slug = audioSlugByRefId?.get(defaultAudioNode.refId)?.trim();
    if (slug) return slug;
  }

  const defaultAmbienceNode = nodes
    .filter((n) => n.kind === "ambience" && n.data.isDefault === true)
    .sort(byCreation)[0];
  const trackId =
    typeof defaultAmbienceNode?.data.trackId === "string"
      ? defaultAmbienceNode.data.trackId.trim()
      : "";
  return trackId || fallback || null;
}

/* ── Implementation ────────────────────────────────────────────────── */

function neonStore(): SceneStore {
  return {
    async listScenes(opts) {
      const db = requireDb();
      const rows = await retryRead(() => {
        const query = db.select().from(scenesTable);
        if (opts?.userId) {
          return query.where(eq(scenesTable.userId, opts.userId));
        }
        return query;
      });
      return rows
        .map(normalizeRow)
        .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    },

    async getSceneById(id) {
      const db = requireDb();
      const [row] = await retryRead(() =>
        db.select().from(scenesTable).where(eq(scenesTable.id, id)).limit(1),
      );
      return row ? normalizeRow(row) : null;
    },

    async createScene(input) {
      const db = requireDb();
      const definition = sceneDefinitionSchema.parse(input.definition ?? {});
      const [row] = await db
        .insert(scenesTable)
        .values({
          userId: input.userId,
          title: input.title,
          prompt: input.prompt ?? "",
          status: "draft",
          definition,
          version: 1,
        })
        .returning();
      return normalizeRow(row);
    },

    async updateScene(id, input) {
      const db = requireDb();
      const [existing] = await retryRead(() =>
        db.select().from(scenesTable).where(eq(scenesTable.id, id)).limit(1),
      );
      if (!existing) return null;

      const next: Record<string, unknown> = {
        updatedAt: new Date(),
        version: existing.version + 1,
      };
      if (input.title !== undefined) next.title = input.title;
      if (input.prompt !== undefined) next.prompt = input.prompt;
      if (input.status !== undefined) next.status = input.status;
      if (input.definition !== undefined) {
        const merged = {
          ...normalizeDefinition(existing.definition),
          ...input.definition,
        };
        next.definition = sceneDefinitionSchema.parse(merged);
      }

      const [row] = await db
        .update(scenesTable)
        .set(next)
        .where(eq(scenesTable.id, id))
        .returning();
      return row ? normalizeRow(row) : null;
    },

    async archiveScene(id) {
      const db = requireDb();
      const result = await db
        .update(scenesTable)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(scenesTable.id, id))
        .returning();
      return result.length > 0;
    },

    async resolveOrchestratorScene(id) {
      const record = await this.getSceneById(id);
      if (!record) return null;

      const graph = await getSceneGraphStore().getGraph(id);
      const characterNodes = graph.nodes.filter((n) => n.kind === "character" && n.refId);
      if (characterNodes.length === 0) return null;

      const db = requireDb();

      // Resolve library-backed audio nodes to asset slugs (the runtime
      // track id) so the default-bed selector can consider them.
      const audioRefIds = graph.nodes
        .filter((n) => n.kind === "audio" && n.refId)
        .map((n) => n.refId!)
        .filter((x, i, arr) => arr.indexOf(x) === i);
      const audioSlugByRefId = new Map<string, string>();
      if (audioRefIds.length > 0) {
        const audioRows = await retryRead(() =>
          db
            .select({ id: audioAssetsTable.id, slug: audioAssetsTable.slug })
            .from(audioAssetsTable)
            .where(inArray(audioAssetsTable.id, audioRefIds)),
        );
        for (const row of audioRows) audioSlugByRefId.set(row.id, row.slug);
      }

      const defaultAmbienceTrackId = selectDefaultAmbienceTrackId(
        graph.nodes,
        record.definition.defaultAmbience,
        audioSlugByRefId,
      );
      const charIds = characterNodes.map((n) => n.refId).filter((x): x is string => !!x);
      const charRows = await retryRead(() =>
        db
          .select({
            id: charactersTable.id,
            slug: charactersTable.slug,
            title: charactersTable.title,
            summary: charactersTable.summary,
            voiceId: charactersTable.voiceId,
          })
          .from(charactersTable)
          .where(inArray(charactersTable.id, charIds)),
      );

      const charById = new Map(charRows.map((c) => [c.id, c]));
      const characters: SceneCharacter[] = characterNodes
        .map((node) => {
          const ref = charById.get(node.refId!);
          if (!ref) return null;
          return {
            characterSlug: ref.slug,
            displayName: node.label || ref.title,
            voice: ref.voiceId ?? "default",
            blurb: node.summary ?? ref.summary ?? "",
          } satisfies SceneCharacter;
        })
        .filter((c): c is SceneCharacter => !!c);

      if (characters.length === 0) return null;

      return {
        id: record.id,
        title: record.title,
        description: record.prompt || record.title,
        characters,
        openingBeat: record.definition.openingBeat || "Scene opens.",
        defaultAmbience: defaultAmbienceTrackId,
        narratorVoice: record.definition.narratorVoiceId ?? undefined,
      };
    },
  };
}

/* ── Factory ───────────────────────────────────────────────────────── */

let _store: SceneStore | null = null;

export function getSceneStore(): SceneStore {
  if (!_store) _store = neonStore();
  return _store;
}
