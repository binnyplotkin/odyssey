"use server";

import { revalidatePath } from "next/cache";
import {
  characterDataSchema,
  getCharacterStore,
  getWorldGraphStore,
  type CharacterNodeData,
  type CharacterRecord,
  type WorldNodeRecord,
  type WorldEdgeRecord,
} from "@odyssey/db";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type LibraryCharacterSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  worldCount: number;
};

export async function listLibraryCharacters(
  worldId: string,
): Promise<ActionResult<{ characters: LibraryCharacterSummary[]; linkedIds: string[] }>> {
  try {
    const characterStore = getCharacterStore();
    const graph = getWorldGraphStore();

    const [chars, nodes] = await Promise.all([
      characterStore.list(),
      graph.listNodes(worldId),
    ]);

    const linkedIds = nodes
      .filter((n) => n.kind === "character" && n.refId)
      .map((n) => n.refId as string);

    const worldCounts = await Promise.all(
      chars.map(async (c: CharacterRecord) => ({
        id: c.id,
        n: await characterStore.countWorldsFor(c.id),
      })),
    );
    const countMap = new Map(worldCounts.map((w) => [w.id, w.n]));

    return {
      ok: true,
      data: {
        characters: chars.map((c: CharacterRecord) => ({
          id: c.id,
          slug: c.slug,
          title: c.title,
          summary: c.summary,
          image: c.image,
          worldCount: countMap.get(c.id) ?? 0,
        })),
        linkedIds,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load library." };
  }
}

export async function linkCharacterToWorld(
  worldId: string,
  characterId: string,
  opts?: { roleInWorld?: string; position?: { x: number; y: number } },
): Promise<ActionResult<{ nodeId: string }>> {
  try {
    const node = await getWorldGraphStore().ingestCharacter(worldId, characterId, {
      roleInWorld: opts?.roleInWorld,
      position: opts?.position,
    });
    revalidatePath(`/worlds/${worldId}/editor`);
    return { ok: true, data: { nodeId: node.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to link character." };
  }
}

export async function unlinkCharacterFromWorld(
  worldId: string,
  nodeId: string,
): Promise<ActionResult> {
  try {
    const graph = getWorldGraphStore();
    const node = await graph.getNode(nodeId);
    if (!node || node.worldId !== worldId) {
      return { ok: false, error: "Node not found in this world." };
    }
    if (node.kind !== "character") {
      return { ok: false, error: "Node is not a character." };
    }
    await graph.removeNode(nodeId);
    revalidatePath(`/worlds/${worldId}/editor`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to unlink." };
  }
}

/* ── Character inspector ──────────────────────────────────────────
 * The inspector needs three things: the global character (read-only
 * identity zone), the world_nodes row (the overlay it edits), and the
 * edges touching this node (connections zone). We fetch all in one
 * round-trip so the inspector mounts without flicker.
 */

export type CharacterInspectorData = {
  character: CharacterRecord;
  node: WorldNodeRecord;
  edges: Array<{
    edge: WorldEdgeRecord;
    direction: "out" | "in";
    otherNode: { id: string; kind: string; label: string } | null;
  }>;
  libraryCounts: { worlds: number };
};

export async function getCharacterInspectorData(
  worldId: string,
  characterSlug: string,
): Promise<ActionResult<CharacterInspectorData>> {
  try {
    const charStore = getCharacterStore();
    const graph = getWorldGraphStore();

    const character = await charStore.getBySlug(characterSlug);
    if (!character) {
      return { ok: false, error: `Character "${characterSlug}" not found.` };
    }

    const nodes = await graph.listNodes(worldId);
    const node = nodes.find(
      (n) => n.kind === "character" && n.refId === character.id,
    );
    if (!node) {
      return { ok: false, error: "This character is not linked in the current world." };
    }

    const allEdges = await graph.listEdges(worldId);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = allEdges
      .filter((e) => e.fromNodeId === node.id || e.toNodeId === node.id)
      .map((e) => {
        const direction: "out" | "in" = e.fromNodeId === node.id ? "out" : "in";
        const otherId = direction === "out" ? e.toNodeId : e.fromNodeId;
        const other = byId.get(otherId);
        return {
          edge: e,
          direction,
          otherNode: other
            ? { id: other.id, kind: other.kind, label: other.label }
            : null,
        };
      });

    const worlds = await charStore.countWorldsFor(character.id);

    return {
      ok: true,
      data: { character, node, edges, libraryCounts: { worlds } },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load." };
  }
}

/* ── Canvas edges ──────────────────────────────────────────
 * Return character↔character knows-edges for the editor canvas,
 * pre-resolved to character slugs on either end so the canvas
 * (which indexes by slug) can draw lines without a second lookup.
 */

export type CharacterKnowsEdge = {
  id: string;
  fromSlug: string;
  toSlug: string;
  kind: string;
  attitude?: string;
  context?: string;
};

export async function listCharacterKnowsEdges(
  worldId: string,
): Promise<ActionResult<{ edges: CharacterKnowsEdge[] }>> {
  try {
    const charStore = getCharacterStore();
    const graph = getWorldGraphStore();

    const [nodes, edges] = await Promise.all([
      graph.listNodes(worldId),
      graph.listEdges(worldId),
    ]);

    const refIds = Array.from(
      new Set(
        nodes
          .filter((n) => n.kind === "character" && n.refId)
          .map((n) => n.refId as string),
      ),
    );
    const chars = await Promise.all(refIds.map((id) => charStore.getById(id)));
    const slugByRefId = new Map(
      chars.filter((c): c is CharacterRecord => !!c).map((c) => [c.id, c.slug]),
    );

    const slugByNodeId = new Map<string, string>();
    for (const n of nodes) {
      if (n.kind === "character" && n.refId) {
        const slug = slugByRefId.get(n.refId);
        if (slug) slugByNodeId.set(n.id, slug);
      }
    }

    const result: CharacterKnowsEdge[] = [];
    for (const e of edges) {
      const fromSlug = slugByNodeId.get(e.fromNodeId);
      const toSlug = slugByNodeId.get(e.toNodeId);
      if (!fromSlug || !toSlug) continue;
      const data = e.data as { attitude?: string; context?: string };
      result.push({
        id: e.id,
        fromSlug,
        toSlug,
        kind: e.kind,
        ...(data.attitude ? { attitude: data.attitude } : {}),
        ...(data.context ? { context: data.context } : {}),
      });
    }

    return { ok: true, data: { edges: result } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to load edges." };
  }
}

export async function updateCharacterNodeOverlay(
  worldId: string,
  nodeId: string,
  input: {
    label?: string;
    data: CharacterNodeData;
  },
): Promise<ActionResult<{ node: WorldNodeRecord }>> {
  try {
    const graph = getWorldGraphStore();
    const existing = await graph.getNode(nodeId);
    if (!existing || existing.worldId !== worldId) {
      return { ok: false, error: "Node not found in this world." };
    }
    if (existing.kind !== "character") {
      return { ok: false, error: "Node is not a character." };
    }

    const parsed = characterDataSchema.safeParse(input.data);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid overlay." };
    }

    const updated = await graph.updateNode(nodeId, {
      label: input.label,
      data: parsed.data,
    });
    if (!updated) {
      return { ok: false, error: "Update failed." };
    }

    revalidatePath(`/worlds/${worldId}/editor`);
    return { ok: true, data: { node: updated } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}
