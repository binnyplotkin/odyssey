import { notFound } from "next/navigation";
import {
  getCharacterStore,
  getVoiceStore,
  getWikisStore,
  type CharacterBrainModel,
  type CharacterDirective,
  type CharacterIdentity,
  type CharacterVoiceStyle,
} from "@odyssey/db";
import { DEFAULT_CHAT_MODEL } from "@/lib/model-registry";
import { CharacterSandbox } from "@/components/character-sandbox";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export type SandboxCharacter = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  image: string | null;
  thumbnailColor: string | null;
  identity: CharacterIdentity | null;
  voiceStyle: CharacterVoiceStyle | null;
  brainModel: CharacterBrainModel | null;
  directive: CharacterDirective | null;
  voiceSlug: string | null;
  voiceName: string | null;
  voiceProvider: string | null;
  /** sm-sound: the character's bound sandbox ambience bed (audio_assets slug). */
  ambienceSlug: string | null;
};

export type SandboxBinding = {
  id: string;
  slug: string;
  title: string;
  pageCount: number;
};

export default async function SandboxPage({ params }: { params: Params }) {
  const { slug: idOrSlug } = await params;
  const store = getCharacterStore();
  const character =
    (await store.getById(idOrSlug)) ?? (await store.getBySlug(idOrSlug));
  if (!character) notFound();

  const [bindings, boundVoice] = await Promise.all([
    getWikisStore().listWikisForCharacter(character.id),
    character.voiceId ? getVoiceStore().getById(character.voiceId) : null,
  ]);

  const sandboxCharacter: SandboxCharacter = {
    id: character.id,
    slug: character.slug,
    title: character.title,
    summary: character.summary,
    image: character.image,
    thumbnailColor: character.thumbnailColor,
    identity: character.identity,
    voiceStyle: character.voiceStyle,
    brainModel: character.brainModel,
    directive: character.directive,
    voiceSlug: boundVoice?.slug ?? null,
    voiceName: boundVoice?.name ?? null,
    voiceProvider: boundVoice?.provider ?? null,
    // sm-sound: the bound sandbox bed (audio_assets slug) — seeds the
    // session snapshot's SceneState.ambience.
    ambienceSlug: character.soundDesign?.ambienceSlug ?? null,
  };

  const sandboxBindings: SandboxBinding[] = bindings.map((b) => ({
    id: b.id,
    slug: b.slug,
    title: b.title,
    pageCount: 0,
  }));

  return (
    <CharacterSandbox
      character={sandboxCharacter}
      bindings={sandboxBindings}
      defaultModel={DEFAULT_CHAT_MODEL}
    />
  );
}
