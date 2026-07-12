import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAudioAssetStore,
  getCharacterStore,
  type CharacterSceneSound,
  type CharacterSoundDesign,
} from "@odyssey/db";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/sound-design
 *
 * Saves the character's sandbox soundscape — the sound nodes placed on the
 * character canvas (a looping bed + cueable one-shots), each bound to an
 * audio_assets row by SLUG. Every slug is verified against the library
 * (must exist and be ready) so a binding can never point at a sound that
 * won't play. At most one bed keeps `isDefault` (first wins).
 *
 * Pass `{ soundDesign: null }` (or an empty `sounds` list) to clear —
 * the sandbox goes silent.
 */

const SceneSoundSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  role: z.enum(["bed", "oneshot"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).nullable(),
  gainDb: z.number().min(-24).max(12).optional(),
  triggerHint: z.string().trim().min(1).max(200).optional(),
  isDefault: z.boolean().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

const SoundDesignSchema = z.object({
  sounds: z.array(SceneSoundSchema).max(16),
});

type Body = {
  soundDesign: CharacterSoundDesign | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  // Explicit null = clear all sound nodes.
  if (body.soundDesign === null) {
    const updated = await getCharacterStore().update(id, { soundDesign: null });
    if (!updated) return jsonError(404, "character not found");
    invalidateCharactersList();
    invalidateCharacterDetail(id);
    return NextResponse.json({ character: updated });
  }

  const parsed = SoundDesignSchema.safeParse(body.soundDesign ?? {});
  if (!parsed.success) {
    return jsonError(400, `invalid sound design: ${parsed.error.message}`);
  }

  // Every bound slug must resolve to a READY library asset.
  const slugs = [...new Set(parsed.data.sounds.map((s) => s.slug))];
  const store = getAudioAssetStore();
  for (const slug of slugs) {
    const asset = await store.getBySlug(slug);
    if (!asset) return jsonError(400, `sound "${slug}" is not in the library`);
    if (asset.status !== "ready") {
      return jsonError(
        400,
        `sound "${slug}" is not processed yet (status: ${asset.status})`,
      );
    }
  }

  // Tighten: strip empties per entry; only beds may hold isDefault, and
  // only the first flagged bed keeps it.
  let defaultSeen = false;
  const sounds: CharacterSceneSound[] = parsed.data.sounds.map((s) => {
    const isDefault = s.role === "bed" && s.isDefault === true && !defaultSeen;
    if (isDefault) defaultSeen = true;
    return {
      slug: s.slug,
      role: s.role,
      name: s.name,
      description: s.description,
      ...(s.gainDb !== undefined && s.gainDb !== 0 ? { gainDb: s.gainDb } : {}),
      ...(s.triggerHint ? { triggerHint: s.triggerHint } : {}),
      ...(isDefault ? { isDefault: true } : {}),
      ...(s.position ? { position: s.position } : {}),
    };
  });

  const updated = await getCharacterStore().update(id, {
    soundDesign: sounds.length ? { sounds } : null,
  });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
