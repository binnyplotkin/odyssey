import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCharacterStore } from "@odyssey/db";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/characters/:id/directive/exemplars
//
// Append ONE exemplar to the character's L02 directive — the cached <exemplars>
// envelope that few-shots the character's voice. Server-side fetch→append→save so
// the caller doesn't need the whole directive (and two promotes can't clobber each
// other). Powers the /sessions Eval-tab "Promote to exemplar" action: grade a past
// turn, and if it's a strong exchange, fold it straight into the voice spec.
//
// Caps at 8 (matches the directive route + the sandbox); dedupes by (user, you).

const ExemplarSchema = z.object({
  user: z.string().trim().min(1, "exemplar user line is required"),
  you: z.string().trim().min(1, "exemplar reply is required"),
  tags: z.array(z.string().trim().min(1)).max(8).optional(),
  rationale: z.string().trim().max(400).optional(),
});

const MAX_EXEMPLARS = 8;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = ExemplarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: `invalid exemplar: ${parsed.error.message}` }, { status: 400 });
  }

  const store = getCharacterStore();
  const character = (await store.getById(id)) ?? (await store.getBySlug(id));
  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const directive = character.directive ?? {};
  const existing = directive.exemplars ?? [];

  if (existing.some((e) => e.user.trim() === parsed.data.user && e.you.trim() === parsed.data.you)) {
    return NextResponse.json({ status: "duplicate", exemplarCount: existing.length });
  }
  if (existing.length >= MAX_EXEMPLARS) {
    return NextResponse.json(
      { status: "full", exemplarCount: existing.length, error: `exemplar cap reached (${MAX_EXEMPLARS}) — drop one in the editor first` },
      { status: 409 },
    );
  }

  const updated = await store.update(character.id, {
    directive: { ...directive, exemplars: [...existing, parsed.data] },
  });
  if (!updated) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  invalidateCharacterDetail(character.id);
  return NextResponse.json({ status: "added", exemplarCount: existing.length + 1 });
}
