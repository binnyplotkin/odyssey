import { notFound } from "next/navigation";
import type {
  CharacterBrainModel,
  CharacterIdentity,
  SceneEdgeRecord,
  SceneNodeRecord,
} from "@odyssey/db";
import {
  getAudioAssetStore,
  getCharacterStore,
  getSceneGraphStore,
  getSceneStore,
} from "@odyssey/db";
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

/** Compact audio-asset row for the canvas "add audio" picker + node
 * hydration. Slug doubles as the runtime track id. */
export type SceneLibrarySound = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  loopable: boolean;
  status: string;
  durationS: number | null;
};

export default async function SceneDetailPage({
  params,
}: {
  params: Promise<{ sceneId: string }>;
}) {
  const { sceneId } = await params;

  const scene = await getSceneStore().getSceneById(sceneId);
  if (!scene) notFound();

  const [graph, library, soundLibrary] = await Promise.all([
    getSceneGraphStore().getGraph(sceneId),
    getCharacterStore().list(),
    getAudioAssetStore().list(),
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

  const librarySounds: SceneLibrarySound[] = soundLibrary.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    description: a.description,
    loopable: a.loopable,
    status: a.status,
    durationS: a.durationS,
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
        objective: scene.definition.objective,
        drive: scene.definition.drive,
      }}
      roster={roster}
      graph={graph}
      libraryCharacters={libraryCharacters}
      librarySounds={librarySounds}
    />
  );
}
