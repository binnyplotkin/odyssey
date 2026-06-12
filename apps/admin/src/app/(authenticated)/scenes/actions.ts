"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSceneStore, getSceneGraphStore } from "@odyssey/db";
import { invalidateScenesList } from "@/lib/scenes-cache";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function createScene(input: {
  title: string;
  prompt?: string;
}): Promise<ActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required." };

  const scene = await getSceneStore().createScene({
    userId: null,
    title,
    prompt: input.prompt?.trim() || "",
  });

  revalidatePath("/scenes");
  invalidateScenesList();
  redirect(`/scenes/${scene.id}`);
}

export async function updateSceneConfig(
  id: string,
  updates: {
    title?: string;
    prompt?: string;
    status?: "draft" | "active" | "archived";
    openingBeat?: string;
    defaultAmbience?: string | null;
    narratorVoiceId?: string | null;
  },
): Promise<ActionResult> {
  const { title, prompt, status, openingBeat, defaultAmbience, narratorVoiceId } =
    updates;

  const definitionPatch: Record<string, unknown> = {};
  if (openingBeat !== undefined) definitionPatch.openingBeat = openingBeat;
  if (defaultAmbience !== undefined) definitionPatch.defaultAmbience = defaultAmbience;
  if (narratorVoiceId !== undefined) definitionPatch.narratorVoiceId = narratorVoiceId;

  const updated = await getSceneStore().updateScene(id, {
    title,
    prompt,
    status,
    definition: Object.keys(definitionPatch).length ? definitionPatch : undefined,
  });
  if (!updated) return { ok: false, error: "Scene not found." };

  revalidatePath(`/scenes/${id}`);
  revalidatePath("/scenes");
  invalidateScenesList();
  return { ok: true };
}

export async function addCharacterToScene(
  sceneId: string,
  characterId: string,
): Promise<ActionResult<{ nodeId: string }>> {
  try {
    const node = await getSceneGraphStore().ingestCharacter(sceneId, characterId);
    revalidatePath(`/scenes/${sceneId}`);
    revalidatePath("/scenes");
    invalidateScenesList();
    return { ok: true, data: { nodeId: node.id } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to add character.",
    };
  }
}

export async function addAmbienceToScene(
  sceneId: string,
  input: {
    label: string;
    trackId: string;
    description?: string | null;
    isDefault?: boolean;
  },
): Promise<ActionResult<{ nodeId: string }>> {
  const trackId = input.trackId.trim();
  if (!trackId) return { ok: false, error: "Track ID is required." };

  try {
    const node = await getSceneGraphStore().createNode({
      sceneId,
      kind: "ambience",
      label: input.label.trim() || trackId,
      summary: input.description?.trim() || null,
      data: {
        trackId,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        ...(input.isDefault ? { isDefault: true } : {}),
      },
    });
    revalidatePath(`/scenes/${sceneId}`);
    revalidatePath("/scenes");
    invalidateScenesList();
    return { ok: true, data: { nodeId: node.id } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to add ambience.",
    };
  }
}

export async function removeSceneNode(
  sceneId: string,
  nodeId: string,
): Promise<ActionResult> {
  const removed = await getSceneGraphStore().removeNode(nodeId);
  if (!removed) return { ok: false, error: "Node not found." };
  revalidatePath(`/scenes/${sceneId}`);
  revalidatePath("/scenes");
  invalidateScenesList();
  return { ok: true };
}

export async function updateSceneNode(
  sceneId: string,
  nodeId: string,
  updates: {
    label?: string;
    summary?: string | null;
    data?: Record<string, unknown>;
    position?: { x: number; y: number } | null;
  },
): Promise<ActionResult> {
  const graph = getSceneGraphStore();
  const node = await graph.getNode(nodeId);
  if (!node || node.sceneId !== sceneId) {
    return { ok: false, error: "Scene node not found." };
  }

  const updated = await graph.updateNode(nodeId, updates);
  if (!updated) return { ok: false, error: "Scene node not found." };

  revalidatePath(`/scenes/${sceneId}`);
  revalidatePath("/scenes");
  invalidateScenesList();
  return { ok: true };
}

export async function archiveScene(id: string): Promise<ActionResult> {
  const ok = await getSceneStore().archiveScene(id);
  if (!ok) return { ok: false, error: "Scene not found." };
  revalidatePath("/scenes");
  invalidateScenesList();
  return { ok: true };
}
