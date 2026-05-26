import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWikisStore } from "@odyssey/db";
import { invalidateCharacterDetail } from "@/lib/character-detail-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/characters/:id/bindings/:bindingId
 *
 * Updates a character→wiki binding's priority and/or active flag.
 * Both fields optional; pass only what changes.
 *
 * DELETE /api/characters/:id/bindings/:bindingId
 *
 * Removes the binding entirely. The wiki itself is untouched.
 */

const PatchSchema = z.object({
  priority: z.enum(["primary", "secondary", "reference"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id, bindingId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const updated = await getWikisStore().updateBinding(bindingId, parsed.data);
  if (!updated) {
    return NextResponse.json({ error: "binding not found" }, { status: 404 });
  }
  invalidateCharacterDetail(id);
  return NextResponse.json({ binding: updated });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id, bindingId } = await ctx.params;
  const removed = await getWikisStore().deleteBinding(bindingId);
  if (!removed) {
    return NextResponse.json({ error: "binding not found" }, { status: 404 });
  }
  invalidateCharacterDetail(id);
  return NextResponse.json({ ok: true });
}
