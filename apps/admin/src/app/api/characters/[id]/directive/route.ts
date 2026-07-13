import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCharacterStore, type CharacterDirective } from "@odyssey/db";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/characters/:id/directive
 *
 * Saves the L02 Directive on a character. Body validates against the
 * Frontier Playbook shape; empty sections are coerced to undefined so we
 * persist a tight object (and the compiler can decide which tags to emit).
 *
 * Returns the updated CharacterRecord on success.
 *
 * Authoring guard: caps `exemplars` at 8 entries (research: top-3-to-5
 * covers >80% of behavioural fidelity, but characters with distinct
 * deflection patterns — blessing / prayer / crisis — need more room).
 * Beyond 8, dilution is real.
 */

const ExemplarSchema = z.object({
  user: z.string().trim().min(1, "exemplar user line is required"),
  you: z.string().trim().min(1, "exemplar reply is required"),
  tags: z.array(z.string().trim().min(1)).max(8).optional(),
  rationale: z.string().trim().max(400).optional(),
});

const DirectiveSchema = z.object({
  scope: z
    .object({
      // Accepted for back-compat with older clients but never persisted:
      // engage-with topics were retired — positive scope emerges from
      // exemplar tags, and the compiler no longer emits <engage>.
      engage: z.array(z.string().trim()).max(40).optional(),
      refuse: z.array(z.string().trim()).max(40).optional(),
    })
    .optional(),
  exemplars: z.array(ExemplarSchema).max(8).optional(),
  never: z.array(z.string().trim()).max(40).optional(),
  framing: z.string().trim().max(2000).optional(),
  guidance: z.string().trim().max(2000).optional(),
});

type Body = {
  directive: CharacterDirective | null;
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

  // Explicit null = clear the directive (fall back to legacy template).
  if (body.directive === null) {
    const updated = await getCharacterStore().update(id, { directive: null });
    if (!updated) return jsonError(404, "character not found");
    invalidateCharacterDetail(id);
    return NextResponse.json({ character: updated });
  }

  const parsed = DirectiveSchema.safeParse(body.directive ?? {});
  if (!parsed.success) {
    return jsonError(400, `invalid directive: ${parsed.error.message}`);
  }

  // Strip empty sub-objects so the persisted shape stays tight — the XML
  // compiler will skip absent sections rather than emitting empty tags.
  const cleaned: CharacterDirective = {};
  if (parsed.data.scope?.refuse?.length) {
    cleaned.scope = { refuse: parsed.data.scope.refuse.filter(Boolean) };
  }
  if (parsed.data.exemplars?.length) cleaned.exemplars = parsed.data.exemplars;
  if (parsed.data.never?.length) cleaned.never = parsed.data.never.filter(Boolean);
  if (parsed.data.framing) cleaned.framing = parsed.data.framing;
  if (parsed.data.guidance) cleaned.guidance = parsed.data.guidance;

  const updated = await getCharacterStore().update(id, { directive: cleaned });
  if (!updated) return jsonError(404, "character not found");

  invalidateCharacterDetail(id);
  return NextResponse.json({ character: updated });
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}
