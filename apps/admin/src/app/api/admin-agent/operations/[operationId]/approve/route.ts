import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { approveAdminAgentOperation } from "@/lib/admin-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ operationId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { operationId } = await ctx.params;
  try {
    const operation = await approveAdminAgentOperation({
      operationId,
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
      { error: error instanceof Error ? error.message : "Failed to approve operation." },
      { status: 400 },
    );
  }
}
