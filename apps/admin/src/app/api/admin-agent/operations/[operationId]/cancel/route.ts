import { NextResponse } from "next/server";
import { cancelAdminAgentOperation } from "@/lib/admin-agent/service";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ operationId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { operationId } = await ctx.params;
  const payload = await request.json().catch(() => ({}));

  try {
    const operation = await cancelAdminAgentOperation({
      operationId,
      reason: typeof payload.reason === "string" ? payload.reason : undefined,
      adminUser: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        role: session.user.role,
      },
    });
    return NextResponse.json({ operation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel operation." },
      { status: 400 },
    );
  }
}
