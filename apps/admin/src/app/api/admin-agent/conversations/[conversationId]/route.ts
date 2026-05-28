import { NextResponse } from "next/server";
import { getAdminAgentStore } from "@odyssey/db";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ conversationId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await ctx.params;
  const detail = await getAdminAgentStore().getConversationDetail(conversationId);
  if (!detail) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (detail.conversation.adminUserId && detail.conversation.adminUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(detail);
}
