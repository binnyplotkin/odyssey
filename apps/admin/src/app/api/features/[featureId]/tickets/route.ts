import { NextResponse } from "next/server";
import { getTicketStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ featureId: string }> };

/* GET /api/features/:id/tickets */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { featureId } = await params;
    const tickets = await getTicketStore().listByFeature(featureId);
    return NextResponse.json({ tickets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tickets." },
      { status: 500 },
    );
  }
}
