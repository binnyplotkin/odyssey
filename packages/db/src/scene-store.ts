import { eq, inArray } from "drizzle-orm";
import type {
  Scene,
  SceneArcBeat,
  SceneCharacter,
  SceneDefinition,
  SceneRecord,
  SceneSound,
} from "@odyssey/types";
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

/**
 * Lift the authored-intention fields off a character node's `data` jsonb
 * (validated at write time by characterDataSchema, but guarded here since
 * jsonb reads are untyped). Empty strings are dropped; triggers are capped
 * to keep the roster token-tight.
 */
function liftCharacterIntent(data: Record<string, unknown>): Partial<
  Pick<SceneCharacter, "roleInScene" | "motivations" | "emotionalBaseline" | "behaviorTriggers">
> {
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

  const roleInScene = str(data.roleInScene, 80);
  const motivations = str(data.motivations, 400);
  const emotionalBaseline = str(data.emotionalBaseline, 80);
  const behaviorTriggers = Array.isArray(data.behaviorTriggers)
    ? data.behaviorTriggers
        .map((t) => {
          const condition = str((t as Record<string, unknown>)?.condition, 120);
          const behavior = str((t as Record<string, unknown>)?.behavior, 160);
          return condition && behavior ? { condition, behavior } : null;
        })
        .filter((t): t is { condition: string; behavior: string } => !!t)
        .slice(0, 6)
    : [];

  return {
    ...(roleInScene ? { roleInScene } : {}),
    ...(motivations ? { motivations } : {}),
    ...(emotionalBaseline ? { emotionalBaseline } : {}),
    ...(behaviorTriggers.length ? { behaviorTriggers } : {}),
  };
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

      // Resolve library-backed audio nodes to their assets — the slug map
      // feeds the default-bed selector; the full rows feed the director's
      // audio roster (Scene.sounds).
      const audioNodes = graph.nodes.filter((n) => n.kind === "audio" && n.refId);
      const audioRefIds = audioNodes
        .map((n) => n.refId!)
        .filter((x, i, arr) => arr.indexOf(x) === i);
      const audioAssetByRefId = new Map<
        string,
        { slug: string; name: string; description: string | null; loopable: boolean; status: string }
      >();
      if (audioRefIds.length > 0) {
        const audioRows = await retryRead(() =>
          db
            .select({
              id: audioAssetsTable.id,
              slug: audioAssetsTable.slug,
              name: audioAssetsTable.name,
              description: audioAssetsTable.description,
              loopable: audioAssetsTable.loopable,
              status: audioAssetsTable.status,
            })
            .from(audioAssetsTable)
            .where(inArray(audioAssetsTable.id, audioRefIds)),
        );
        for (const row of audioRows) audioAssetByRefId.set(row.id, row);
      }
      const audioSlugByRefId = new Map(
        [...audioAssetByRefId].map(([refId, asset]) => [refId, asset.slug]),
      );

      const defaultAmbienceTrackId = selectDefaultAmbienceTrackId(
        graph.nodes,
        record.definition.defaultAmbience,
        audioSlugByRefId,
      );

      // The director's audio roster: one entry per placed audio node whose
      // asset is ready (never offer a sound that can't play). Placement-
      // level fields (role, triggerHint, gainDb) come from the node data;
      // identity fields from the asset.
      const sounds: SceneSound[] = audioNodes
        .map((node) => {
          const asset = audioAssetByRefId.get(node.refId!);
          if (!asset || asset.status !== "ready") return null;
          const role = node.data.role === "oneshot" ? "oneshot" : "bed";
          const triggerHint =
            typeof node.data.triggerHint === "string" && node.data.triggerHint.trim()
              ? node.data.triggerHint.trim()
              : undefined;
          const gainDb =
            typeof node.data.gainDb === "number" ? node.data.gainDb : undefined;
          return {
            slug: asset.slug,
            name: asset.name,
            description: asset.description,
            role,
            ...(triggerHint ? { triggerHint } : {}),
            ...(gainDb !== undefined ? { gainDb } : {}),
            loopable: asset.loopable,
          } satisfies SceneSound;
        })
        .filter((s): s is SceneSound => !!s);
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
          // Authored intention lives on the node's data (canvas inspector):
          // what this character wants HERE, distinct from their enduring
          // persona in the L02 envelope. Lifted into the SceneCharacter so
          // the director roster + speaker context both see it.
          const intent = liftCharacterIntent(node.data);
          return {
            characterSlug: ref.slug,
            displayName: node.label || ref.title,
            voice: ref.voiceId ?? "default",
            blurb: node.summary ?? ref.summary ?? "",
            ...intent,
          } satisfies SceneCharacter;
        })
        .filter((c): c is SceneCharacter => !!c);

      if (characters.length === 0) return null;

      const objective = record.definition.objective?.trim() || undefined;
      const drive = record.definition.drive ?? undefined;

      // The authored arc: every `event` node is a beat, ordered by
      // data.timeIndex (fallback: creation order). Label = the beat's
      // name; summary = what it looks like when it lands.
      const arc: SceneArcBeat[] = graph.nodes
        .filter((n) => n.kind === "event")
        .sort((a, b) => {
          const ai = typeof a.data.timeIndex === "number" ? a.data.timeIndex : Number.MAX_SAFE_INTEGER;
          const bi = typeof b.data.timeIndex === "number" ? b.data.timeIndex : Number.MAX_SAFE_INTEGER;
          if (ai !== bi) return ai - bi;
          const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
          return byCreatedAt === 0 ? a.id.localeCompare(b.id) : byCreatedAt;
        })
        .map((n) => {
          const summary =
            n.summary?.trim() ||
            (typeof n.data.summary === "string" ? n.data.summary.trim() : "");
          return {
            label: n.label.slice(0, 120),
            ...(summary ? { summary: summary.slice(0, 400) } : {}),
          };
        });

      return {
        id: record.id,
        title: record.title,
        description: record.prompt || record.title,
        characters,
        openingBeat: record.definition.openingBeat || "Scene opens.",
        defaultAmbience: defaultAmbienceTrackId,
        narratorVoice: record.definition.narratorVoiceId ?? undefined,
        ...(sounds.length > 0 ? { sounds } : {}),
        ...(objective ? { objective } : {}),
        ...(drive ? { drive } : {}),
        ...(arc.length > 0 ? { arc } : {}),
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
