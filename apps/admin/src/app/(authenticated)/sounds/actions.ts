"use server";

import { revalidatePath } from "next/cache";
import { getAudioAssetStore } from "@odyssey/db";
import { auth } from "@/lib/auth";
import { removeSoundObjects } from "@/lib/sounds-storage";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function updateSoundMeta(
  soundId: string,
  input: {
    name?: string;
    description?: string | null;
    tags?: string[];
    loopable?: boolean;
  },
): Promise<ActionResult> {
  try {
    const name = input.name?.trim();
    if (name !== undefined && !name) {
      return { ok: false, error: "Name cannot be empty." };
    }
    const session = await auth().catch(() => null);
    const updated = await getAudioAssetStore().update(soundId, {
      ...(name !== undefined ? { name } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(input.tags !== undefined
        ? { tags: input.tags.map((t) => t.trim()).filter(Boolean) }
        : {}),
      ...(input.loopable !== undefined ? { loopable: input.loopable } : {}),
      updatedBy: session?.user?.id ?? null,
    });
    if (!updated) return { ok: false, error: "Sound not found." };
    revalidatePath("/sounds");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function archiveSound(soundId: string): Promise<ActionResult> {
  try {
    const session = await auth().catch(() => null);
    const updated = await getAudioAssetStore().archive(
      soundId,
      session?.user?.id ?? null,
    );
    if (!updated) return { ok: false, error: "Sound not found." };
    revalidatePath("/sounds");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Hard delete — removes the row and both storage blobs. Scene audio
 * nodes referencing this asset will fail refId hydration, so the grid
 * only offers this behind a confirm; prefer archive. */
export async function deleteSound(soundId: string): Promise<ActionResult> {
  try {
    const store = getAudioAssetStore();
    const asset = await store.getById(soundId);
    if (!asset) return { ok: false, error: "Sound not found." };
    await removeSoundObjects({
      sourcePath: asset.sourcePath,
      processedPath: asset.processedPath,
    });
    await store.remove(soundId);
    revalidatePath("/sounds");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
