import { notFound } from "next/navigation";
import type {
  CharacterBrainModel,
  CharacterIdentity,
  SceneEdgeRecord,
  SceneNodeRecord,
} from "@odyssey/db";
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
  summary: string | null;
  image: string | null;
  thumbnailColor: string | null;
  identity: CharacterIdentity | null;
  brainModel: CharacterBrainModel | null;
  voiceId: string | null;
};

export type SceneGraphPayload = {
  nodes: SceneNodeRecord[];
  edges: SceneEdgeRecord[];
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
    summary: c.summary,
    image: c.image,
    thumbnailColor: c.thumbnailColor,
    identity: c.identity,
    brainModel: c.brainModel,
    voiceId: c.voiceId,
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
      graph={graph}
      libraryCharacters={libraryCharacters}
    />
  );
}
