import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCharacterStore, getWikisStore } from "@odyssey/db";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";
import { invalidateCharactersList } from "@/lib/characters-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostSchema = z.object({
  wikiId: z.string().min(1),
  priority: z.enum(["primary", "secondary", "reference"]).default("secondary"),
  isActive: z.boolean().default(true),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const [character, wiki, existing] = await Promise.all([
    getCharacterStore().getById(id),
    getWikisStore().getWikiById(parsed.data.wikiId),
    getWikisStore().getBinding(id, parsed.data.wikiId),
  ]);

  if (!character) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  if (!wiki) {
    return NextResponse.json({ error: "wiki not found" }, { status: 404 });
  }
  if (existing) {
    return NextResponse.json(
      { error: "wiki already bound", binding: existing },
      { status: 409 },
    );
  }

  const binding = await getWikisStore().createBinding({
    characterId: id,
    wikiId: parsed.data.wikiId,
    priority: parsed.data.priority,
    isActive: parsed.data.isActive,
  });

  invalidateCharacterDetail(id);
  invalidateCharactersList();

  return NextResponse.json({ binding }, { status: 201 });
}
