import { NextResponse } from "next/server";
import { getWikiStore } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const refs = await getWikiStore().listSourceRefsForPage(id);
  return NextResponse.json({ refs });
}
