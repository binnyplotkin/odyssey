import { NextRequest, NextResponse } from "next/server";
import { getCharacterStore, getVoiceStore } from "@odyssey/db";
import { invalidateVoicesList } from "@/lib/voices-cache";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/characters/:id/voice
 *   Body: { voiceId: string | null }
 *   Sets characters.voice_id, or clears it. Passing a non-existent or
 *   non-ready voice id returns 409 — bindings are only valid against
 *   extracted voices.
 */

type PatchBody = { voiceId: string | null };

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return jsonError(400, "invalid JSON body");
  }

  if (body.voiceId !== null && typeof body.voiceId !== "string") {
    return jsonError(400, "voiceId must be a string or null");
  }

  if (body.voiceId) {
    const voice = await getVoiceStore().getById(body.voiceId);
    if (!voice) return jsonError(404, "voice not found");
    if (voice.status !== "ready") {
      return jsonError(
        409,
        `voice "${voice.slug}" is not ready (status: ${voice.status})`,
      );
    }
  }

  const updated = await getCharacterStore().update(id, {
    voiceId: body.voiceId,
  });
  if (!updated) return jsonError(404, "character not found");

  // Voice bindings drive `boundCharacterCount` + `boundCharacters` on
  // every row in the voices library — invalidate so the next /voices
  // visit reflects the new binding. Also clear the per-character detail
  // cache (the voice id surfaces in the brand chip + voice slot) and the
  // characters list (voiceStyle.referenceClipUrl can change downstream).
  invalidateVoicesList();
  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
