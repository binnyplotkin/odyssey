import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getAudioAssetStore,
  getCharacterStore,
  type CharacterSoundDesign,
} from "@odyssey/db";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/sound-design
 *
 * Saves the sm-sound (Sound design) layer: the character's sandbox
 * soundscape — an ambience bed bound by audio_assets SLUG + a gain trim.
 * The slug is verified against the library (must exist and be ready) so
 * a binding can never point at a sound that won't play.
 *
 * Pass `{ soundDesign: null }` to clear (sandbox goes silent).
 */

const SoundDesignSchema = z.object({
  ambienceSlug: z.string().trim().min(1).max(80).optional(),
  gainDb: z.number().min(-24).max(12).optional(),
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

  // Explicit null = clear the binding.
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

  // A bound slug must resolve to a READY library asset — never persist a
  // binding that can't play.
  if (parsed.data.ambienceSlug) {
    const asset = await getAudioAssetStore().getBySlug(parsed.data.ambienceSlug);
    if (!asset) {
      return jsonError(400, `sound "${parsed.data.ambienceSlug}" is not in the library`);
    }
    if (asset.status !== "ready") {
      return jsonError(
        400,
        `sound "${parsed.data.ambienceSlug}" is not processed yet (status: ${asset.status})`,
      );
    }
  }

  // Strip empty sub-fields so the persisted shape stays tight.
  const cleaned: CharacterSoundDesign = {};
  if (parsed.data.ambienceSlug) cleaned.ambienceSlug = parsed.data.ambienceSlug;
  if (parsed.data.gainDb !== undefined && parsed.data.gainDb !== 0) {
    cleaned.gainDb = parsed.data.gainDb;
  }

  const updated = await getCharacterStore().update(id, {
    soundDesign: Object.keys(cleaned).length ? cleaned : null,
  });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
