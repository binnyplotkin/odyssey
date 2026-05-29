import { notFound } from "next/navigation";
import { getCharacterStore, getSceneGraphStore, getSceneStore } from "@odyssey/db";
import { SceneEditor } from "@/components/scene-editor";

export const dynamic = "force-dynamic";

export type SceneRosterEntry = {
  nodeId: string;
  characterId: string;
  label: string;
};

export type SceneLibraryCharacter = {
  id: string;
  slug: string;
  title: string;
};

export default async function SceneDetailPage({
  params,
}: {
  params: Promise<{ sceneId: string }>;
}) {
  const { sceneId } = await params;

  const scene = await getSceneStore().getSceneById(sceneId);
  if (!scene) notFound();

  const [graph, library] = await Promise.all([
    getSceneGraphStore().getGraph(sceneId),
    getCharacterStore().list(),
  ]);

  const roster: SceneRosterEntry[] = graph.nodes
    .filter((n) => n.kind === "character" && n.refId)
    .map((n) => ({ nodeId: n.id, characterId: n.refId!, label: n.label }));

  const libraryCharacters: SceneLibraryCharacter[] = library.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
  }));

  return (
    <SceneEditor
      scene={{
        id: scene.id,
        title: scene.title,
        prompt: scene.prompt,
        status: scene.status,
        openingBeat: scene.definition.openingBeat,
        defaultAmbience: scene.definition.defaultAmbience,
        narratorVoiceId: scene.definition.narratorVoiceId,
      }}
      roster={roster}
      libraryCharacters={libraryCharacters}
    />
  );
}
