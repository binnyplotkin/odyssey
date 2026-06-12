import { revalidateTag, unstable_cache } from "next/cache";
import { getSceneStore, getSceneGraphStore } from "@odyssey/db";
import type { SceneSummary } from "@/app/(authenticated)/scenes/page";

/** Cache tag every scene-mutating path invalidates via `invalidateScenesList`. */
export const SCENES_LIST_CACHE_TAG = "scenes-list";

export function invalidateScenesList(): void {
  revalidateTag(SCENES_LIST_CACHE_TAG, "max");
}

/** Cached list of scene summaries — the payload the `/scenes` index renders. */
export const listSceneSummaries = unstable_cache(
  async (): Promise<SceneSummary[]> => {
    const store = getSceneStore();
    const graph = getSceneGraphStore();
    const scenes = await store.listScenes();
    return await Promise.all(
      scenes.map(async (scene): Promise<SceneSummary> => {
        const nodes = await graph.listNodes(scene.id);
        return {
          id: scene.id,
          title: scene.title,
          prompt: scene.prompt,
          status: scene.status,
          openingBeat: scene.definition.openingBeat || null,
          characterCount: nodes.filter((n) => n.kind === "character").length,
          updatedAt: scene.updatedAt,
        };
      }),
    );
  },
  ["scenes-list-summaries"],
  {
    tags: [SCENES_LIST_CACHE_TAG],
    revalidate: 60 * 60,
  },
);
