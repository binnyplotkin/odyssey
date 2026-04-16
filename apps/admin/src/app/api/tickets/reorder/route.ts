import { NextRequest, NextResponse } from "next/server";
import { getTicketStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* PATCH /api/tickets/reorder — batch update sortOrder */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { order: { id: string; sortOrder: number }[] };

    if (!Array.isArray(body.order)) {
      return NextResponse.json({ error: "order array is required." }, { status: 400 });
    }

    const store = getTicketStore();
    await Promise.all(
      body.order.map((item) => store.update(item.id, { sortOrder: item.sortOrder })),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder tickets." },
      { status: 500 },
    );
  }
}
