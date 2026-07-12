import {
  getCharacterStore,
  getSceneStore,
  getVoiceStore,
  soundDesignToSceneSounds,
  type CharacterRecord,
} from "@odyssey/db";
import { type Scene } from "@odyssey/types";
import { getScene } from "@odyssey/orchestration/client";

export const CHARACTER_SANDBOX_SCENE_PREFIX = "character-sandbox:";

/**
 * Resolve a sceneId to the orchestrator's `Scene` struct.
 *
 * Priority order:
 *   1. Static registry (orchestration/scenes.ts — legacy hardcoded scenes)
 *   2. DB-backed scene (the `scenes` table, hydrated from scene_nodes)
 *   3. `character-sandbox:<slug-or-id>` dynamic single-character scenes
 */
export async function resolveScene(sceneId: string): Promise<Scene | null> {
  const authored = getScene(sceneId);
  if (authored) return authored;

  const dbScene = await getSceneStore()
    .resolveOrchestratorScene(sceneId)
    .catch(() => null);
  if (dbScene) return dbScene;

  if (!sceneId.startsWith(CHARACTER_SANDBOX_SCENE_PREFIX)) return null;
  const slugOrId = sceneId.slice(CHARACTER_SANDBOX_SCENE_PREFIX.length).trim();
  if (!slugOrId) return null;

  const charStore = getCharacterStore();
  const character =
    (await charStore.getBySlug(slugOrId).catch(() => null)) ??
    (await charStore.getById(slugOrId).catch(() => null));
  if (!character) return null;

  const voice = character.voiceId
    ? await getVoiceStore().getById(character.voiceId).catch(() => null)
    : null;
  const displayName = character.title?.trim() || character.slug;
  const summary = character.summary?.trim();
  const sounds = soundDesignToSceneSounds(character.soundDesign);

  return {
    id: sceneId,
    title: `${displayName} sandbox`,
    description: [
      `A live single-character sandbox for ${displayName}.`,
      "The user is directly testing this character in the admin workbench.",
      `After each user message, choose action "speak" with speakerId "${character.slug}" unless the user explicitly ends the session.`,
      "Use wait-for-user only before the user has spoken or after the character has already answered.",
    ].join(" "),
    characters: [
      {
        characterSlug: character.slug,
        displayName,
        voice: voice?.slug ?? character.slug,
        blurb:
          summary ??
          `The authored character under test. Responds as ${displayName} using the character's configured identity, directive, voice style, model, and knowledge bindings.`,
      },
    ],
    openingBeat: `${displayName} is ready in the sandbox and waiting for the user to begin.`,
    // sm-sound: the character-canvas sound nodes, mapped to the director
    // roster exactly as in SceneDriver.fromCharacter (beds + one-shots).
    defaultAmbience: defaultCharacterBedSlug(character),
    ...(sounds.length > 0 ? { sounds } : {}),
    narratorVoice: "fable",
  };
}

/** The character's opening bed: the default-flagged bed, else the first bed. */
export function defaultCharacterBedSlug(character: CharacterRecord): string | null {
  const sounds = character.soundDesign?.sounds ?? [];
  return (
    (sounds.find((s) => s.role === "bed" && s.isDefault) ??
      sounds.find((s) => s.role === "bed"))?.slug ?? null
  );
}

/**
 * Resolve a speaker slug (from an orchestrator "speak" decision) to the
 * concrete character record whose model/voice/directive drive the turn.
 * The scene roster carries slugs; the speech pipeline needs the DB record.
 */
export async function resolveSpeakerCharacter(
  speakerSlug: string,
): Promise<CharacterRecord | null> {
  const store = getCharacterStore();
  return (
    (await store.getBySlug(speakerSlug).catch(() => null)) ??
    (await store.getById(speakerSlug).catch(() => null))
  );
}
