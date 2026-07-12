import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { getAudioAssetStore, getSceneSessionStore, getVoiceStore } from "@odyssey/db";
import { resolveScene, resolveSpeakerCharacter } from "@/lib/scene-orchestration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SceneSandboxReadinessStatus = "ready" | "warning" | "blocked";

type SceneSandboxReadinessCheck = {
  id: string;
  label: string;
  group: "definition" | "cast" | "voice" | "persistence";
  status: SceneSandboxReadinessStatus;
  summary: string;
  detail?: string;
};

const OPENAI_NARRATOR_VOICES = new Set([
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ sceneId: string }> },
) {
  const { sceneId } = await ctx.params;
  const scene = await resolveScene(sceneId);
  if (!scene) {
    return NextResponse.json({ error: "scene not found" }, { status: 404 });
  }

  const checks: SceneSandboxReadinessCheck[] = [];
  checks.push({
    id: "scene.definition",
    label: "Scene definition",
    group: "definition",
    status: scene.description.trim() && scene.openingBeat.trim() ? "ready" : "blocked",
    summary:
      scene.description.trim() && scene.openingBeat.trim()
        ? "Prompt and opening beat are configured."
        : "Scene prompt and opening beat are required before rehearsal.",
    });

  checks.push(await ambienceTrackCheck(scene.defaultAmbience));

  checks.push({
    id: "scene.cast",
    label: "Cast",
    group: "cast",
    status: scene.characters.length > 0 ? (scene.characters.length === 1 ? "warning" : "ready") : "blocked",
    summary:
      scene.characters.length > 1
        ? `${scene.characters.length} characters are available to the orchestrator.`
        : scene.characters.length === 1
          ? "Solo scene is valid; orchestration will use one speaker."
          : "Add at least one character before rehearsing.",
  });

  const speakerChecks = await Promise.all(
    scene.characters.map(async (entry) => {
      const character = await resolveSpeakerCharacter(entry.characterSlug);
      return {
        entry,
        character,
        voice:
          character?.voiceId
            ? await getVoiceStore().getById(character.voiceId).catch(() => null)
            : await resolveVoice(entry.voice),
      };
    }),
  );

  const missingCharacters = speakerChecks.filter((check) => !check.character);
  checks.push({
    id: "scene.cast.records",
    label: "Character records",
    group: "cast",
    status: missingCharacters.length === 0 ? "ready" : "blocked",
    summary:
      missingCharacters.length === 0
        ? "Every scene speaker resolves to a character record."
        : `${missingCharacters.length} scene speaker${missingCharacters.length === 1 ? "" : "s"} could not be resolved.`,
    detail:
      missingCharacters.length === 0
        ? undefined
        : missingCharacters.map((check) => check.entry.characterSlug).join(", "),
  });

  const missingVoices = speakerChecks.filter((check) => !check.voice);
  const unreadyVoices = speakerChecks.filter(
    (check) => check.voice && check.voice.status !== "ready",
  );
  checks.push({
    id: "scene.cast.voices",
    label: "Character voices",
    group: "voice",
    status:
      missingVoices.length === 0 && unreadyVoices.length === 0
        ? "ready"
        : "warning",
    summary:
      missingVoices.length === 0 && unreadyVoices.length === 0
        ? "All character voices are ready."
        : "One or more speakers will rely on voice fallback.",
    detail: [
      ...missingVoices.map((check) => `${check.entry.displayName}: no bound voice`),
      ...unreadyVoices.map(
        (check) => `${check.entry.displayName}: ${check.voice?.status ?? "unknown"}`,
      ),
    ].join("; ") || undefined,
  });

  checks.push(await narratorVoiceCheck(scene.narratorVoice ?? null));
  checks.push(await persistenceCheck());

  const overallStatus = checks.some((check) => check.status === "blocked")
    ? "blocked"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ready";

  return NextResponse.json({
    report: {
      sceneId: scene.id,
      timestamp: new Date().toISOString(),
      overallStatus,
      checks,
    },
  });
}

async function resolveVoice(idOrSlug: string) {
  if (!idOrSlug || idOrSlug === "default") return null;
  const store = getVoiceStore();
  return (
    (await store.getById(idOrSlug).catch(() => null)) ??
    (await store.getBySlug(idOrSlug).catch(() => null))
  );
}

async function narratorVoiceCheck(
  narratorVoice: string | null,
): Promise<SceneSandboxReadinessCheck> {
  if (!narratorVoice || OPENAI_NARRATOR_VOICES.has(narratorVoice)) {
    return {
      id: "scene.narrator.voice",
      label: "Narrator voice",
      group: "voice",
      status: "ready",
      summary: narratorVoice
        ? "Narrator uses a built-in OpenAI voice."
        : "Narrator will use the default voice.",
    };
  }

  const voice = await resolveVoice(narratorVoice);
  if (!voice) {
    return {
      id: "scene.narrator.voice",
      label: "Narrator voice",
      group: "voice",
      status: "warning",
      summary: "Narrator voice was not found; fallback voice will be used.",
    };
  }
  return {
    id: "scene.narrator.voice",
    label: "Narrator voice",
    group: "voice",
    status: voice.status === "ready" ? "ready" : "warning",
    summary:
      voice.status === "ready"
        ? `Narrator voice "${voice.name}" is ready.`
        : `Narrator voice "${voice.name}" is ${voice.status}; fallback voice will be used.`,
  };
}

async function ambienceTrackCheck(
  trackId: string | null,
): Promise<SceneSandboxReadinessCheck> {
  if (!trackId) {
    return {
      id: "scene.ambience.track",
      label: "Ambience track",
      group: "definition",
      status: "ready",
      summary: "No default ambience track is configured.",
    };
  }

  // Library-first: the runtime track id is an audio_assets slug. Legacy
  // ids that predate the library fall back to the public-file check.
  const asset = await getAudioAssetStore()
    .getBySlug(trackId)
    .catch(() => null);
  if (asset) {
    if (asset.status === "ready" && asset.processedPath) {
      return {
        id: "scene.ambience.track",
        label: "Ambience track",
        group: "definition",
        status: "ready",
        summary: `Default ambience "${asset.name}" is ready in the sound library.`,
        detail: `/api/sounds/by-slug/${trackId}/stream`,
      };
    }
    return {
      id: "scene.ambience.track",
      label: "Ambience track",
      group: "definition",
      status: "warning",
      summary: `Default ambience "${asset.name}" is in the library but not processed yet (status: ${asset.status}). Run Process on /sounds.`,
      detail: `/sounds`,
    };
  }

  const filename = `${trackId}.mp3`;
  if (ambienceFileExists(filename)) {
    return {
      id: "scene.ambience.track",
      label: "Ambience track",
      group: "definition",
      status: "ready",
      summary: `Default ambience "${trackId}" is available.`,
      detail: `/ambience/${filename}`,
    };
  }

  return {
    id: "scene.ambience.track",
    label: "Ambience track",
    group: "definition",
    status: "warning",
    summary: `Default ambience "${trackId}" is configured but the mp3 file was not found.`,
    detail: `/ambience/${filename}`,
  };
}

function ambienceFileExists(filename: string): boolean {
  const candidates = [
    join(process.cwd(), "public", "ambience", filename),
    join(process.cwd(), "apps", "admin", "public", "ambience", filename),
  ];
  return candidates.some((candidate) => existsSync(candidate));
}

async function persistenceCheck(): Promise<SceneSandboxReadinessCheck> {
  try {
    await getSceneSessionStore().listSessions(1);
    return {
      id: "scene.persistence",
      label: "Session persistence",
      group: "persistence",
      status: "ready",
      summary: "Scene sessions can be read from the store.",
    };
  } catch (err) {
    return {
      id: "scene.persistence",
      label: "Session persistence",
      group: "persistence",
      status: "blocked",
      summary: "Scene session persistence is unavailable.",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
