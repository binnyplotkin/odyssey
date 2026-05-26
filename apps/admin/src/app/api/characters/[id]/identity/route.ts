import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCharacterStore, type CharacterIdentity } from "@odyssey/db";
import { invalidateCharactersList } from "@/lib/characters-cache";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/identity
 *
 * Saves the L01 Identity on a character. Validates the top-2 trait cap
 * at the API boundary (UI enforces it too — defense in depth). Empty
 * sub-fields are stripped before persist so the stored shape stays
 * tight and the XML compiler can decide which sections to emit.
 *
 * Returns the updated CharacterRecord on success.
 *
 * Pass `{ identity: null }` to clear (falls back to the hardcoded
 * "You are {title}…" anchor).
 */

const TraitSchema = z.object({
  name: z.string().trim().min(1, "trait name is required").max(24, "trait name should be 1–24 chars"),
  description: z.string().trim().max(280, "trait description should be ≤280 chars"),
});

const IdentitySchema = z.object({
  essence: z.string().trim().max(140).optional(),
  traits: z.array(TraitSchema).max(2, "exactly 2 traits maximum (Araujo 2025: more dilutes fidelity)").optional(),
  era: z.string().trim().max(120).optional(),
  setting: z.string().trim().max(280).optional(),
});

type Body = {
  identity: CharacterIdentity | null;
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

  // Explicit null = clear the identity (fall back to hardcoded anchor).
  if (body.identity === null) {
    const updated = await getCharacterStore().update(id, { identity: null });
    if (!updated) return jsonError(404, "character not found");
    invalidateCharactersList();
    invalidateCharacterDetail(id);
    return NextResponse.json({ character: updated });
  }

  const parsed = IdentitySchema.safeParse(body.identity ?? {});
  if (!parsed.success) {
    return jsonError(400, `invalid identity: ${parsed.error.message}`);
  }

  // Strip empty sub-fields so the persisted shape stays tight.
  const cleaned: CharacterIdentity = {};
  if (parsed.data.essence) cleaned.essence = parsed.data.essence;
  if (parsed.data.traits?.length) {
    cleaned.traits = parsed.data.traits.filter((t) => t.name.length > 0);
  }
  if (parsed.data.era) cleaned.era = parsed.data.era;
  if (parsed.data.setting) cleaned.setting = parsed.data.setting;

  const updated = await getCharacterStore().update(id, { identity: cleaned });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharactersList();
  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
