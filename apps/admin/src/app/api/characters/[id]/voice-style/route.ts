import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCharacterStore, type CharacterVoiceStyle } from "@odyssey/db";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/voice-style
 *
 * Saves the L03 Voice & Style on a character. Validates each axis at
 * the boundary (defense in depth — the UI also constrains). Empty
 * sub-fields are stripped before persist so the stored shape stays tight
 * and the XML compiler can decide which sub-tags to emit.
 *
 * Returns the updated CharacterRecord on success.
 *
 * Pass `{ voiceStyle: null }` to clear (back to no `<voice>` block).
 */

const VoiceStyleSchema = z.object({
  tone: z.array(z.string().trim().min(1).max(40)).max(4, "max 4 tone chips (Araujo 2025: more dilutes)").optional(),
  decision: z.string().trim().max(120).optional(),
  brevity: z.enum(["terse", "short", "medium", "long", "paragraph"]).optional(),
  register: z
    .object({
      formality: z.number().min(-1).max(1),
      warmth: z.number().min(-1).max(1),
    })
    .optional(),
  voicePrompt: z.string().trim().max(2000).optional(),
  referenceClipUrl: z.string().trim().url().max(2048).optional().or(z.literal("").transform(() => undefined)),
  prosody: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
});

type Body = {
  voiceStyle: CharacterVoiceStyle | null;
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

  // Explicit null = clear the voice style.
  if (body.voiceStyle === null) {
    const updated = await getCharacterStore().update(id, { voiceStyle: null });
    if (!updated) return jsonError(404, "character not found");
    invalidateCharactersList();
    invalidateCharacterDetail(id);
    return NextResponse.json({ character: updated });
  }

  const parsed = VoiceStyleSchema.safeParse(body.voiceStyle ?? {});
  if (!parsed.success) {
    return jsonError(400, `invalid voice style: ${parsed.error.message}`);
  }

  // Strip empty sub-fields so the persisted shape stays tight.
  const cleaned: CharacterVoiceStyle = {};
  if (parsed.data.tone?.length) cleaned.tone = parsed.data.tone.filter(Boolean);
  if (parsed.data.decision) cleaned.decision = parsed.data.decision;
  if (parsed.data.brevity) cleaned.brevity = parsed.data.brevity;
  if (parsed.data.register) cleaned.register = parsed.data.register;
  if (parsed.data.voicePrompt) cleaned.voicePrompt = parsed.data.voicePrompt;
  if (parsed.data.referenceClipUrl) cleaned.referenceClipUrl = parsed.data.referenceClipUrl;
  if (parsed.data.prosody?.length) cleaned.prosody = parsed.data.prosody.filter(Boolean);

  const updated = await getCharacterStore().update(id, { voiceStyle: cleaned });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
