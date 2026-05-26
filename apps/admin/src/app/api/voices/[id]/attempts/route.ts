import { NextRequest, NextResponse } from "next/server";
import { getVoiceStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/:id/attempts → newest-first list of extraction attempts
 */

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const attempts = await getVoiceStore().listAttempts(id);
  return NextResponse.json({ attempts });
}
